"""Minglewood studio — the art pipeline, driven by an art director (see ART_DIRECTION.md).

Run from art/:  uv run studio.py <command> ...

  gen       prompt (+ optional reference images) -> images (gpt-image, transparent background)
  sheet     contact sheet of images with labels, on a checkerboard (for review)
  slice     cut a grid sheet (e.g. 3x2) into one trimmed PNG per cell
  pixelize  raw render -> finished pixel sprite at exact size (quantized, hard alpha, optional sel-out)
  publish   copy a finished sprite into public/art/sprites and register it in public/art/manifest.json
  usage     image-API spend so far vs the cap in budget.json

Every API call is logged to out/usage.jsonl with the API's own token counts. The key is never printed.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path

import cv2
import httpx
import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
OUT = HERE / "out"
PUBLIC = REPO / "public" / "art"
API = "https://api.openai.com/v1"
MODEL = "gpt-image-2.5-sunburst"

# gpt-image-2.5, $ per 1M tokens (developers.openai.com/api/docs/pricing; same table Companion uses).
PRICES = {"text_in": 5.00, "image_in": 8.00, "image_out": 30.00, "text_out": 0.0}


# ───────────────────────────── API + budget ─────────────────────────────

def api_key() -> str:
    k = os.environ.get("OPENAI_API_KEY")
    if not k:
        sys.exit("OPENAI_API_KEY not set")
    return k


def call_usd(u: dict | None) -> float:
    u = u or {}
    ind = u.get("input_tokens_details") or {}
    outd = u.get("output_tokens_details") or {}
    text_in = ind.get("text_tokens", 0)
    image_in = ind.get("image_tokens", max(0, u.get("input_tokens", 0) - text_in))
    image_out = outd.get("image_tokens", u.get("output_tokens", 0))
    text_out = outd.get("text_tokens", 0)
    p = PRICES
    return (text_in * p["text_in"] + image_in * p["image_in"] + image_out * p["image_out"] + text_out * p["text_out"]) / 1e6


def spent() -> float:
    p = OUT / "usage.jsonl"
    if not p.exists():
        return 0.0
    total = 0.0
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            total += call_usd(json.loads(line).get("usage"))
        except Exception:  # noqa: BLE001
            pass
    return total


def cap() -> float:
    return float(json.loads((HERE / "budget.json").read_text(encoding="utf-8"))["totalUsd"])


def post(url: str, **kw) -> dict:
    s, c = spent(), cap()
    if s >= c:
        raise SystemExit(f"image budget reached (${s:.2f} of ${c:.2f}) — publish what's finished and report; "
                         f"raise art/budget.json only if Carter says so")
    last = None
    for attempt in range(3):
        try:
            r = httpx.post(url, headers={"Authorization": f"Bearer {api_key()}"}, timeout=900, **kw)
            if r.status_code == 200:
                return r.json()
            last = f"HTTP {r.status_code}: {r.text[:500]}"
            if r.status_code in (400, 401, 403, 404):
                break
        except httpx.HTTPError as e:
            last = f"{type(e).__name__}: {e}"
        time.sleep(4 * (attempt + 1))
    raise SystemExit(last)


def log(kind: str, a: argparse.Namespace, usage: dict | None, secs: float, stem: str):
    OUT.mkdir(parents=True, exist_ok=True)
    rec = {"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "kind": kind, "model": a.model, "quality": a.quality,
           "size": a.size, "n": a.count, "usage": usage, "usd": round(call_usd(usage), 4), "secs": round(secs, 1),
           "label": stem}
    with open(OUT / "usage.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")
    return rec["usd"]


def cmd_gen(a):
    prompt = Path(a.prompt_file).read_text(encoding="utf-8") if a.prompt_file else a.prompt
    if a.style:
        sys.path.insert(0, str(HERE))
        from prompts import STYLE  # noqa: PLC0415
        prompt = STYLE + "\n\n" + prompt
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    t = time.time()
    if a.ref:
        files = [("image[]", (Path(p).name, Path(p).read_bytes(), "image/png")) for p in a.ref]
        data = {"model": a.model, "prompt": prompt, "size": a.size, "quality": a.quality,
                "background": a.background, "n": str(a.count), "output_format": "png"}
        j = post(f"{API}/images/edits", files=files, data=data)
        kind = "gen+refs"
    else:
        j = post(f"{API}/images/generations", json={"model": a.model, "prompt": prompt, "size": a.size,
                                                   "quality": a.quality, "background": a.background,
                                                   "n": a.count, "output_format": "png"})
        kind = "gen"
    usd = log(kind, a, j.get("usage"), time.time() - t, a.stem)
    (out / f"{a.stem}.prompt.txt").write_text(prompt, encoding="utf-8")
    paths = []
    for i, d in enumerate(j["data"]):
        p = out / (f"{a.stem}.png" if len(j["data"]) == 1 else f"{a.stem}_{i}.png")
        p.write_bytes(base64.b64decode(d["b64_json"]))
        paths.append(p)
    print(json.dumps({"files": [str(p) for p in paths], "usd": usd, "spent": round(spent(), 3), "cap": cap()}))


# ───────────────────────────── image helpers ─────────────────────────────

def checker(w: int, h: int, cell: int = 8) -> Image.Image:
    bg = Image.new("RGBA", (w, h), (236, 229, 240, 255))
    d = ImageDraw.Draw(bg)
    for y in range(0, h, cell):
        for x in range((y // cell) % 2 * cell, w, cell * 2):
            d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(214, 205, 222, 255))
    return bg


def trim(img: Image.Image, pad: int = 0, thresh: int = 24) -> Image.Image:
    a = np.array(img.getchannel("A"))
    ys, xs = np.where(a > thresh)
    if len(xs) == 0:
        return img
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(img.width, xs.max() + 1 + pad),
           min(img.height, ys.max() + 1 + pad))
    return img.crop(box)


def cmd_sheet(a):
    ims = [(Path(p).stem, Image.open(p).convert("RGBA")) for p in a.images]
    cell = a.cell
    cols = min(a.cols, len(ims))
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 18)), (40, 32, 48))
    d = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(ims):
        s = min((cell - 8) / im.width, (cell - 8) / im.height)
        if a.nearest and s >= 1:
            s = max(1, int(s))
        t = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))),
                      Image.NEAREST if a.nearest else Image.LANCZOS)
        bg = checker(cell, cell)
        bg.alpha_composite(t, ((cell - t.width) // 2, (cell - t.height) // 2))
        x, y = (i % cols) * cell, (i // cols) * (cell + 18)
        sheet.paste(bg.convert("RGB"), (x, y))
        d.text((x + 4, y + cell + 3), f"{name} {im.width}x{im.height}", fill=(240, 230, 245))
    sheet.save(a.out, quality=92)
    print(a.out)


def clean_cell(cell: Image.Image) -> Image.Image:
    """Drop the faint halo gpt-image paints around objects, then keep every solid blob that is a real part of
    the object (a lamp's shade and stem are separate blobs) — but not specks bleeding in from a neighbour."""
    arr = np.array(cell.convert("RGBA"))
    arr[..., 3] = np.where(arr[..., 3] < 40, 0, arr[..., 3])
    solid = (arr[..., 3] > 128).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(cv2.dilate(solid, np.ones((25, 25), np.uint8)), 8)
    if n > 2:
        areas = stats[1:, cv2.CC_STAT_AREA]
        keep = [1 + i for i, ar in enumerate(areas) if ar >= 0.08 * areas.max()]
        arr[..., 3] = np.where(np.isin(lab, keep), arr[..., 3], 0)
    return Image.fromarray(arr)


def alpha_box(img: Image.Image, thresh: int = 24) -> tuple[int, int, int, int] | None:
    a = np.array(img.getchannel("A"))
    ys, xs = np.where(a > thresh)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def cmd_slice(a):
    im = Image.open(a.image).convert("RGBA")
    cols, rows = (int(v) for v in a.grid.lower().split("x"))
    names = a.names.split(",") if a.names else [f"{Path(a.image).stem}_{i}" for i in range(cols * rows)]
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    cw, ch = im.width / cols, im.height / rows
    for i, name in enumerate(names):
        if not name:
            continue
        r, c = divmod(i, cols)
        cell = im.crop((int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch)))
        cell = clean_cell(cell)
        t = trim(cell, 2)
        t.save(out / f"{name}.png")
        print(out / f"{name}.png", t.size)


