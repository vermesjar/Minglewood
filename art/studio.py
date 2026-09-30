"""Minglewood studio — the art pipeline, driven by an art director (see ART_DIRECTION.md).

Run from art/:  uv run studio.py <command> ...

  gen       prompt (+ optional reference images) -> images (gpt-image, transparent background)
  sheet     contact sheet of images with labels, on a checkerboard (for review)
  slice     cut a grid sheet (e.g. 3x2) into one trimmed PNG per cell
  pixelize  raw render -> finished pixel sprite at exact size (quantized, hard alpha, optional sel-out)
  publish   copy a finished sprite into public/art/sprites and register it in public/art/manifest.json
  build     a spec of sheets -> every view of every piece, checked and published together
  usage     image-API spend so far vs the cap in budget.json

Every API call is logged to out/usage.jsonl with the API's own token counts. The key is never printed.

THE MODEL SPEC. Every manifest entry is a model (src/shared/models.ts, docs/furniture.md). Nothing is published
unless the model check passes (scripts/model-check.ts, run on the staged entry and images before anything is
written): every drawing its rotation needs, facing the right way, standing on its footprint (the fill rule), and a
complete declaration. studio completes what it can know (name, tags, height, base, walk, layer, a seat's use);
what it can't must be given in a `"model"` block on the spec, the sheet or the item (merged in that order):
at least {"category": "...", "rooms": ["..."]}.

JSON commands (stable, for tools such as the Design Lab; each prints ONE JSON object on stdout's last line and
exits 0 on success, 1 when the model check refuses, 2 on bad input):

  lab-generate --spec model.json [--ref img.png ...] --out DIR [--view se] [--quality medium]
      draw every view a model spec needs (or one --view), into DIR/sprites/<key>[.<facing>].png, and check it.
      model.json: a ModelSpec (key, name, category, tags, rooms, footprint, height, rotation, …) plus how to draw
      it: prompt, prompts {facing: extra}, width, fill, fit, colors, quality. Each view is drawn on the tiles it
      covers facing that way (footprintFacing); a lamp's views each get a light where the drawing glows.
      -> {"ok", "key", "usd", "views": {facing|"one": {"file", "anchor", "raw", "light"?}}, "entry", "sprites",
          "raw": {"sheet", "prompt", "guide"}, "problems"}
  check [KEY ...] [--entries entries.json --sprites DIR]
      the model check, on the catalog or on staged entries ({key: ModelSpec}, drawings in DIR first).
      -> {"ok", "checked", "problems": {key: [...]}}
  lab-publish --entries entries.json --sprites DIR [--overwrite]
      publish staged entries (with their drawings from DIR) under the manifest lock, if the model check passes.
      -> {"ok", "published": [keys], "problems"}
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import subprocess
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
    # a call priced when it was made (the old vision proposals: text-model prices, not image ones)
    if isinstance(u.get("usd"), (int, float)):
        return float(u["usd"])
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


def sheet_objects(im: Image.Image, n: int) -> list[Image.Image] | None:
    """The drawn objects on a sheet, in reading order (rows top to bottom, left to right within a row), each
    cut out by its own shape — or None when the count doesn't match n (then slice by grid cells). The model
    often ignores the requested grid (a wide piece straddles two cells), so objects are found, not assumed."""
    arr = np.array(im.convert("RGBA"))
    arr[..., 3] = np.where(arr[..., 3] < 40, 0, arr[..., 3])
    solid = (arr[..., 3] > 128).astype(np.uint8)
    k, lab, stats, cent = cv2.connectedComponentsWithStats(cv2.dilate(solid, np.ones((25, 25), np.uint8)), 8)
    if k < 2:
        return None
    areas = stats[1:, cv2.CC_STAT_AREA]
    comps = [1 + i for i, ar in enumerate(areas) if ar >= 0.06 * areas.max()]
    if len(comps) != n:
        return None
    hs = sorted(stats[c, cv2.CC_STAT_HEIGHT] for c in comps)
    tol = hs[len(hs) // 2] * 0.5
    order = sorted(comps, key=lambda c: cent[c][1])
    rows: list[list[int]] = []
    for c in order:
        if rows and abs(cent[c][1] - np.mean([cent[r][1] for r in rows[-1]])) < tol:
            rows[-1].append(c)
        else:
            rows.append([c])
    out = []
    for row in rows:
        for c in sorted(row, key=lambda c: cent[c][0]):
            one = arr.copy()
            one[..., 3] = np.where(lab == c, one[..., 3], 0)
            x, y, w, h = stats[c, :4]
            out.append(Image.fromarray(one).crop((x, y, x + w, y + h)))
    return out


def drop_specks(img: Image.Image, min_px: int = 6) -> Image.Image:
    """The furniture standard allows no stray pixels: remove bits detached from the piece smaller than min_px."""
    arr = np.array(img.convert("RGBA"))
    solid = (arr[..., 3] > 0).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(solid, connectivity=8)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < min_px:
            arr[lab == i] = 0
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


class ManifestLock:
    """Serializes manifest read-modify-write across parallel builds (a lock file created exclusively)."""

    def __init__(self):
        self.path = PUBLIC / ".manifest.lock"

    def __enter__(self):
        PUBLIC.mkdir(parents=True, exist_ok=True)
        for _ in range(600):
            try:
                self.fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                return self
            except FileExistsError:
                if time.time() - self.path.stat().st_mtime > 60:
                    self.path.unlink(missing_ok=True)
                time.sleep(0.1)
        raise SystemExit("manifest lock timed out")

    def __exit__(self, *exc):
        os.close(self.fd)
        self.path.unlink(missing_ok=True)


def load_manifest() -> dict:
    mpath = PUBLIC / "manifest.json"
    return json.loads(mpath.read_text(encoding="utf-8")) if mpath.exists() else {"scale": 2, "sprites": {}}


def write_atomic(path: Path, text: str):
    """Write a file so anything reading it alongside (the lab server, another tool, the game) sees the old
    contents or the new, never a half-written file: to a temp file beside it, then swapped in."""
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    for _ in range(40):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:  # Windows refuses while another process has it open: a moment
            time.sleep(0.025)
    os.replace(tmp, path)


def save_manifest(m: dict):
    PUBLIC.mkdir(parents=True, exist_ok=True)
    m["sprites"] = dict(sorted(m["sprites"].items()))
    write_atomic(PUBLIC / "manifest.json", json.dumps(m, indent=2) + "\n")


# Drawings staged by publish_sprite in this process and not yet written (enforce_rotation checks them).
STAGED: dict = {}


def publish_sprite(m: dict, key: str, facing: str | None, img: Image.Image, anchor, footprint, extra: dict,
                   stage: list | None = None):
    """Record a drawing in the manifest (in memory). The image is written now, or staged in `stage` to be written
    only once the whole build passes the four-rotation standard (see write_staged)."""
    (PUBLIC / "sprites").mkdir(parents=True, exist_ok=True)
    fname = f"{key}{'.' + facing if facing else ''}.png"
    if stage is None:
        img.save(PUBLIC / "sprites" / fname, optimize=True)
    else:
        stage.append((PUBLIC / "sprites" / fname, img))
        STAGED[PUBLIC / "sprites" / fname] = img
    e = m["sprites"].get(key, {})
    # the model spec's footprint is [width, depth] as the piece faces sw or ne (models.ts footprintFacing): a view
    # facing se or nw covers it turned
    e["footprint"] = list(footprint) if facing not in ("se", "nw") else [footprint[1], footprint[0]]
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
    found = None if sheet.get("slice") == "grid" else sheet_objects(im, len(items))
    for i, it in enumerate(items):
        if not it.get("key"):
            continue
        r, c = divmod(i, cols)
        x0c, y0c = int(c * cw), int(r * ch)
        cell = found[i] if found else clean_cell(im.crop((x0c, y0c, int((c + 1) * cw), int((r + 1) * ch))))
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
            # THE WALL ART STANDARD (src/shared/models.ts wallFit): drawn at exactly 2:1 against the wall, 32 px
            # per tile along it and 2 per wall unit up it, so the game paints it pixel for pixel. The slot is the
            # span less a little air at each end, and the band's height.
            v0, v1 = it["wall"]["v"]
            span = it.get("span", 1)
            bw, bh = span * 32 - 4, round((v1 - v0) * 2)
            # Fit inside the wall slot without stretching, centred; the slot is padded transparent.
            k = min(bw / obj.width, bh / obj.height)
            fitted = pixelize(obj, max(1, round(obj.width * k)), max(1, round(obj.height * k)),
                              it.get("colors", spec.get("colors", 28)), "none", no_trim=True)
            px = Image.new("RGBA", (bw, bh))
            px.paste(fitted, ((bw - fitted.width) // 2, (bh - fitted.height) // 2))
            stem = it["key"]
            px.save(job / f"{stem}.png")
            prev = checker(px.width * 4, px.height * 4)
            prev.alpha_composite(px.resize((px.width * 4, px.height * 4), Image.NEAREST))
            prev.convert("RGB").save(job / f"{stem}.x4.png")
            # its size is its drawing's: bottom where it hangs, top half its height above (no margin: it's centred)
            wall = {**{k: v for k, v in it["wall"].items() if k != "margin"}, "v": [v0, v0 + (bh // 2 if bh % 2 == 0 else bh / 2)]}
            results.append({"key": stem, "facing": None, "img": px, "anchor": (0, 0), "footprint": [span, 1],
                            "extra": {"wall": wall, **it.get("extra", {})}, "stem": stem, "rotation": "flat",
                            "model": {**spec.get("model", {}), **sheet.get("model", {}), **it.get("model", {})}})
            print(f"  {stem} (wall): {px.size}")
            continue
        # size: `width` (sprite px, 2x), or `height_px` for a turnaround whose views differ in width (a lamp's arm
        # reaching toward us or out to the side), or the full footprint width
        tw = None if it.get("height_px") else int(it.get("width") or (w_ + d_) * 32)
        px = pixelize(obj, tw, it.get("height_px"), it.get("colors", spec.get("colors", 28)), it.get("outline", "none"),
                      no_trim=True, sharpen=it.get("sharpen", 0.0))
        if it.get("flip"):
            px = px.transpose(Image.FLIP_LEFT_RIGHT)  # the model drew it along the other diagonal
        px = drop_specks(px)
        Wp, Hp = px.size
        nx, ny = it.get("nudge", [0, 0])
        if fit == "diamond":
            # left edge = footprint's left corner, bottom (minus pad) = its front corner
            anchor = (d_ * 32 + nx, Hp - it.get("pad", 0) - (w_ + d_) * 16 + ny)
        else:
            # bottom-centre stands `fill` of the way from the footprint centre to its front corner
            fill = it.get("fill", 0.7)
            anchor = (round(Wp / 2 - (w_ - d_) * 16) + nx, round(Hp - fill * (w_ + d_) * 8 - (w_ + d_) * 8) + ny)
        # a large piece stands on its footprint by THE FILL RULE (footing.ts): its anchor is worked out from the
        # drawing, not from `fill` (the model's base: 'filled' unless its "model" block says 'centred')
        if not is_small(px, w_, d_):
            base = {**spec.get("model", {}), **sheet.get("model", {}), **it.get("model", {})}.get("base", "filled")
            anchor = fill_anchor(px, (anchor[0] - nx, anchor[1] - ny), w_, d_, base)
            anchor = (anchor[0] + nx, anchor[1] + ny)
        stem = f"{it['key']}{'.' + it['facing'] if it.get('facing') else ''}"
        px.save(job / f"{stem}.png")
        prev = checker(px.width * 4, px.height * 4)
        prev.alpha_composite(px.resize((px.width * 4, px.height * 4), Image.NEAREST))
        dr = ImageDraw.Draw(prev)
        dr.ellipse([anchor[0] * 4 - 5, anchor[1] * 4 - 5, anchor[0] * 4 + 5, anchor[1] * 4 + 5],
                   outline=(220, 40, 60, 255), width=2)
        prev.convert("RGB").save(job / f"{stem}.x4.png")
        results.append({"key": it["key"], "facing": it.get("facing"), "img": px, "anchor": anchor,
                        "footprint": [it.get("w", 1), it.get("d", 1)], "extra": it.get("extra", {}), "stem": stem,
                        "also": it.get("also", []), "also_facings": it.get("also_facings", []),
                        "rotation": it.get("rotation"),
                        "model": {**spec.get("model", {}), **sheet.get("model", {}), **it.get("model", {})}})
        print(f"  {stem}: {px.size} anchor {anchor}")
    return results


def lean(img: Image.Image) -> float:
    """How far the top quarter of a drawing sits right (+) or left (−) of its centre, as a fraction of its width
    (check_facings.py's test: a seat's backrest says which way it faces)."""
    al = np.array(img.convert("RGBA"))[..., 3] > 0
    ys, xs = np.where(al)
    if not len(xs):
        return 0.0
    h = ys.max() - ys.min() + 1
    _, tx = np.where(al[ys.min(): ys.min() + max(3, h // 4)])
    return float((tx.mean() - xs.mean()) / (xs.max() - xs.min() + 1))


def orient_fronts(results: list[dict], m: dict) -> None:
    """The model sometimes draws a front view facing its mirror's way (a chair asked for facing sw, drawn facing se):
    filed as-is, the game mirrors it the wrong way round for every seat facing its partner (armchair.mustard's front
    was, and in Engineering it faced the wall while its sitter faced the table). For one-tile seats with a clear
    backrest, a front facing se leans its backrest left of centre, one facing sw right (check_facings.py's rule):
    flip any that lean the wrong way. A near-symmetric drawing (a tub chair) says nothing either way: the reviewer
    checks it against the facing arrows on the Lab's previews."""
    for r in results:
        if r.get("facing") not in ("se", "sw") or r.get("footprint") != [1, 1]:
            continue
        seat = r.get("extra", {}).get("seat") is not None or m["sprites"].get(r["key"], {}).get("seat") is not None
        if not seat:
            continue
        v = lean(r["img"])
        if abs(v) >= 0.06 and (v < 0) != (r["facing"] == "se"):
            r["img"] = r["img"].transpose(Image.FLIP_LEFT_RIGHT)
            r["anchor"] = (r["img"].width - r["anchor"][0], r["anchor"][1])
            print(f"  ! {r['key']}.{r['facing']}: front drawn facing its mirror's way; flipped (lean {v:+.2f})")


def orient_backs(results: list[dict], m: dict) -> None:
    """The model sometimes draws a back view facing the front's way (a chair's back view leaning like its front):
    published as-is, it would sit sideways to its desk. For one-tile seats, compare each back view's lean with its
    front's (normalised to se / nw: sw and ne are mirrors) and flip any that lean the wrong way."""
    fronts: dict[str, float] = {}
    for r in results:
        if r.get("facing") in ("se", "sw"):
            v = lean(r["img"])
            fronts[r["key"]] = v if r["facing"] == "se" else -v
    for r in results:
        if r.get("facing") not in ("ne", "nw") or r.get("footprint") != [1, 1]:
            continue
        seat = r.get("extra", {}).get("seat") is not None or m["sprites"].get(r["key"], {}).get("seat") is not None
        if not seat:
            continue
        front = fronts.get(r["key"])
        if front is None:
            e = m["sprites"].get(r["key"], {}).get("facings", {})
            rec, sign = (e.get("se"), 1) if e.get("se") else (e.get("sw"), -1)
            if not rec:
                continue
            front = sign * lean(Image.open(PUBLIC / "sprites" / rec["file"]))
        back = lean(r["img"]) * (1 if r["facing"] == "nw" else -1)
        if abs(front) >= 0.06 and abs(back) > 0.03 and (front < 0) == (back < 0):
            r["img"] = r["img"].transpose(Image.FLIP_LEFT_RIGHT)
            r["anchor"] = (r["img"].width - r["anchor"][0], r["anchor"][1])
            print(f"  ! {r['key']}.{r['facing']}: back view leaned like its front; flipped (lean {front:+.2f} / {back:+.2f})")


VIEW_SETS = {"mirror": ["se", "nw"], "full": ["se", "sw", "ne", "nw"]}


def expand_views(spec: dict) -> None:
    """An item with `views` ('mirror' or 'full') and no `facing` is drawn from every side it needs, in one sheet:
    front and back for 'mirror', all four for 'full'. `prompts` may give per-facing descriptions (a handed piece
    needs its details placed side by side); `rotation` defaults to the views."""
    for sh in spec.get("sheets", []):
        items = []
        for it in sh["items"]:
            views = it.get("views")
            if not views or it.get("facing"):
                items.append(it)
                continue
            for f in VIEW_SETS[views]:
                cell = {k: v for k, v in it.items() if k not in ("views", "prompts")}
                cell["facing"] = f
                cell["rotation"] = it.get("rotation", views)
                cell["prompt"] = it.get("prompts", {}).get(f, it["prompt"])
                items.append(cell)
        sh["items"] = items
        n = len(items)
        cols, rows = (int(v) for v in sh.get("grid", "3x2").split("x"))
        if cols * rows < n:
            cols = 2 if n <= 4 else 3 if n <= 6 else 4
            rows = (n + cols - 1) // cols
            sh["grid"] = f"{cols}x{rows}"


def enforce_rotation(m: dict, keys: set, rotations: dict, stage: list | None = None) -> list:
    """The four-rotation standard and the model spec (models.ts, docs/furniture.md) for every piece a publish
    touched, checked on its staged drawings (`stage`, from publish_sprite) before anything is written."""
    sys.path.insert(0, str(HERE))
    import rotation as rot  # noqa: PLC0415
    for key in sorted(keys):
        e = m["sprites"].get(key)
        if not e:
            continue
        e["rotation"] = rotations.get(key) or e.get("rotation") or rot.declared(key, e)
    # the model check covers the rotation's drawings too, on the staged images (the ones this process staged
    # with publish_sprite when the caller doesn't pass them)
    return enforce_model(m, keys, stage if stage is not None else list(STAGED.items()))


def write_staged(stage: list) -> None:
    for path, img in stage:
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, optimize=True)
        STAGED.pop(path, None)


