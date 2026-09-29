"""Character parts from image generation, on the character frame.

  uv run charkit.py hair <name> --prompt "..." [--view front|back] [--quality high]

1. Takes the base figure exported by the sprite lab (art/review/ref-base-<view>.png, 8× scale: every art
   pixel is an 8×8 block) and places it on a 1024×1536 canvas.
2. Masks the zone the part may occupy (for hair: around and above the head) and asks gpt-image to draw
   the part there in the same pixel grid and style.
3. Snaps the result back to the grid (majority colour per 8×8 block), keeps only the pixels that changed
   from the base, and turns them into a tintable tone map: '#' base, 'h' light, 's' shade, 'd' deep,
   outline pixels become the line colour automatically when the kit paints the map.

Output: out/charkit/<part>-<name>-<view>.json (rows at the hair origin) and review PNGs.
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import studio  # noqa: E402  (API, budget, logging)

HERE = Path(__file__).resolve().parent
REVIEW = HERE / "review"
OUT = HERE / "out" / "charkit"
S = 8  # art pixel → reference pixels
CANVAS = (1024, 1536)
OFFSET = (160, 288)  # where the 88×112 figure (×8) sits on the canvas
HEAD = {"front": (34, 36), "back": (34, 36)}  # head box origin on the frame (stand pose)
HAIR_ORIGIN = (-2, -5)


def reference(view: str) -> Image.Image:
    fig = Image.open(REVIEW / f"ref-base-{view}.png").convert("RGBA")
    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    canvas.paste(fig, OFFSET, fig)
    return canvas


def hair_mask(view: str, long: bool, drape: bool = False) -> Image.Image:
    """Alpha 0 where the model may paint: above and around the head (and down the sides for long hair)."""
    x0, y0 = HEAD[view]
    m = Image.new("RGBA", CANVAS, (0, 0, 0, 255))
    a = np.array(m)
    def open_rect(ax0, ay0, ax1, ay1):
        X0, Y0 = OFFSET[0] + ax0 * S, OFFSET[1] + ay0 * S
        X1, Y1 = OFFSET[0] + ax1 * S, OFFSET[1] + ay1 * S
        a[max(0, Y0):Y1, max(0, X0):X1, 3] = 0
    if view == "front":
        # above the hairline across the head; down the back of the head to the ear; a little at the temple.
        # The face (brows, eyes, nose, mouth) stays protected.
        open_rect(x0 - 8, y0 - 12, x0 + 30, y0 + 6)
        open_rect(x0 - 8, y0 + 6, x0 + 5, y0 + 17)
        open_rect(x0 + 21, y0 + 6, x0 + 30, y0 + 10)
    else:
        open_rect(x0 - 8, y0 - 12, x0 + 30, y0 + 20)
        if long:
            open_rect(x0 - 8, y0 + 20, x0 + 30, y0 + 42)  # falling over the back
    if long:
        open_rect(x0 - 8, y0 + 9, x0 + 3, y0 + 42)
        open_rect(x0 + 19, y0 + 9, x0 + 30, y0 + 42)
    if drape:
        # a head covering that frames the face and drapes under the chin over the neck and shoulders
        open_rect(x0 - 8, y0 + 6, x0 + 4, y0 + 30)
        open_rect(x0 - 6, y0 + 18, x0 + 28, y0 + 30)
        open_rect(x0 + 20, y0 + 6, x0 + 30, y0 + 30)
    return Image.fromarray(a)


TORSO = (34, 57, 58, 78)  # torso zone on the frame (stand pose): x0, y0, x1, y1


def zone_mask(kind: str, view: str, long: bool, drape: bool = False) -> Image.Image:
    if kind in ("hair", "hat"):
        return hair_mask(view, long, drape)
    m = Image.new("RGBA", CANVAS, (0, 0, 0, 255))
    a = np.array(m)
    x0, y0, x1, y1 = TORSO
    a[OFFSET[1] + y0 * S: OFFSET[1] + y1 * S, OFFSET[0] + x0 * S: OFFSET[0] + x1 * S, 3] = 0
    return Image.fromarray(a)


def zone_region(kind: str, view: str, long: bool, drape: bool = False) -> tuple[int, int, int, int]:
    x0, y0 = HEAD[view]
    if kind in ("hair", "hat"):
        return (x0 - 8, y0 - 12, x0 + 30, y0 + (42 if long else 30 if drape else 20))
    return TORSO


def zone_origin(kind: str, view: str) -> tuple[int, int]:
    x0, y0 = HEAD[view]
    if kind in ("hair", "hat"):
        return (x0 + HAIR_ORIGIN[0], y0 + HAIR_ORIGIN[1])
    return (TORSO[0], TORSO[1])


def snap_grid(img: Image.Image) -> np.ndarray:
    """Back to 88×112: per 8×8 block, the most common colour (quantized) and majority alpha."""
    a = np.array(img.convert("RGBA")).astype(np.int32)
    ox, oy = OFFSET
    out = np.zeros((112, 88, 4), np.uint8)
    for r in range(112):
        for c in range(88):
            blk = a[oy + r * S + 1: oy + (r + 1) * S - 1, ox + c * S + 1: ox + (c + 1) * S - 1].reshape(-1, 4)
            solid = blk[blk[:, 3] > 128]
            if len(solid) < len(blk) / 2:
                continue
            q = (solid[:, :3] // 12) * 12 + 6
            keys, counts = np.unique(q, axis=0, return_counts=True)
            k = keys[counts.argmax()]
            sel = solid[(q == k).all(axis=1)][:, :3]
            out[r, c, :3] = sel.mean(axis=0)
            out[r, c, 3] = 255
    return out


def base_grid(view: str) -> np.ndarray:
    return np.array(Image.open(REVIEW / f"ref-base-{view}-1x.png").convert("RGBA"))


def editable(mask: Image.Image) -> np.ndarray:
    """Which art pixels the mask left open (sampled at each 8×8 block's centre)."""
    a = np.array(mask)[..., 3]
    out = np.zeros((112, 88), bool)
    for r in range(112):
        for c in range(88):
            out[r, c] = a[OFFSET[1] + r * S + S // 2, OFFSET[0] + c * S + S // 2] == 0
    return out


def _on_gray(img: np.ndarray) -> np.ndarray:
    a = img[..., 3:4].astype(np.float32) / 255
    return img[..., :3].astype(np.float32) * a + 128 * (1 - a)


def keep_zone(kind: str, view: str, long: bool) -> np.ndarray:
    """Reference pixels (canvas coords) the edit should have left alone — used to find the figure again."""
    k = np.zeros((CANVAS[1], CANVAS[0]), bool)

    def rows(y0, y1):
        k[OFFSET[1] + y0 * S: OFFSET[1] + y1 * S, :] = True

    if kind == "top":
        rows(20, 55)  # the head
        rows(80, 112)  # the legs
    else:
        rows(80 if long else 60, 112)
    return k


def register(raw: Image.Image, ref: Image.Image, keep: np.ndarray) -> tuple[Image.Image, dict]:
    """The model sometimes redraws the whole figure scaled or shifted. Find the reference body in the raw
    (multi-scale masked template match on the parts that should be unchanged) and warp the raw back onto the
    reference grid, so the 8×8 blocks line up again."""
    import cv2

    R = np.array(raw.convert("RGBA"))
    F = np.array(ref.convert("RGBA"))
    km = keep & (F[..., 3] > 128)
    ys, xs = np.where(km)
    bx0, by0, bx1, by1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    tpl = _on_gray(F)[by0:by1, bx0:bx1]
    msk = km[by0:by1, bx0:bx1].astype(np.float32)
    rg = _on_gray(R)

    def match(img, sx, sy, k, window=None):
        w, h = max(4, round((bx1 - bx0) * sx / k)), max(4, round((by1 - by0) * sy / k))
        t = cv2.resize(tpl, (w, h), interpolation=cv2.INTER_AREA)
        m = cv2.resize(msk, (w, h), interpolation=cv2.INTER_NEAREST)
        ox = oy = 0
        if window:
            x0, y0, x1, y1 = window
            img, ox, oy = img[y0:y1, x0:x1], x0, y0
        if h >= img.shape[0] or w >= img.shape[1]:
            return float("inf"), (0, 0)
        r = cv2.matchTemplate(img, t, cv2.TM_SQDIFF, mask=m)
        mn, _, loc, _ = cv2.minMaxLoc(r)
        return mn / max(1.0, float(m.sum())), (loc[0] + ox, loc[1] + oy)

    k = 4
    small = cv2.resize(rg, None, fx=1 / k, fy=1 / k, interpolation=cv2.INTER_AREA)
    best = min((match(small, s, s, k) + (s, s) for s in np.arange(0.6, 1.62, 0.02)), key=lambda r: r[0])
    s0 = best[2]
    best = min((match(small, sx, sy, k) + (sx, sy) for sx in np.arange(s0 - 0.08, s0 + 0.09, 0.02)
                for sy in np.arange(s0 - 0.08, s0 + 0.09, 0.02)), key=lambda r: r[0])
    _, (lx, ly), sx, sy = best
    lx, ly = lx * k, ly * k
    # refine the placement at full resolution
    win = (max(0, lx - 10), max(0, ly - 10), min(CANVAS[0], lx + round((bx1 - bx0) * sx) + 10),
           min(CANVAS[1], ly + round((by1 - by0) * sy) + 10))
    _, (lx, ly) = match(rg, sx, sy, 1, win)
    M = np.array([[sx, 0, lx - bx0 * sx], [0, sy, ly - by0 * sy]], np.float32)
    out = cv2.warpAffine(R, M, CANVAS, flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP,
                         borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    fit = {"sx": round(float(sx), 3), "sy": round(float(sy), 3), "dx": int(lx - bx0), "dy": int(ly - by0)}
    return Image.fromarray(out), fit


def extract_zone(kind: str, view: str, long: bool, drape: bool) -> np.ndarray:
    """Frame pixels a part may claim after registration: generous around the head (so big styles are not
    clipped), never the face in the front view."""
    x0, y0 = HEAD[view]
    z = np.zeros((112, 88), bool)
    if kind == "top":
        tx0, ty0, tx1, ty1 = TORSO
        z[ty0:ty1, tx0:tx1] = True
        return z
    bottom = y0 + (46 if long else 32 if drape else 22 if view == "front" else 24)
    z[max(0, y0 - 28):bottom, max(0, x0 - 22):min(88, x0 + 44)] = True
    if view == "front" and not drape:
        z[y0 + 6:y0 + 24, x0 + 5:x0 + 19] = False  # brows, eyes, nose, mouth, chin
        if not long:
            z[y0 + 10:y0 + 24, x0 + 19:x0 + 24] = False  # the far cheek and nose tip
    if drape:
        z[y0 + 6:y0 + 20, x0 + 5:x0 + 20] = False  # the face stays open
    return z


def scalp(view: str, base: np.ndarray) -> np.ndarray:
    """The part of the skull any hairstyle covers. Front: above the hairline. Back: the whole back of the
    head down to the nape, leaving the ear clear — the model draws back views with a smaller, lower head
    than ours, and our skull must never show through as a bald band."""
    x0, y0 = HEAD[view]
    f = np.zeros((112, 88), bool)
    if view == "front":
        f[y0:y0 + 6, x0:x0 + 22] = base[y0:y0 + 6, x0:x0 + 22, 3] > 0
    else:
        f[y0:y0 + 15, x0:x0 + 20] = base[y0:y0 + 15, x0:x0 + 20, 3] > 0
    return f


def key_mask(grid: np.ndarray, zone: np.ndarray, key: str) -> np.ndarray:
    """Chroma-key a part drawn in a known colour: pixels of that hue, plus the dark outline pixels that
    border them. Exact whatever the model did to the figure around it."""
    import cv2

    rgb = grid[..., :3].astype(np.uint8)
    hsv = cv2.cvtColor(rgb.reshape(-1, 1, 3), cv2.COLOR_RGB2HSV).reshape(grid.shape[0], grid.shape[1], 3).astype(int)
    h, sat, val = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    lo, hi = {"teal": (150, 205), "gold": (30, 58)}[key]
    body = zone & (grid[..., 3] > 0) & (h >= lo) & (h <= hi) & (sat > 0.22) & (val > 0.18)
    dark = zone & (grid[..., 3] > 0) & (val < 0.3)
    near = cv2.dilate(body.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    part = body | (dark & near)
    # stripes, jewels and highlights inside the part's silhouette belong to it too
    closed = cv2.morphologyEx(part.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    inv = (1 - closed).astype(np.uint8)
    flood = inv.copy()
    cv2.floodFill(flood, np.zeros((inv.shape[0] + 2, inv.shape[1] + 2), np.uint8), (0, 0), 2)
    enclosed = (flood == 1) & (grid[..., 3] > 0)
    return part | (closed.astype(bool) & (grid[..., 3] > 0)) | enclosed


def to_tone_map(grid: np.ndarray, base: np.ndarray, zone: np.ndarray, capture_all: bool = False,
                fill: np.ndarray | None = None, min_frac: float = 0.03, key: str | None = None) -> dict:
    """Pixels in the zone (those that changed from the base, unless capture_all) → a placed tone map:
    {x, y, rows} in stand-pose frame coordinates. `fill` pixels are always covered, in tones carried in
    from the neighbouring drawn pixels."""
    import cv2

    changed = np.zeros(grid.shape[:2], bool)
    if key:
        changed = key_mask(grid, zone, key)
        zone = np.zeros_like(zone)  # nothing else is captured
    for y, x in zip(*np.where(zone)):
        g, b = grid[y, x], base[y, x]
        if g[3] == 0:
            continue
        if capture_all or b[3] == 0 or np.abs(g[:3].astype(int) - b[:3].astype(int)).sum() > 60:
            changed[y, x] = True
    # drop specks: keep the main piece and anything sizeable
    n, lab, stats, _ = cv2.connectedComponentsWithStats(changed.astype(np.uint8), connectivity=8)
    if n > 1:
        big = stats[1:, cv2.CC_STAT_AREA].max()
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] < max(6, big * min_frac):
                changed[lab == i] = False
    if not changed.any():
        return {"x": 0, "y": 0, "rows": []}
    lum = (grid[..., 0] * 0.3 + grid[..., 1] * 0.59 + grid[..., 2] * 0.11) / 255
    vals = lum[changed]
    inner = vals[vals > 0.12]
    ref = inner if len(inner) else vals
    med = float(np.median(ref))
    hi = float(np.percentile(ref, 85))  # highlights stay a small accent, never a patch
    tone = np.full(changed.shape, "", dtype=object)
    for y, x in zip(*np.where(changed)):
        v = lum[y, x]
        tone[y, x] = ("l" if v < 0.1 else "h" if v > med + 0.1 and v >= hi else "d" if v < med - 0.2
                      else "s" if v < med - 0.08 else "#")
    if fill is not None:
        todo = fill & ~changed
        # grow tones into the fill from the drawn pixels around it (lines and highlights don't spread)
        while todo.any():
            grew = False
            for y, x in zip(*np.where(todo)):
                near = [tone[b, a] for a, b in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                        if 0 <= a < 88 and 0 <= b < 112 and tone[b, a] and not todo[b, a]]
                if not near:
                    continue
                body = [t for t in near if t in "#sd"]
                tone[y, x] = max(set(body), key=body.count) if body else "#"
                todo[y, x] = False
                changed[y, x] = True
                grew = True
            if not grew:
                for y, x in zip(*np.where(todo)):
                    tone[y, x] = "#"
                    changed[y, x] = True
                break
    ys, xs = np.where(changed)
    x0, y0 = int(xs.min()), int(ys.min())
    rows = []
    for y in range(y0, int(ys.max()) + 1):
        row = "".join(tone[y, x] if changed[y, x] else "." for x in range(x0, int(xs.max()) + 1))
        rows.append(row.rstrip(".") or ".")
    return {"x": x0, "y": y0, "rows": rows}


def standard_zones(view: str, base: np.ndarray) -> dict:
    """The character standard for head parts (mirrors src/client/engine/sprites/avatarQa.ts): the scalp
    every hairstyle covers, and (front) the eyes and mouth nothing may cover. Frame (stand pose) px."""
    x0, y0 = HEAD[view]
    head = np.zeros((112, 88), bool)
    head[y0:y0 + 22, x0:x0 + 22] = base[y0:y0 + 22, x0:x0 + 22, 3] > 0
    scalp = np.zeros_like(head)
    rows = 6 if view == "front" else 15
    scalp[y0:y0 + rows, x0:x0 + (22 if view == "front" else 20)] = head[y0:y0 + rows, x0:x0 + (22 if view == "front" else 20)]
    feats = np.zeros_like(head)
    if view == "front":
        feats[y0 + 9:y0 + 14, 38:53] = True  # eyes (anchors 41 / 49 at y0+11) with margin
        feats[y0 + 15:y0 + 19, 44:51] = True  # mouth (anchor 47, y0+16)
    return {"head": head, "scalp": scalp, "features": feats}


def _warp(img: np.ndarray, s: float, dx: float, dy: float, pivot: tuple[float, float], k: int, interp):
    """Scale by s about pivot (art px) and shift by (dx, dy) art px, on an image at k px per art px."""
    import cv2

    px, py = pivot
    M = np.array([[s, 0, (1 - s) * px * k + dx * k], [0, s, (1 - s) * py * k + dy * k]], np.float32)
    return cv2.warpAffine(img, M, (img.shape[1], img.shape[0]), flags=interp, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def conform(part: np.ndarray, view: str, base: np.ndarray, width_target: int | None = None,
            top_target: int | None = None) -> dict:
    """Fit a head part (bool mask on the frame grid) to the standard: find the scale and offset that cover
    the scalp and keep the features clear (hair), or that match a target width and top (a hat's back view
    matched to its front). Returns {s, dx, dy, pivot}."""
    import cv2

    Z = standard_zones(view, base)
    x0, y0 = HEAD[view]
    pivot = (x0 + 11, y0 + 11)
    k = 2
    up = cv2.resize(part.astype(np.uint8), (88 * k, 112 * k), interpolation=cv2.INTER_NEAREST)
    zs = {n: cv2.resize(m.astype(np.uint8), (88 * k, 112 * k), interpolation=cv2.INTER_NEAREST).astype(bool) for n, m in Z.items()}
    scalp_n = max(1, zs["scalp"].sum())
    best = None
    # Front views keep the model's head (the face was protected, so it already matches ours): only small
    # corrections. Back views are drawn on a smaller, lower head and may need real scaling.
    if view == "front":
        ss, dxs, dys = np.arange(0.96, 1.09, 0.02), np.arange(-2, 2.5, 1), np.arange(-3, 3.5, 1)
    else:
        ss, dxs, dys = np.arange(0.86, 1.52, 0.04), np.arange(-4, 4.5, 1), np.arange(-16, 5, 1)
    for s in ss:
        for dx in dxs:
            for dy in dys:
                w = _warp(up, s, dx, dy, pivot, k, cv2.INTER_NEAREST).astype(bool)
                if not w.any():
                    continue
                if width_target is not None:
                    cols = np.where(w.any(0))[0]
                    rows = np.where(w.any(1))[0]
                    score = -abs((cols.max() - cols.min()) / k - width_target) * 3 - abs(rows.min() / k - top_target) * 3
                else:
                    cov = (w & zs["scalp"]).sum() / scalp_n
                    feat = (w & zs["features"]).sum() / (k * k)
                    score = cov * 100 - feat * 25
                score -= abs(s - 1) * 12 + (abs(dx) + abs(dy)) * 0.4  # prefer the drawing as it is
                if best is None or score > best[0]:
                    best = (score, float(s), float(dx), float(dy))
    _, s, dx, dy = best
    return {"s": round(s, 3), "dx": dx, "dy": dy, "pivot": pivot}


def apply_fit(aligned: Image.Image, part: np.ndarray, fit: dict) -> Image.Image:
    """Cut the part out of the aligned raw (8× px) and move it by the fit, so it can be re-pixelated."""
    import cv2

    a = np.array(aligned.convert("RGBA"))
    m = np.zeros(a.shape[:2], np.uint8)
    up = cv2.resize(part.astype(np.uint8), (88 * S, 112 * S), interpolation=cv2.INTER_NEAREST)
    m[OFFSET[1]:OFFSET[1] + 112 * S, OFFSET[0]:OFFSET[0] + 88 * S] = up
    a[..., 3] = np.where(m > 0, a[..., 3], 0)
    # work in frame coordinates: crop the frame area, warp there, paste back
    fr = a[OFFSET[1]:OFFSET[1] + 112 * S, OFFSET[0]:OFFSET[0] + 88 * S].copy()
    fr = _warp(fr, fit["s"], fit["dx"], fit["dy"], fit["pivot"], S, cv2.INTER_NEAREST)
    out = np.zeros_like(a)
    out[OFFSET[1]:OFFSET[1] + 112 * S, OFFSET[0]:OFFSET[0] + 88 * S] = fr
    return Image.fromarray(out)


def split_behind(placed: dict, view: str) -> tuple[dict, dict | None]:
    """Long hair in the front view: everything below the chin falls behind the shoulders. That part becomes
    its own layer (drawn before the body) and is filled solid between its outer edges, so it reads as one
    mass of hair behind the body instead of loose strands painted over it."""
    x0, y0 = HEAD[view]
    cut = y0 + 18 - placed["y"]
    rows = placed["rows"]
    if cut <= 0 or cut >= len(rows):
        return placed, None
    front, back = rows[:cut], rows[cut:]
    filled = []
    for r in back:
        idx = [i for i, ch in enumerate(r) if ch != "."]
        if len(idx) < 2:
            filled.append(r)
            continue
        a, b = idx[0], idx[-1]
        filled.append("".join(r[i] if r[i] != "." or i < a or i > b else "s" for i in range(len(r))))
    return ({"x": placed["x"], "y": placed["y"], "rows": front},
            {"x": placed["x"], "y": placed["y"] + cut, "rows": filled})


def preview(rows: list[str], path: Path, color=(90, 58, 37)):
    h, w = len(rows), max(len(r) for r in rows)
    img = Image.new("RGBA", (w * 10, h * 10), (232, 220, 198, 255))
    tone = {"#": color, "h": tuple(min(255, int(c * 1.35 + 30)) for c in color), "s": tuple(int(c * 0.7) for c in color),
            "d": tuple(int(c * 0.45) for c in color)}
    px = img.load()
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch == ".":
                continue
            for yy in range(10):
                for xx in range(10):
                    px[c * 10 + xx, r * 10 + yy] = tone.get(ch, color) + (255,)
    img.save(path)


LIBS = {k: HERE.parent / "src" / "client" / "engine" / "sprites" / f"{k}Lib.json" for k in ("hair", "hat", "top")}
LIB = LIBS["hair"]


def publish_hair(name: str, view: str, rows, kind: str = "hair"):
    """Merge a part view into the kit's library for its kind (read by avatarKit)."""
    LIB = LIBS[kind]
    lib = json.loads(LIB.read_text(encoding="utf-8")) if LIB.exists() else {}
    if rows is None:
        lib.setdefault(name, {}).pop(view, None)
    else:
        lib.setdefault(name, {})[view] = rows
    LIB.write_text(json.dumps(dict(sorted(lib.items())), indent=1) + chr(10), encoding="utf-8", newline=chr(10))


PART_TEXT = {
    "hair": "Draw the new hair on exactly the same 8×8 pixel grid, in the same crisp pixel-art style: chunky clumps, "
            "three tones (a light highlight clump toward the upper left, the base colour, a darker shade toward the "
            "lower right) and a dark 1-pixel outline around the hair silhouette.",
    "hat": "Draw the new headwear on exactly the same 8×8 pixel grid, in the same crisp pixel-art style, sitting "
           "snugly on the head (the hair is hidden under it or not drawn): three tones and a dark 1-pixel outline.",
    "top": "Redraw ONLY the torso (the masked area) wearing the new garment, on exactly the same 8×8 pixel grid and "
           "the same body shape: the garment fills the torso from the shoulders to the waist, with a neckline at the "
           "top, three tones (light toward the upper left, base, shade toward the lower right), fabric folds as "
           "single shade pixels, and a dark 1-pixel outline. Do NOT draw arms or sleeves.",
}


def cmd_hair(a):
    OUT.mkdir(parents=True, exist_ok=True)
    kind = getattr(a, "kind", "hair")
    job = f"{kind}-{a.name}-{a.view}"
    ref = reference(a.view)
    ref_path = OUT / f"{job}.ref.png"
    mask_path = OUT / f"{job}.mask.png"
    ref.save(ref_path)
    zone_mask(kind, a.view, a.long, getattr(a, "drape", False)).save(mask_path)
    style = (
        "This is a pixel-art game avatar enlarged 8×: every art pixel is an exact 8×8 square block, with a dark "
        "1-pixel outline around every part, like classic isometric social-game (hotel) avatars. "
        "Edit ONLY the transparent (masked) area. Keep everything outside it exactly as it is: the figure keeps "
        "exactly its size and position, and the head keeps exactly its size and shape. "
        + PART_TEXT[kind]
        + " No anti-aliasing, no gradients, no text. Transparent background everywhere else. "
        + ("Seen from BEHIND (the back of the head), " if a.view == "back" else "Seen in 3/4 front view (facing the viewer's lower right), ")
    )
    prompt = style + a.prompt
    (OUT / f"{job}.prompt.txt").write_text(prompt, encoding="utf-8")
    raw_path = OUT / f"{job}.raw.png"
    if a.regen or not raw_path.exists():
        files = [("image[]", (ref_path.name, ref_path.read_bytes(), "image/png")), ("mask", (mask_path.name, mask_path.read_bytes(), "image/png"))]
        data = {"model": studio.MODEL, "prompt": prompt, "size": f"{CANVAS[0]}x{CANVAS[1]}", "quality": a.quality,
                "background": "transparent", "n": "1", "output_format": "png"}
        t = time.time()
        j = studio.post(f"{studio.API}/images/edits", files=files, data=data)
        ns = argparse.Namespace(model=studio.MODEL, quality=a.quality, size=data["size"], count=1)
        usd = studio.log("charkit", ns, j.get("usage"), time.time() - t, job)
        raw_path.write_bytes(base64.b64decode(j["data"][0]["b64_json"]))
        print(f"generated {job} (${usd:.3f}, total ${studio.spent():.2f})")
    (OUT / f"{job}.meta.json").write_text(json.dumps({"kind": kind, "name": a.name, "view": a.view, "long": a.long,
                                                      "drape": getattr(a, "drape", False)}), encoding="utf-8")
    extract(job, publish=not a.no_publish)


COVERS_HAIR = {"hijab", "turban"}


def rows_mask(placed: dict) -> np.ndarray:
    m = np.zeros((112, 88), bool)
    for r, row in enumerate(placed["rows"]):
        for c, ch in enumerate(row):
            y, x = placed["y"] + r, placed["x"] + c
            if ch != "." and 0 <= y < 112 and 0 <= x < 88:
                m[y, x] = True
    return m


def refill(placed: dict, view: str, base: np.ndarray):
    """Re-express a placed map as (grid, base, zone, capture_all, fill) so to_tone_map can add the scalp fill
    while keeping the existing tones."""
    TONE = {"#": 150, "h": 200, "s": 120, "d": 80, "l": 20}
    grid = np.zeros((112, 88, 4), np.uint8)
    for r, row in enumerate(placed["rows"]):
        for c, ch in enumerate(row):
            y, x = placed["y"] + r, placed["x"] + c
            if ch != "." and 0 <= y < 112 and 0 <= x < 88:
                grid[y, x] = (TONE[ch],) * 3 + (255,)
    return grid, base, np.ones((112, 88), bool), True, scalp(view, base)


def extract(job: str, publish: bool = True):
    """Registered raw → grid → placed tone map (and publish it)."""
    meta = json.loads((OUT / f"{job}.meta.json").read_text(encoding="utf-8"))
    kind, view, long, drape = meta["kind"], meta["view"], meta["long"], meta["drape"]
    raw = Image.open(OUT / f"{job}.raw.png")
    aligned, fit = register(raw, reference(view), keep_zone(kind, view, long))
    aligned.save(OUT / f"{job}.aligned.png")
    grid = snap_grid(aligned)
    Image.fromarray(grid).resize((88 * 6, 112 * 6), Image.NEAREST).save(OUT / f"{job}.snapped.png")
    base = base_grid(view)
    zone = extract_zone(kind, view, long, drape)
    covers = kind == "hair" or (kind == "hat" and (drape or meta["name"] in COVERS_HAIR))
    min_frac = 0.25 if kind == "hat" else 0.03  # a hat is one piece; hair can be several
    key = ("gold" if meta["name"] == "crown" else "teal") if kind == "hat" else None
    placed = to_tone_map(grid, base, zone, capture_all=kind == "top", min_frac=min_frac, key=key)
    front_json = OUT / f"{kind}-{meta['name']}-front.json"
    fitted = None
    if kind in ("hair", "hat") and placed["rows"]:
        part = rows_mask(placed)
        if kind == "hat" and view == "back" and front_json.exists():
            # the same hat from behind is as wide as from the front and sits as high
            fj = json.loads(front_json.read_text(encoding="utf-8"))
            fitted = conform(part, view, base, width_target=max(len(r) for r in fj["rows"]), top_target=fj["y"])
        elif kind == "hair":
            fitted = conform(part, view, base)
        if fitted and (fitted["s"] != 1 or fitted["dx"] or fitted["dy"]):
            moved = apply_fit(aligned, part, fitted)
            moved.save(OUT / f"{job}.fitted.png")
            grid = snap_grid(moved)
            keep = np.ones((112, 88), bool)
            keep &= ~standard_zones(view, base)["features"]
            placed = to_tone_map(grid, base, keep, capture_all=key is None, min_frac=min_frac, key=key)
    if covers and placed["rows"]:
        # anything the fit could not reach is still covered (tones carried in from the drawing)
        placed = to_tone_map(*refill(placed, view, base), min_frac=min_frac)
    behind = None
    if kind == "hair" and view == "front" and long:
        placed, behind = split_behind(placed, view)
    placed["fit"] = {**fit, "conform": fitted}
    (OUT / f"{job}.json").write_text(json.dumps({**placed, "behind": behind}, indent=1), encoding="utf-8")
    if publish and placed["rows"]:
        publish_hair(meta["name"], view, {"x": placed["x"], "y": placed["y"], "rows": placed["rows"]}, kind)
        if kind == "hair" and view == "front":
            publish_hair(meta["name"], "behindFront", behind, kind)
    if placed["rows"]:
        preview(placed["rows"], OUT / f"{job}.map.png")
    print(job, "fit", fitted, f"{len(placed['rows'])} rows", flush=True)


def cmd_extract(a):
    """Re-extract every raw we already paid for (no API calls)."""
    # fronts first: back views of hats are placed from their front view
    jobs = sorted((p.name[: -len(".meta.json")] for p in OUT.glob("*.meta.json")), key=lambda j: (not j.endswith("-front"), j))
    if a.only:
        jobs = [j for j in jobs if any(o in j for o in a.only)]
    for j in jobs:
        extract(j)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    h = sub.add_parser("hair")
    h.add_argument("name")
    h.add_argument("--prompt", required=True)
    h.add_argument("--view", default="front", choices=["front", "back"])
    h.add_argument("--long", action="store_true")
    h.add_argument("--quality", default="high")
    h.add_argument("--regen", action="store_true")
    h.add_argument("--no-publish", action="store_true")
    h.set_defaults(fn=cmd_hair, kind="hair")
    for kind in ("hat", "top"):
        k = sub.add_parser(kind)
        k.add_argument("name")
        k.add_argument("--prompt", required=True)
        k.add_argument("--view", default="front", choices=["front", "back"])
        k.add_argument("--long", action="store_true")
        k.add_argument("--drape", action="store_true")
        k.add_argument("--quality", default="high")
        k.add_argument("--regen", action="store_true")
        k.add_argument("--no-publish", action="store_true")
        k.set_defaults(fn=cmd_hair, kind=kind)
    e = sub.add_parser("extract")
    e.add_argument("only", nargs="*")
    e.set_defaults(fn=cmd_extract)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