FACE_VEC = {"se": (1, 0), "sw": (0, 1), "ne": (0, -1), "nw": (-1, 0)}


def cell_origin(i: int, cols: int, rows: int, W: int, H: int, tile: int, w: float, dp: float, h: float):
    """Image position of a cell's floor-diamond back corner (local x=y=z=0). h = object height in game art px."""
    cw, ch = W / cols, H / rows
    r, c = divmod(i, cols)
    zpx = h * tile / 32
    ox = c * cw + cw / 2 - (w - dp) * tile / 4
    oy = r * ch + ch / 2 - (w + dp) * tile / 8 + zpx / 2
    return ox, oy


def draw_guide(cells: list[dict], cols: int, rows: int, W: int, H: int, tile: int) -> Image.Image:
    """Construction-guide reference: per cell, an exact 2:1 floor diamond, a wireframe box of the object's height
    and a red arrow for the way its front faces."""
    im = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    d = ImageDraw.Draw(im)
    col = (150, 150, 165, 255)
    for i, cdef in enumerate(cells):
        w, dp, h = cdef.get("w", 1), cdef.get("d", 1), cdef.get("h", 32)
        ox, oy = cell_origin(i, cols, rows, W, H, tile, w, dp, h)
        zpx = h * tile / 32
        P = lambda x, y, z=0.0: (ox + (x - y) * tile / 2, oy + (x + y) * tile / 4 - z)  # noqa: E731
        base = [P(0, 0), P(w, 0), P(w, dp), P(0, dp)]
        d.polygon(base, outline=col, width=3)
        if zpx > 0:
            top = [P(0, 0, zpx), P(w, 0, zpx), P(w, dp, zpx), P(0, dp, zpx)]
            d.polygon(top, outline=col, width=2)
            for b, t in zip(base, top):
                d.line([b, t], fill=col, width=2)
        face = cdef.get("facing")
        if face:
            vx, vy = FACE_VEC[face]
            cx, cy = P(w / 2, dp / 2)
            ex, ey = P(w / 2 + vx * (w / 2 + 0.6), dp / 2 + vy * (dp / 2 + 0.6))
            d.line([(cx, cy), (ex, ey)], fill=(220, 90, 70, 255), width=5)
            d.ellipse([ex - 8, ey - 8, ex + 8, ey + 8], fill=(220, 90, 70, 255))
    return im