# ───────────────────────────── the model spec ─────────────────────────────

TSX = [str(REPO / "node_modules" / "tsx" / "dist" / "cli.mjs"), "--tsconfig", str(REPO / "tsconfig.json")]


def _alpha_cols_rows(img: Image.Image):
    al = np.array(img.convert("RGBA"))[..., 3] > 0
    return al, np.where(al.any(axis=0))[0], np.where(al.any(axis=1))[0]


def is_small(img: Image.Image, w: int, d: int) -> bool:
    """footing.ts isSmall: well narrower than its footprint, so it's centred on it at runtime."""
    _, xs, _ = _alpha_cols_rows(img)
    return len(xs) > 0 and int(xs.max() - xs.min()) < (w + d) * 32 * 0.7


def measured_height(img: Image.Image, anchor, w: int, d: int) -> int:
    """model-check.ts measuredHeight: floor to top in art px (drawings are 2x)."""
    al, xs, ys = _alpha_cols_rows(img)
    if not len(ys):
        return 0
    t, b = int(ys.min()), int(ys.max())
    if is_small(img, w, d):
        band = al[round(b - (b - t) * 0.3): b + 1]
        bx = np.where(band.any(axis=0))[0]
        floor = b - (bx.max() - bx.min()) / 4
    else:
        floor = anchor[1] + 4 * (w + d)
    return max(1, round((floor - t) / 2))