def cmd_guide(a):
    cols, rows = (int(v) for v in a.grid.lower().split("x"))
    W, H = (int(v) for v in a.size.split("x"))
    cells = []
    for sp in a.cells.split(","):
        f = sp.split(":")
        cells.append({"w": float(f[0]), "d": float(f[1]), "h": float(f[2]), "facing": f[3] if len(f) > 3 else None})
    draw_guide(cells, cols, rows, W, H, a.tile).save(a.out)
    print(a.out)


# ───────────────────────────── pixelize ─────────────────────────────

INK = np.array([42, 31, 45], float)


def to_lab(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(rgb.reshape(-1, 1, 3).astype(np.float32) / 255.0, cv2.COLOR_RGB2LAB).reshape(-1, 3)


def pixelize(im: Image.Image, width: int | None, height: int | None, colors: int, outline: str,
             alpha_cut: float = 0.5, sharpen: float = 0.0, no_trim: bool = False) -> Image.Image:
    im = im.convert("RGBA") if no_trim else trim(im.convert("RGBA"))
    src = np.array(im).astype(np.float32) / 255.0
    if sharpen > 0:
        blur = cv2.GaussianBlur(src[..., :3], (0, 0), 1.2)
        src[..., :3] = np.clip(src[..., :3] + sharpen * (src[..., :3] - blur), 0, 1)
    h0, w0 = src.shape[:2]
    if width and height:
        tw, th = width, height
    elif width:
        tw = width
        th = max(1, round(h0 * width / w0))
    else:
        th = height
        tw = max(1, round(w0 * height / h0))
    prem = src.copy()
    prem[..., :3] *= prem[..., 3:4]
    small = cv2.resize(prem, (tw, th), interpolation=cv2.INTER_AREA)
    alpha = small[..., 3]
    rgb = np.where(alpha[..., None] > 1e-4, small[..., :3] / np.maximum(alpha[..., None], 1e-4), 0)
    solid = alpha >= alpha_cut
    out = np.zeros((th, tw, 4), np.uint8)
    px = (np.clip(rgb[solid], 0, 1) * 255).astype(np.float32)
    if len(px) and colors > 0:
        k = min(colors, len(np.unique(px.astype(np.uint8), axis=0)))
        lab = to_lab(px)
        crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.2)
        _, labels, _ = cv2.kmeans(lab.astype(np.float32), k, None, crit, 4, cv2.KMEANS_PP_CENTERS)
        # Palette = mean RGB of each cluster (keeps colors true instead of Lab round-trips).
        pal = np.array([px[labels.ravel() == i].mean(axis=0) if np.any(labels.ravel() == i) else [0, 0, 0]
                        for i in range(k)])
        px = pal[labels.ravel()]
    out[solid, :3] = np.clip(px, 0, 255).astype(np.uint8)
    out[solid, 3] = 255
    if outline == "selout":
        out = selout(out)
    return Image.fromarray(out)


def selout(arr: np.ndarray) -> np.ndarray:
    """1 px outline outside the silhouette: the neighbour's color, darkened and pulled toward plum."""
    a = arr[..., 3] > 0
    h, w = a.shape
    res = arr.copy()
    for y in range(h):
        for x in range(w):
            if a[y, x]:
                continue
            ns = [(y + dy, x + dx) for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)) if 0 <= y + dy < h and 0 <= x + dx < w]
            ns = [n for n in ns if a[n]]
            if not ns:
                continue
            c = np.mean([arr[n][:3] for n in ns], axis=0)
            res[y, x, :3] = np.clip(c * 0.38 + INK * 0.62, 0, 255).astype(np.uint8)
            res[y, x, 3] = 255
    return res


def cmd_pixelize(a):
    im = Image.open(a.image)
    res = pixelize(im, a.width, a.height, a.colors, a.outline, a.alpha_cut, a.sharpen)
    if a.pad_outline:
        big = Image.new("RGBA", (res.width + 2, res.height + 2))
        big.paste(res, (1, 1))
        res = big
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    res.save(out)
    prev = checker(res.width * 4, res.height * 4)
    prev.alpha_composite(res.resize((res.width * 4, res.height * 4), Image.NEAREST))
    prev.convert("RGB").save(out.with_suffix(".x4.png"))
    print(out, res.size)


# ───────────────────────────── build (spec-driven sheets) ─────────────────────────────

FACING_TEXT = {
    "se": "Its front faces along the red arrow, toward the LOWER RIGHT of the image; its back is toward the upper left.",
    "sw": "Its front faces along the red arrow, toward the LOWER LEFT of the image; its back is toward the upper right.",
    "nw": "Seen from BEHIND: its front faces away from us along the red arrow toward the UPPER LEFT; its back faces the "
          "viewer on the lower-right side.",
    "ne": "Seen from BEHIND: its front faces away from us along the red arrow toward the UPPER RIGHT; its back faces "
          "the viewer on the lower-left side.",
}

GUIDE_TEXT = (
    "CONSTRUCTION GUIDES: the reference image is a construction drawing, not art. In each cell it shows the exact "
    "isometric floor diamond the object stands on and a wireframe box it must fill, in the precise 2:1 projection to "
    "use. Red arrows show which way an object's front faces. Draw each object standing on its diamond and filling its "
    "box, with every horizontal edge following the diamond's angles. The output must contain ONLY the objects on a "
    "transparent background: no guide lines, no arrows, no diamonds, no boxes, no floor, no shadows."
)

GAME_TILE = 64  # sprite px per floor tile at 2x density


def load_manifest() -> dict:
    mpath = PUBLIC / "manifest.json"
    return json.loads(mpath.read_text(encoding="utf-8")) if mpath.exists() else {"scale": 2, "sprites": {}}


def save_manifest(m: dict):
    PUBLIC.mkdir(parents=True, exist_ok=True)
    m["sprites"] = dict(sorted(m["sprites"].items()))
    (PUBLIC / "manifest.json").write_text(json.dumps(m, indent=2) + "\n", encoding="utf-8")


def publish_sprite(m: dict, key: str, facing: str | None, img: Image.Image, anchor, footprint, extra: dict):
    (PUBLIC / "sprites").mkdir(parents=True, exist_ok=True)
    fname = f"{key}{'.' + facing if facing else ''}.png"
    img.save(PUBLIC / "sprites" / fname, optimize=True)
    e = m["sprites"].get(key, {})
    e["footprint"] = footprint
    e["fit"] = "anchor"
    rec = {"file": fname, "anchor": [int(anchor[0]), int(anchor[1])]}
    if facing:
        e.setdefault("facings", {})[facing] = rec
        e.pop("file", None)
        e.pop("anchor", None)
    else:
        e.update(rec)
        e.pop("facings", None)
    for k, v in extra.items():
        e[k] = v
    m["sprites"][key] = e