def fill_anchor(img: Image.Image, anchor, w: int, d: int, base: str):
    """footing.ts fillAnchor: the anchor that makes a large piece meet the fill rule ('filled': fills its footprint
    diamond or is inset evenly and ends on its front corner; 'centred': its narrow base on the footprint centre).
    Unchanged if moving can't fix it (the model check then refuses it)."""
    al, xs, ys = _alpha_cols_rows(img)
    if not len(xs):
        return anchor
    l, r, b = int(xs.min()), int(xs.max()), int(ys.max())
    ax, ay = anchor
    dl, dr, db = ax - 32 * d - l, r - (ax + 32 * w), b - (ay + 16 * (w + d))
    if base == "filled":
        k = round((dr - dl) / 2)
        dl2, dr2 = dl + k, dr - k
        if dl2 > 6 or dr2 > 6:
            return anchor
        return (ax + k, ay + round(db - (dl2 + dr2) / 4))
    bx = np.where(al[max(0, b - 5): b + 1].any(axis=0))[0]
    bl, br = int(bx.min()), int(bx.max())
    cx, cy = ax + 16 * (w - d), ay + 8 * (w + d)
    dx = round((bl + br) / 2 - cx)
    if br - bl < (w + d) * 16:
        return (ax + dx, ay + round(b - (br - bl) / 4 - cy))
    return (ax + dx, ay + max(0, db - 4))


def base_centre(img: Image.Image):
    """footing.ts baseCentre: the centre of the base, read from the lower 30% of the silhouette."""
    al, xs, ys = _alpha_cols_rows(img)
    if not len(ys):
        return None
    t, b = int(ys.min()), int(ys.max())
    bx = np.where(al[round(b - (b - t) * 0.3): b + 1].any(axis=0))[0]
    return ((bx.min() + bx.max()) / 2, b - (bx.max() - bx.min()) / 4)


def footing_centre(img: Image.Image, anchor, w: int, d: int):
    """Where the footprint's centre falls in a drawing at runtime (art.ts): a small piece's base centre (it's
    centred there), else from its anchor."""
    if is_small(img, w, d):
        return base_centre(img)
    return (anchor[0] + 16 * (w - d), anchor[1] + 8 * (w + d))


def carry_lights(e: dict, images: dict) -> None:
    """A lamp drawn from more than one side needs its light in each drawing: carry the first drawing's to the
    others on the footprint's vertical axis (height kept, mirrored about the centre). `images`: file -> image."""
    f = e.get("facings") or {}
    if not e.get("light") or len({r["file"] for r in f.values()}) < 2:
        return
    # carried from a drawing that has its own light, else from the first (the one art.ts gives the entry's light)
    order = list(f)
    src = next((x for x in order if f[x].get("light")), order[0])
    light = f[src].get("light") or e["light"]

    def img(file):
        return images.get(file) or Image.open(PUBLIC / "sprites" / file)

    def wd(x):
        return e["footprint"] if x in ("sw", "ne") else e["footprint"][::-1]
    c0 = footing_centre(img(f[src]["file"]), f[src]["anchor"], *wd(src))
    dx, dy = light["x"] - c0[0], light["y"] - c0[1]
    for x in order:
        rec = f[x]
        if rec.get("light") or rec["file"] == f[src]["file"]:
            continue
        c = footing_centre(img(rec["file"]), rec["anchor"], *wd(x))
        rec["light"] = {"x": round(c[0] - dx), "y": round(c[1] + dy), **({"r": light["r"]} if "r" in light else {})}