def sheet_prompt(spec: dict, sheet: dict) -> str:
    sys.path.insert(0, str(HERE))
    from prompts import STYLE, sheet as sheet_block  # noqa: PLC0415
    cols, rows = (int(v) for v in sheet.get("grid", "3x2").split("x"))
    cells = []
    for it in sheet["items"]:
        txt = it["prompt"]
        if it.get("facing"):
            txt += " " + FACING_TEXT[it["facing"]]
        cells.append(txt)
    wall = sheet.get("kind") == "wall"
    if wall:
        from prompts import WALL_STYLE  # noqa: PLC0415
    parts = [WALL_STYLE if wall else STYLE]
    if spec.get("mood"):
        parts.append("ROOM MOOD: " + spec["mood"])
    parts.append(sheet_block(cells, cols, rows, sheet.get("tile", spec.get("tile", 200))))
    if sheet.get("note"):
        parts.append(sheet["note"])
    if not wall:
        parts.append(GUIDE_TEXT)
    return "\n\n".join(parts)


def run_sheet(spec: dict, sheet: dict, a) -> list[dict]:
    job = OUT / spec["name"] / sheet["name"]
    job.mkdir(parents=True, exist_ok=True)
    cols, rows = (int(v) for v in sheet.get("grid", "3x2").split("x"))
    W, H = (int(v) for v in sheet.get("size", "1536x1024").split("x"))
    tile = sheet.get("tile", spec.get("tile", 200))
    items = sheet["items"]
    guide = draw_guide(items, cols, rows, W, H, tile)
    guide.save(job / "guide.png")
    raw = job / "sheet.png"
    if a.regen or not raw.exists():
        prompt = sheet_prompt(spec, sheet)
        (job / "prompt.txt").write_text(prompt, encoding="utf-8")
        refs = ([] if sheet.get("kind") == "wall" else [job / "guide.png"]) + [HERE / r for r in sheet.get("refs", [])]
        files = [("image[]", (p.name, p.read_bytes(), "image/png")) for p in refs]
        quality = a.quality or sheet.get("quality", spec.get("quality", "medium"))
        data = {"model": MODEL, "prompt": prompt, "size": f"{W}x{H}", "quality": quality,
                "background": "transparent", "n": "1", "output_format": "png"}
        t = time.time()
        if files:
            j = post(f"{API}/images/edits", files=files, data=data)
        else:
            j = post(f"{API}/images/generations", json={**data, "n": 1})
        ns = argparse.Namespace(model=MODEL, quality=quality, size=f"{W}x{H}", count=1)
        usd = log("build", ns, j.get("usage"), time.time() - t, f"{spec['name']}/{sheet['name']}")
        raw.write_bytes(base64.b64decode(j["data"][0]["b64_json"]))
        print(f"  generated {spec['name']}/{sheet['name']} (${usd:.3f}, total ${spent():.2f}/{cap():.0f})")
    im = Image.open(raw).convert("RGBA")
    f = GAME_TILE / tile
    cw, ch = W / cols, H / rows
    results = []
    for i, it in enumerate(items):
        if not it.get("key"):
            continue
        r, c = divmod(i, cols)
        x0c, y0c = int(c * cw), int(r * ch)
        cell = clean_cell(im.crop((x0c, y0c, int((c + 1) * cw), int((r + 1) * ch))))
        box = alpha_box(cell)
        if not box:
            print(f"  ! {it['key']}: empty cell")
            continue
        obj = cell.crop(box)
        obj.save(job / f"{it['key']}{'.' + it['facing'] if it.get('facing') else ''}.raw.png")
        w_, d_ = it.get("w", 1), it.get("d", 1)
        # The model doesn't keep the guide's scale, so size comes from the spec: `width` in sprite px (2x), or
        # the full footprint width for things that fill it.
        fit = it.get("fit", "stand")
        if it.get("wall"):
            v0, v1 = it["wall"]["v"]
            m_ = it["wall"].get("margin", 0.08)
            span = it.get("span", 1)
            px = pixelize(obj, round((span - 2 * m_) * 32), round((v1 - v0) * 2), it.get("colors", spec.get("colors", 28)),
                          "none", no_trim=True)
            stem = it["key"]
            px.save(job / f"{stem}.png")
            prev = checker(px.width * 4, px.height * 4)
            prev.alpha_composite(px.resize((px.width * 4, px.height * 4), Image.NEAREST))
            prev.convert("RGB").save(job / f"{stem}.x4.png")
            results.append({"key": stem, "facing": None, "img": px, "anchor": (0, 0), "footprint": [span, 1],
                            "extra": {"wall": it["wall"], **it.get("extra", {})}, "stem": stem})
            print(f"  {stem} (wall): {px.size}")
            continue
        tw = int(it.get("width") or (w_ + d_) * 32)
        px = pixelize(obj, tw, None, it.get("colors", spec.get("colors", 28)), it.get("outline", "none"),
                      no_trim=True, sharpen=it.get("sharpen", 0.0))
        if it.get("flip"):
            px = px.transpose(Image.FLIP_LEFT_RIGHT)  # the model drew it along the other diagonal
        Wp, Hp = px.size
        nx, ny = it.get("nudge", [0, 0])
        if fit == "diamond":
            # left edge = footprint's left corner, bottom (minus pad) = its front corner
            anchor = (d_ * 32 + nx, Hp - it.get("pad", 0) - (w_ + d_) * 16 + ny)
        else:
            # bottom-centre stands `fill` of the way from the footprint centre to its front corner
            fill = it.get("fill", 0.7)
            anchor = (round(Wp / 2 - (w_ - d_) * 16) + nx, round(Hp - fill * (w_ + d_) * 8 - (w_ + d_) * 8) + ny)
        stem = f"{it['key']}{'.' + it['facing'] if it.get('facing') else ''}"
        px.save(job / f"{stem}.png")
        prev = checker(px.width * 4, px.height * 4)
        prev.alpha_composite(px.resize((px.width * 4, px.height * 4), Image.NEAREST))
        dr = ImageDraw.Draw(prev)
        dr.ellipse([anchor[0] * 4 - 5, anchor[1] * 4 - 5, anchor[0] * 4 + 5, anchor[1] * 4 + 5],
                   outline=(220, 40, 60, 255), width=2)
        prev.convert("RGB").save(job / f"{stem}.x4.png")
        results.append({"key": it["key"], "facing": it.get("facing"), "img": px, "anchor": anchor,
                        "footprint": [it.get("w", 1), it.get("d", 1)], "extra": it.get("extra", {}), "stem": stem})
        print(f"  {stem}: {px.size} anchor {anchor}")
    return results