def light_hint(img: Image.Image, top: float = 0.7):
    """Where a lamp's drawing glows: the centre of its brightest warm pixels (a lit shade, a lantern) in the upper
    part of the drawing (drawing px), or None."""
    a = np.array(img.convert("RGBA")).astype(float)
    m = (a[..., 3] > 0) & (a[..., 0] > 200) & (a[..., 1] > 150) & (a[..., 0] >= a[..., 2] + 30)
    m[int(a.shape[0] * top):] = False
    if m.sum() < 4:
        return None
    lum = 0.3 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2]
    ys, xs = np.where(m & (lum >= np.percentile(lum[m], 82)))
    return (round(float(xs.mean())), round(float(ys.mean())))


def humanize(key: str) -> str:
    base, *variant = key.replace("tree/", "tree-").split(".")
    words = base.replace("heirloom-", "").split("-")
    v = " ".join(x for x in variant if x not in ("a", "b", "c"))
    name = (v + " " if v else "") + " ".join(words)
    return name[:1].upper() + name[1:]


def model_tags(key: str, category: str | None) -> list[str]:
    import re  # noqa: PLC0415
    out = []
    for w in re.split(r"[./-]", key.replace("tree/", "tree.")):
        w = re.sub(r"\d+$", "", w)
        if len(w) > 1 and w not in ("the",) and w not in out:
            out.append(w)
    if key.startswith("heirloom-") and "heirloom" not in out:
        out.append("heirloom")
    if category and category not in out:
        out.append(category)
    return out


def complete_model(e: dict, key: str, given: dict, img: Image.Image | None = None, anchor=None) -> None:
    """Complete a manifest entry's model spec (src/shared/models.ts) from what the pipeline knows. `given` (a
    spec's "model" blocks) wins; what can't be known (category, rooms) must be given or already on the entry."""
    for k, v in (given or {}).items():
        if v is not None:
            e[k] = v
    wall = bool(e.get("wall"))
    if wall:
        e.setdefault("category", "wall-art")
        e.setdefault("layer", "wall")
        e.setdefault("walk", "open")
        e.setdefault("height", int(e["wall"]["v"][1] - e["wall"]["v"][0]))
    cat = e.get("category")
    e.setdefault("name", humanize(key))
    e.setdefault("tags", model_tags(key, cat))
    if not wall:
        w, d = e["footprint"]
        if img is not None:
            e.setdefault("base", "centred" if is_small(img, w, d) else "filled")
            if anchor is not None and "height" not in (given or {}):
                e["height"] = max(e.get("_h", 0), measured_height(img, anchor, w, d))
                e["_h"] = e["height"]
        e.setdefault("walk", "seat" if cat == "seating" else "open" if cat == "rug" else "blocked")
        e.setdefault("layer", "floor" if cat == "rug" else "object")
        if cat == "seating":
            e.setdefault("use", {"face": "front", "actions": ["sit"]})