def cmd_build(a):
    import concurrent.futures as cf  # noqa: PLC0415
    spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))
    only = set(a.only.split(",")) if a.only else None
    sheets = [s for s in spec["sheets"] if not only or s["name"] in only]
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        done = list(ex.map(lambda sh: (sh, run_sheet(spec, sh, a)), sheets))
    m = load_manifest()
    previews = []
    skip = set((a.skip or "").split(","))
    for sh, res in done:
        for r in res:
            if not a.no_publish and r["key"] not in skip:
                publish_sprite(m, r["key"], r["facing"], r["img"], r["anchor"], r["footprint"], r["extra"])
            previews.append(OUT / spec["name"] / sh["name"] / f"{r['stem']}.x4.png")
    if not a.no_publish:
        save_manifest(m)
    if previews:
        sa = argparse.Namespace(images=[str(p) for p in previews], out=str(OUT / spec["name"] / "review.jpg"),
                                cell=a.cell, cols=a.cols, nearest=False)
        cmd_sheet(sa)
    print(f"spent ${spent():.2f} of ${cap():.2f}")


# ───────────────────────────── publish ─────────────────────────────

def cmd_publish(a):
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "sprites").mkdir(exist_ok=True)
    mpath = PUBLIC / "manifest.json"
    manifest = json.loads(mpath.read_text(encoding="utf-8")) if mpath.exists() else {"scale": 2, "sprites": {}}
    fname = f"{a.key}{'.' + a.facing if a.facing else ''}.png"
    im = Image.open(a.image).convert("RGBA")
    im.save(PUBLIC / "sprites" / fname, optimize=True)
    e = manifest["sprites"].get(a.key, {})
    e["footprint"] = [int(v) for v in a.footprint.split(",")]
    e["fit"] = a.fit
    if a.pad is not None:
        e["pad"] = a.pad
    if a.lift is not None:
        e["lift"] = a.lift
    if a.facing:
        e.setdefault("facings", {})[a.facing] = fname
        e.pop("file", None)
    else:
        e["file"] = fname
    if a.note:
        e["note"] = a.note
    manifest["sprites"][a.key] = e
    manifest["sprites"] = dict(sorted(manifest["sprites"].items()))
    mpath.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"published {a.key}{' (' + a.facing + ')' if a.facing else ''} -> sprites/{fname} {im.size}")