def model_check(entries: dict | None = None, stage: list | None = None, sprites: Path | None = None,
                keys: list | None = None, declared_only: bool = False) -> dict:
    """Run scripts/model-check.ts: on `entries` ({key: entry}) with their staged images (`stage` from
    publish_sprite, or a `sprites` dir), or on the catalog. Returns its JSON result."""
    job = OUT / "stage" / f"{os.getpid()}-{time.time_ns()}"
    args = ["--json"]
    try:
        if entries is not None:
            job.mkdir(parents=True, exist_ok=True)
            clean = {k: {f: v for f, v in e.items() if not f.startswith("_")} for k, e in entries.items()}
            (job / "entries.json").write_text(json.dumps(clean), encoding="utf-8")
            args += ["--entries", str(job / "entries.json")]
            if stage:
                for path, img in stage:
                    dst = job / "sprites" / Path(path).relative_to(PUBLIC / "sprites")
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    img.save(dst)
                sprites = job / "sprites"
            if sprites:
                args += ["--sprites", str(sprites)]
        if declared_only:
            args.append("--declared-only")
        r = subprocess.run(["node", *TSX, str(REPO / "scripts" / "model-check.ts"), *args, *(keys or [])],
                           cwd=REPO, capture_output=True, text=True, encoding="utf-8")
        lines = [ln for ln in r.stdout.splitlines() if ln.startswith("{")]
        if not lines:
            raise SystemExit(f"model check failed to run: {r.stderr.strip()[-800:]}")
        return json.loads(lines[-1])
    finally:
        shutil.rmtree(job, ignore_errors=True)


def enforce_model(m: dict, keys: set, stage: list | None = None) -> list:
    """The model spec (models.ts) for every piece a publish touches, on its staged drawings. Without `stage` the
    drawings are looked up in the catalog."""
    entries = {k: m["sprites"][k] for k in sorted(keys) if k in m["sprites"]}
    if not entries:
        return []
    staged_imgs = {str(Path(path).relative_to(PUBLIC / "sprites")).replace("\\", "/"): img for path, img in (stage or [])}
    for e in entries.values():
        carry_lights(e, staged_imgs)
    res = model_check(entries=entries, stage=stage or [])
    problems = [f"{k}: {p_}" for k, ps in res.get("problems", {}).items() for p_ in ps]
    # a new drawing of an animated piece gets its animation points after it exists (animations.ts): the gate
    # fails it until then, but it may be published
    for p_ in [p_ for p_ in problems if "animation" in p_]:
        print("  ~", p_, "(add its animation points to src/client/engine/animations.ts)")
    return [p_ for p_ in problems if "animation" not in p_]


def cmd_build(a):
    import concurrent.futures as cf  # noqa: PLC0415
    spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))
    expand_views(spec)
    only = set(a.only.split(",")) if a.only else None
    sheets = [s for s in spec["sheets"] if not only or s["name"] in only]
    # Sheets whose references are another sheet's output (a back view drawn from its front) run second.
    later = [s for s in sheets if any(r.startswith("out/") for r in s.get("refs", []))]
    first = [s for s in sheets if s not in later]
    done = []
    for phase in (first, later):
        with cf.ThreadPoolExecutor(max_workers=4) as ex:
            done += list(ex.map(lambda sh: (sh, run_sheet(spec, sh, a)), phase))
    previews = []
    skip = set((a.skip or "").split(","))
    stage: list = []
    touched: set = set()
    rotations: dict = {}
    with ManifestLock():
        m = load_manifest()
        orient_fronts([r for _, res in done for r in res], m)
        orient_backs([r for _, res in done for r in res], m)
        for sh, res in done:
            for r in res:
                if not a.no_publish and r["key"] not in skip:
                    # `also`: the same drawing published under more keys (one back view shared by colour variants)
                    for key in [r["key"], *r.get("also", [])]:
                        publish_sprite(m, key, r["facing"], r["img"], r["anchor"], r["footprint"], r["extra"], stage)
                        # `also_facings`: a piece that looks the same from behind (round or symmetric) uses its one
                        # drawing for the back view too, so all four rotations exist
                        for f in r.get("also_facings", []):
                            publish_sprite(m, key, f, r["img"], r["anchor"], r["footprint"], r["extra"], stage)
                        touched.add(key)
                        if r.get("rotation"):
                            rotations[key] = r["rotation"]
                        complete_model(m["sprites"][key], key, r.get("model", {}), r["img"],
                                       None if m["sprites"][key].get("wall") else r["anchor"])
                previews.append(OUT / spec["name"] / sh["name"] / f"{r['stem']}.x4.png")
        if not a.no_publish:
            # Every piece this build touched must have every drawing its rotation needs, or nothing is published:
            # a piece's views are generated together (docs/furniture.md).
            for key in touched:
                m["sprites"][key].pop("_h", None)
            problems = enforce_rotation(m, touched, rotations, stage)
            if problems and a.partial:
                # a turnaround split over builds: only its missing views may be missing
                problems = [p_ for p_ in problems if "needs" not in p_ and "missing" not in p_]
            if problems:
                for p_ in problems:
                    print("  !", p_)
                raise SystemExit("refusing to publish: the pieces above break the model spec (docs/furniture.md): "
                                 "add their missing views, fix their placement, or give their \"model\" "
                                 "(category, rooms); --partial publishes one side of a turnaround at a time")
            write_staged(stage)
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
    fname = f"{a.key}{'.' + a.facing if a.facing else ''}.png"
    im = Image.open(a.image).convert("RGBA")
    # Several agents publish at once: read, change and write the manifest only while holding the lock.
    with ManifestLock():
        manifest = load_manifest()
        e = manifest["sprites"].get(a.key, {})
        e["footprint"] = [int(v) for v in a.footprint.split(",")]
        e["fit"] = a.fit
        if a.pad is not None:
            e["pad"] = a.pad
        if a.lift is not None:
            e["lift"] = a.lift
        if a.facing:
            # the client reads per-facing records as {file, anchor?} (art.ts)
            e.setdefault("facings", {})[a.facing] = {"file": fname}
            e.pop("file", None)
        else:
            e["file"] = fname
        if a.note:
            e["note"] = a.note
        if a.rotation:
            e["rotation"] = a.rotation
        manifest["sprites"][a.key] = e
        w_, d_ = e["footprint"]
        bottom = im.height - (a.pad or 0)
        anchor = (w_ * 0 + d_ * 32, bottom - (w_ + d_) * 16) if a.fit == "diamond" else \
            (im.width / 2 - (w_ - d_) * 16, bottom - (w_ + d_) * 8)
        complete_model(e, a.key, json.loads(a.model) if a.model else {}, im, None if e.get("wall") else anchor)
        e.pop("_h", None)
        # the model spec: a piece is published with every drawing its rotation needs, standing right, declared
        stage = [(PUBLIC / "sprites" / fname, im)]
        problems = enforce_rotation(manifest, {a.key}, {a.key: a.rotation} if a.rotation else {}, stage)
        if problems and a.partial:
            problems = [p_ for p_ in problems if "needs" not in p_ and "missing" not in p_]
        if problems:
            for p_ in problems:
                print("  !", p_)
            raise SystemExit("refusing to publish (see docs/furniture.md); --partial to publish one side of a turnaround")
        write_staged(stage)
        save_manifest(manifest)
    print(f"published {a.key}{' (' + a.facing + ')' if a.facing else ''} -> sprites/{fname} {im.size}")