def cmd_usage(_a):
    p = OUT / "usage.jsonl"
    rows = [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines()] if p.exists() else []
    for r in rows[-15:]:
        print(f"{r['t']} {r['kind']:9} {r['quality']:6} {r['size']:9} n={r['n']} ${call_usd(r.get('usage')):.3f} {r['label']}")
    print(f"total ${spent():.2f} of ${cap():.2f} over {len(rows)} calls")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gen")
    g.add_argument("--prompt")
    g.add_argument("--prompt-file")
    g.add_argument("--style", action="store_true", help="prepend the STYLE block from prompts.py")
    g.add_argument("--ref", action="append")
    g.add_argument("--out", required=True)
    g.add_argument("--stem", required=True)
    g.add_argument("--size", default="1536x1024")
    g.add_argument("--quality", default="medium")
    g.add_argument("--background", default="transparent")
    g.add_argument("--count", type=int, default=1)
    g.add_argument("--model", default=MODEL)
    g.set_defaults(fn=cmd_gen)
    s = sub.add_parser("sheet")
    s.add_argument("images", nargs="+")
    s.add_argument("--out", required=True)
    s.add_argument("--cell", type=int, default=320)
    s.add_argument("--cols", type=int, default=4)
    s.add_argument("--nearest", action="store_true")
    s.set_defaults(fn=cmd_sheet)
    sl = sub.add_parser("slice")
    sl.add_argument("image")
    sl.add_argument("--grid", required=True)
    sl.add_argument("--names")
    sl.add_argument("--out", required=True)
    sl.set_defaults(fn=cmd_slice)
    gd = sub.add_parser("guide")
    gd.add_argument("--grid", required=True)
    gd.add_argument("--size", default="1536x1024")
    gd.add_argument("--tile", type=int, default=200, help="floor tile width in px")
    gd.add_argument("--cells", required=True, help="w:d:h[:facing] per cell (h = height in game art px), comma-separated")
    gd.add_argument("--out", required=True)
    gd.set_defaults(fn=cmd_guide)
    p = sub.add_parser("pixelize")
    p.add_argument("image")
    p.add_argument("--width", type=int)
    p.add_argument("--height", type=int)
    p.add_argument("--colors", type=int, default=24)
    p.add_argument("--outline", default="none", choices=["none", "selout"])
    p.add_argument("--alpha-cut", type=float, default=0.5)
    p.add_argument("--sharpen", type=float, default=0.0)
    p.add_argument("--pad-outline", action="store_true")
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_pixelize)
    pb = sub.add_parser("publish")
    pb.add_argument("image")
    pb.add_argument("--key", required=True)
    pb.add_argument("--footprint", default="1,1")
    pb.add_argument("--fit", default="diamond", choices=["diamond", "stand", "wall-left", "wall-right"])
    pb.add_argument("--facing", choices=["se", "sw", "ne", "nw"])
    pb.add_argument("--pad", type=int)
    pb.add_argument("--lift", type=int)
    pb.add_argument("--note")
    pb.set_defaults(fn=cmd_publish)
    b = sub.add_parser("build")
    b.add_argument("spec")
    b.add_argument("--only", help="comma-separated sheet names")
    b.add_argument("--regen", action="store_true", help="call the API again even if a sheet exists")
    b.add_argument("--quality")
    b.add_argument("--no-publish", action="store_true")
    b.add_argument("--skip", help="comma-separated keys not to publish")
    b.add_argument("--cell", type=int, default=300)
    b.add_argument("--cols", type=int, default=6)
    b.set_defaults(fn=cmd_build)
    u = sub.add_parser("usage")
    u.set_defaults(fn=cmd_usage)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