# ───────────────────────────── JSON commands (the Design Lab) ─────────────────────────────

def emit(obj: dict, code: int = 0):
    print(json.dumps(obj))
    sys.exit(code)


VIEWS = {"radial": [None], "flat": [None], "fixed": [None], "mirror": ["se", "nw"], "full": ["se", "sw", "ne", "nw"]}
DRAW_FIELDS = ("key", "prompt", "prompts", "width", "fill", "fit", "colors", "quality", "nudge")


def cmd_lab_generate(a):
    try:
        spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))
        key, rot = spec["key"], spec["rotation"]
        w_, d_ = spec["footprint"]
        views = VIEWS[rot]
    except (OSError, KeyError, ValueError, TypeError) as ex:
        emit({"ok": False, "error": f"bad spec: {ex}"}, 2)
    if a.view:
        if a.view not in [v or "one" for v in views]:
            emit({"ok": False, "error": f"{a.view} isn't a view of a '{rot}' model"}, 2)
        views = [None if a.view == "one" else a.view]
    out = Path(a.out).resolve()
    items = []
    for f in views:
        # each view is drawn on the tiles it covers facing that way (models.ts footprintFacing)
        vw, vd = (d_, w_) if f in ("se", "nw") else (w_, d_)
        it = {"key": key, "w": vw, "d": vd, "h": spec.get("height", 40), "fit": spec.get("fit", "stand"),
              "fill": spec.get("fill", 0.7), "colors": spec.get("colors", 28),
              "prompt": " ".join(x for x in [spec.get("prompt", ""), (spec.get("prompts") or {}).get(f or "", "")] if x)}
        if spec.get("width"):
            it["width"] = spec["width"]
        if f:
            it["facing"] = f
        if rot == "flat":
            it["wall"] = spec["wall"]
            it["span"] = w_
        items.append(it)
    cols = 1 if len(items) == 1 else 2
    sheet = {"name": time.strftime("take-%Y%m%d-%H%M%S"), "grid": f"{cols}x{(len(items) + cols - 1) // cols}",
             "items": items, "refs": [str(Path(r).resolve()) for r in a.ref or []]}
    if rot == "flat":
        sheet["kind"] = "wall"
    if len(items) > 1 or a.ref:
        sheet["note"] = ("Every cell is the SAME piece seen from a different side (see each cell's facing)."
                         + (" The extra reference images show the piece or its style: match them." if a.ref else ""))
    run = {"name": f"lab/{key.replace('/', '__')}", "quality": a.quality or spec.get("quality", "medium"), "sheets": [sheet]}
    job = OUT / run["name"] / sheet["name"]
    before = spent()
    results = run_sheet(run, sheet, argparse.Namespace(regen=True, quality=run["quality"]))
    if not results:
        emit({"ok": False, "error": "the model returned no usable drawing"}, 1)
    orient_fronts(results, load_manifest())
    orient_backs(results, load_manifest())
    sprites = out / "sprites"
    lamp = spec.get("category") == "lighting" or spec.get("light") is not None
    entry = {k: v for k, v in spec.items() if k not in DRAW_FIELDS}
    entry.pop("file", None)
    entry.pop("facings", None)
    entry["fit"] = "anchor"
    views_out = {}
    for r in results:
        fname = f"{key}{'.' + r['facing'] if r['facing'] else ''}.png"
        dst = sprites / fname
        dst.parent.mkdir(parents=True, exist_ok=True)
        r["img"].save(dst)
        anchor = [int(r["anchor"][0]), int(r["anchor"][1])]
        views_out[r["facing"] or "one"] = {"file": str(dst), "anchor": anchor, "raw": str(job / f"{r['stem']}.raw.png")}
        rec = {"file": fname, "anchor": anchor}
        hint = light_hint(r["img"]) if lamp else None
        if hint:
            # where the drawing glows (its shade or lantern): each drawing carries its own light
            rec["light"] = {"x": hint[0], "y": hint[1], "r": (spec.get("light") or {}).get("r", 40)}
            views_out[r["facing"] or "one"]["light"] = rec["light"]
        if r["facing"]:
            entry.setdefault("facings", {})[r["facing"]] = rec
        else:
            entry["file"], entry["anchor"] = fname, anchor
            if hint:
                entry["light"] = rec["light"]
        complete_model(entry, key, {}, r["img"], None if rot == "flat" else anchor)
    entry.pop("_h", None)
    if rot == "flat":
        entry.pop("anchor", None)
    if lamp and entry.get("facings") and "light" in entry:
        del entry["light"]  # one per drawing instead
    res = model_check(entries={key: entry}, sprites=sprites)
    emit({"ok": res["ok"], "key": key, "usd": round(spent() - before, 4), "views": views_out, "entry": entry,
          "sprites": str(sprites), "raw": {"sheet": str(job / "sheet.png"), "prompt": str(job / "prompt.txt"),
                                           "guide": str(job / "guide.png")},
          "problems": res.get("problems", {}).get(key, [])})


def cmd_check(a):
    if a.entries:
        entries = json.loads(Path(a.entries).read_text(encoding="utf-8"))
        res = model_check(entries=entries, sprites=Path(a.sprites) if a.sprites else None)
    else:
        res = model_check(keys=a.keys)
    emit(res, 0 if res["ok"] else 1)


def cmd_lab_publish(a):
    entries = json.loads(Path(a.entries).read_text(encoding="utf-8"))
    sprites = Path(a.sprites)
    with ManifestLock():
        m = load_manifest()
        taken = [k for k in entries if k in m["sprites"] and not a.overwrite]
        if taken:
            emit({"ok": False, "error": f"already in the catalog: {', '.join(taken)} (--overwrite to replace)"}, 2)
        res = model_check(entries=entries, sprites=sprites)
        if not res["ok"]:
            emit({"ok": False, "published": [], "problems": res["problems"]}, 1)
        for key, e in entries.items():
            for rec in [e, *(e.get("facings") or {}).values()]:
                for f in (rec.get("file"), rec.get("glow")):
                    if f:
                        dst = PUBLIC / "sprites" / f
                        dst.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(sprites / f, dst)
            m["sprites"][key] = e
        save_manifest(m)
    emit({"ok": True, "published": sorted(entries), "problems": {}})


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
    pb.add_argument("--rotation", choices=["radial", "mirror", "full", "flat", "fixed"],
                    help="how the piece turns (docs/furniture.md); required for a new piece")
    pb.add_argument("--partial", action="store_true", help="allow a piece that doesn't yet have every view")
    pb.add_argument("--model", help='its model spec as JSON, e.g. \'{"category": "decor", "rooms": ["lounge"]}\'')
    pb.set_defaults(fn=cmd_publish)
    lg = sub.add_parser("lab-generate", help="draw a model spec's views (JSON out)")
    lg.add_argument("--spec", required=True)
    lg.add_argument("--ref", action="append")
    lg.add_argument("--out", required=True)
    lg.add_argument("--view", choices=["se", "sw", "ne", "nw", "one"])
    lg.add_argument("--quality", choices=["low", "medium", "high"])
    lg.set_defaults(fn=cmd_lab_generate)
    ck = sub.add_parser("check", help="the model check (JSON out)")
    ck.add_argument("keys", nargs="*")
    ck.add_argument("--entries")
    ck.add_argument("--sprites")
    ck.set_defaults(fn=cmd_check)
    lp = sub.add_parser("lab-publish", help="publish staged model entries (JSON out)")
    lp.add_argument("--entries", required=True)
    lp.add_argument("--sprites", required=True)
    lp.add_argument("--overwrite", action="store_true")
    lp.set_defaults(fn=cmd_lab_publish)
    b = sub.add_parser("build")
    b.add_argument("spec")
    b.add_argument("--only", help="comma-separated sheet names")
    b.add_argument("--regen", action="store_true", help="call the API again even if a sheet exists")
    b.add_argument("--quality")
    b.add_argument("--no-publish", action="store_true")
    b.add_argument("--skip", help="comma-separated keys not to publish")
    b.add_argument("--partial", action="store_true", help="publish pieces still missing views (the gate fails them)")
    b.add_argument("--cell", type=int, default=300)
    b.add_argument("--cols", type=int, default=6)
    b.set_defaults(fn=cmd_build)
    u = sub.add_parser("usage")
    u.set_defaults(fn=cmd_usage)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
