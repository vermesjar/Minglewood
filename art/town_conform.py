"""Conform generated building exteriors to the iso grid, then publish them.

  uv run town_conform.py [key ...] [--no-publish]
  uv run town_conform.py --day-glass       re-glaze the published buildings' windows (from their lit originals)

The model draws a building roughly on its construction guide, but the base rarely sits exactly on a 2:1
footprint diamond (a slope drifts, a sign or porch widens the image). Here each building's three base corners
— left, front and right, measured on the raw drawing — are mapped onto the exact diamond of its footprint:
x is remapped piecewise (so walls stay vertical), y gets a per-column shear (so the base slopes are exactly
2:1). Protrusions (signs, steps, plants) simply ride along. The result is pixelized at 2× density and its
anchor is the footprint's back corner, the same contract as every other piece of art (art.ts).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import studio  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE / "out" / "town-buildings"

# key: (raw base corners L, F, R in raw px, footprint (w, d))
BUILDINGS = {
    "hq": ((10, 976), (548, 1245), (938, 1050), (11, 8)),
    "cafe": ((62, 634), (545, 875), (910, 693), (8, 6)),
    "arcade": ((38, 700), (555, 910), (890, 742), (8, 5)),
    # the cabin stands in a skirt of ferns and two pines: the footprint takes all of it
    "focus": ((0, 732), (469, 967), (995, 704), (7, 8)),
    "eng": ((5, 692), (545, 962), (890, 790), (11, 7)),
    "design": ((15, 900), (465, 1125), (825, 1000), (7, 6)),
    "launch": ((5, 903), (470, 1135), (850, 950), (7, 6)),
    "events": ((15, 666), (640, 978), (935, 831), (12, 6)),
}
# Living details, as points on the RAW drawing (mapped through the same conform): chimney smoke, blinking
# beacons. Published as `emitters` on the sprite (sprite px) for the engine's ambient effects.
EMITTERS = {
    "cafe": [("smoke", (672, 12))],
    "focus": [("smoke", (318, 14))],
    "launch": [("blink", (578, 12))],
    "eng": [("blink", (787, 20))],
}
K = 2  # hi-res px per sprite px during the warp
U, V = 32 * K, 16 * K  # hi-res px per tile along screen x / y


def glow_mask(img: Image.Image) -> Image.Image:
    """The warm lit glass (windows, lanterns, marquee bulbs): drawn additively at dusk and night so a
    building's windows stay lit while the town dims."""
    a = np.array(img.convert("RGBA")).astype(int)
    al = a[..., 3]
    hsv = cv2.cvtColor(a[..., :3].astype(np.uint8).reshape(-1, 1, 3), cv2.COLOR_RGB2HSV).reshape(a.shape[0], a.shape[1], 3)
    hue, sat, val = hsv[..., 0].astype(int) * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    # lamp-lit glass is a saturated yellow-gold at full brightness (not peach stucco, not orange paint)
    cand = (al > 0) & (hue >= 33) & (hue <= 58) & (sat > 0.42) & (val > 0.84)
    # orange paint (Launch Lab's stripes) is darker than lamp-lit glass of the same hue
    cand &= ~((hue < 40) & (val < 0.93))
    # ...and it comes in small pieces (panes, lanterns, bulbs): a painted wall is one big pale region
    n, lab, st, _ = cv2.connectedComponentsWithStats(cand.astype(np.uint8), connectivity=4)
    warm = np.zeros_like(cand)
    for i in range(1, n):
        m = lab == i
        area = st[i, cv2.CC_STAT_AREA]
        msat = float(sat[m].mean())
        if (area <= 700 and msat >= 0.55) or (area <= 120 and msat >= 0.45) or msat >= 0.78:
            warm |= m
    out = np.zeros_like(a)
    out[warm] = a[warm]
    out[warm, 3] = 255
    return Image.fromarray(out.astype(np.uint8))


# Daylight glass: the painted windows glow lamp-yellow (the art was drawn lit). By day they are glass — sky
# reflected, pale at the top, deeper below, a bright diagonal glint — and the night glow mask (the lit pixels,
# drawn additively from dusk) lights them again.
GLASS_TOP = np.array([196, 222, 236])
GLASS_MID = np.array([120, 158, 190])
GLASS_LOW = np.array([70, 99, 134])
GLINT = np.array([236, 246, 250])
# small panes (a lantern's glass, an attic light): paler, clearer glass
SMALL_TOP = np.array([222, 232, 234])
SMALL_LOW = np.array([150, 170, 180])


def day_glass(img: Image.Image, glow: Image.Image) -> tuple[Image.Image, Image.Image]:
    """The building with its lit window panes glazed for daylight, and the night glow mask that lights them
    again. Panes are the glow mask's pane-shaped pieces (big enough, filling their box: not a paper lantern or a
    gilded star), grown into the warm lamplight around them, so no amber rim is left behind by day and the
    whole pane glows at night."""
    a = np.array(img.convert("RGBA")).astype(int)
    m = np.array(glow.convert("RGBA"))[..., 3] > 0
    hsv = cv2.cvtColor(a[..., :3].astype(np.uint8).reshape(-1, 1, 3), cv2.COLOR_RGB2HSV).reshape(a.shape[0], a.shape[1], 3)
    hue, sat, val = hsv[..., 0].astype(int) * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    lit = (a[..., 3] > 0) & (hue >= 22) & (hue <= 62) & (sat > 0.45) & (val > 0.5)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
    out = a.copy()
    lum = a[..., :3].mean(-1)
    night = m.copy()
    for i in range(1, n):
        x, y, w, h, area = st[i]
        if area < 24 or w < 4 or h < 6 or area / (w * h) < 0.45:
            continue
        # a big round piece is a paper lantern or a bulb, not a pane
        if area >= 200 and 0.8 <= h / w <= 1.25:
            continue
        small = area < 70
        # grow into the lamplight around the pane (it glows brightest at the top: the mask may stop short of
        # the amber lower half), inside a box a little wider and deeper than the pane
        x0, y0 = max(0, x - 2), max(0, y - 2)
        x1, y1 = min(a.shape[1], x + w + 2), min(a.shape[0], y + h + max(4, int(h * 0.8)))
        reg = lab[y0:y1, x0:x1] == i
        box_lit = lit[y0:y1, x0:x1] | reg
        for _ in range(12):
            grown = cv2.dilate(reg.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & box_lit
            if (grown == reg).all():
                break
            reg = grown
        ys, xs = np.nonzero(reg)
        gy0, gy1 = ys.min(), ys.max() + 1
        gx0, gx1 = xs.min(), xs.max() + 1
        v = (ys - gy0) / max(1, gy1 - gy0 - 1)
        u = (xs - gx0) / max(1, gx1 - gx0 - 1)
        if small:
            col = SMALL_TOP + (SMALL_LOW - SMALL_TOP) * v[:, None]
        else:
            col = np.where(v[:, None] < 0.5, GLASS_TOP + (GLASS_MID - GLASS_TOP) * (v[:, None] * 2), GLASS_MID + (GLASS_LOW - GLASS_MID) * ((v[:, None] - 0.5) * 2))
        # keep a trace of what's inside (a plant, a lamp, a sash) as light and shade in the glass
        L = lum[y0:y1, x0:x1][reg]
        col = col * (0.88 + 0.24 * (L - L.mean()) / max(1.0, L.std() * 3))[:, None]
        # a diagonal glint across the upper half, two pixels wide
        g = ((xs - gx0) + (ys - gy0) * 0.7) % 14
        glint = (g < 2) & (v < 0.62) & (u > 0.12) & (u < 0.88) & (not small)
        col[glint] = GLINT
        # ordered dither between neighbouring tones: pixel art never blends
        bayer = np.array([[0.125, 0.625], [0.875, 0.375]])
        col = col + (bayer[ys % 2, xs % 2][:, None] - 0.5) * 10
        out[ys + y0, xs + x0, :3] = np.clip(col, 0, 255).round()
        night[ys + y0, xs + x0] = True
    glow_out = np.zeros_like(a)
    glow_out[night] = a[night]
    glow_out[night, 3] = 255
    return Image.fromarray(out.astype(np.uint8)), Image.fromarray(glow_out.astype(np.uint8))


def day_glass_published():
    """Re-glaze the published building sprites in place, from their lit originals (kept beside the raw art)."""
    for k in BUILDINGS:
        pub = studio.PUBLIC / "sprites" / f"building.{k}.png"
        lit = OUT / k / f"building.{k}.lit.png"
        if not lit.exists():
            Image.open(pub).save(lit)
        glow = studio.PUBLIC / "sprites" / f"building.{k}.glow.png"
        img, night = day_glass(Image.open(lit), glow_mask(Image.open(lit)))
        img.save(pub, optimize=True)
        night.save(glow, optimize=True)
        print("glazed", pub.name)
    # the street lamp's lanterns, in every drawing: clear glass by day, lit from dusk (each drawing its own glow
    # mask and light point, as the model spec asks of a lamp drawn from several sides)
    with studio.ManifestLock():
        m = studio.load_manifest()
        e = m["sprites"].get("lamp-post", {})
        recs = e.get("facings") or ({"one": e} if e.get("file") else {})
        for f, rec in recs.items():
            pub = studio.PUBLIC / "sprites" / rec["file"]
            lit = OUT / rec["file"].replace(".png", ".lit.png")
            if not lit.exists():
                Image.open(pub).save(lit)
            img, night = day_glass(Image.open(lit), glow_mask(Image.open(lit)))
            img.save(pub, optimize=True)
            gname = rec["file"].replace(".png", ".glow.png")
            night.save(studio.PUBLIC / "sprites" / gname, optimize=True)
            ys, xs = np.nonzero(np.array(night)[..., 3] > 0)
            rec["glow"] = gname
            if len(xs):
                rec["light"] = {"x": int(round(xs.mean())), "y": int(round(ys.mean())), "r": 70}
            print("glazed", rec["file"], f, rec.get("light"))
        studio.save_manifest(m)


def conform(key: str) -> tuple[Image.Image, tuple[int, int], tuple[int, int]]:
    (lx, ly), (fx, fy), (rx, ry), (w, d) = BUILDINGS[key]
    raw = np.array(Image.open(OUT / key / f"building.{key}.raw.png").convert("RGBA"))
    h_in, w_in = raw.shape[:2]
    sl = w * U / (fx - lx)
    sr = d * U / (rx - fx)
    e = (sl + sr) / 2

    def shear(x: np.ndarray) -> np.ndarray:
        sh_l = -w * V - (ly - fy) * e
        sh_r = -d * V - (ry - fy) * e
        return np.where(x <= fx, sh_l * (fx - x) / (fx - lx), sh_r * (x - fx) / (rx - fx))

    def fwd_x(x):
        return np.where(x <= fx, (x - lx) * sl, w * U + (x - fx) * sr)

    # output bounds from the input's extent
    xs = np.array([0.0, lx, fx, rx, w_in - 1.0])
    ox = fwd_x(xs)
    top = np.min([(0 - fy) * e + shear(xs)])
    bot = np.max([(h_in - 1 - fy) * e + shear(xs)])
    pad = 4 * K
    pad_l = -ox.min() + pad
    fy_out = -top + pad
    W_out = int(np.ceil(ox.max() - ox.min() + 2 * pad))
    H_out = int(np.ceil(bot - top + 2 * pad))
    # round sizes to the sprite grid
    W_out += (-W_out) % K
    H_out += (-H_out) % K
    X, Y = np.meshgrid(np.arange(W_out, dtype=np.float32), np.arange(H_out, dtype=np.float32))
    xo = X - pad_l
    x_in = np.where(xo <= w * U, lx + xo / sl, fx + (xo - w * U) / sr).astype(np.float32)
    y_in = (fy + (Y - fy_out - shear(x_in)) / e).astype(np.float32)
    warped = cv2.remap(raw, x_in, y_in, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    hi = Image.fromarray(warped)
    px = studio.pixelize(hi, W_out // K, H_out // K, 40, "none", no_trim=True)
    back = ((pad_l + d * U) / K, (fy_out - (w + d) * V) / K)

    def to_sprite(pt):
        x, y = pt
        xo = float(fwd_x(np.array([x], float))[0]) + pad_l
        yo = fy_out + (y - fy) * e + float(shear(np.array([x], float))[0])
        return round(xo / K), round(yo / K)

    conform.points = {kind: to_sprite(pt) for kind, pt in EMITTERS.get(key, [])}  # type: ignore[attr-defined]
    conform.emitters = [{"kind": kind, "x": to_sprite(pt)[0], "y": to_sprite(pt)[1]} for kind, pt in EMITTERS.get(key, [])]  # type: ignore[attr-defined]
    return px, (round(back[0]), round(back[1])), (w, d)


def review(img: Image.Image, anchor, fp, path: Path):
    w, d = fp
    Z = 2
    big = Image.new("RGBA", (img.width * Z + 20, img.height * Z + 20), (232, 220, 198, 255))
    big.alpha_composite(img.resize((img.width * Z, img.height * Z), Image.NEAREST), (10, 10))
    dr = ImageDraw.Draw(big)
    ax, ay = anchor
    P = lambda x, y: (10 + (ax + (x - y) * 32) * Z, 10 + (ay + (x + y) * 16) * Z)  # noqa: E731
    dr.polygon([P(0, 0), P(w, 0), P(w, d), P(0, d)], outline=(0, 200, 255, 255), width=2)
    for i in range(1, w):
        dr.line([P(i, 0), P(i, d)], fill=(0, 200, 255, 90))
    for j in range(1, d):
        dr.line([P(0, j), P(w, j)], fill=(0, 200, 255, 90))
    big.convert("RGB").save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("keys", nargs="*")
    ap.add_argument("--no-publish", action="store_true")
    ap.add_argument("--day-glass", action="store_true")
    a = ap.parse_args()
    if a.day_glass:
        day_glass_published()
        return
    keys = a.keys or list(BUILDINGS)
    results = []
    for k in keys:
        img, anchor, fp = conform(k)
        img.save(OUT / k / f"building.{k}.conformed.png")
        review(img, anchor, fp, OUT / k / f"building.{k}.fit.png")
        extra = {"glow": f"building.{k}.glow.png"}
        if conform.emitters:  # type: ignore[attr-defined]
            extra["emitters"] = conform.emitters  # type: ignore[attr-defined]
        results.append((k, img, anchor, fp, extra))
        print(k, img.size, "anchor", anchor, "footprint", fp, extra.get("emitters", ""))
    if a.no_publish:
        return
    glazed = {}
    for k, img, *_ in results:
        img.save(OUT / k / f"building.{k}.lit.png")
        # published glazed for daylight; the glow mask (the lit panes) lights the windows from dusk
        glazed[k], night = day_glass(img, glow_mask(img))
        night.save(studio.PUBLIC / "sprites" / f"building.{k}.glow.png", optimize=True)
    with studio.ManifestLock():
        m = studio.load_manifest()
        for k, img, anchor, fp, extra in results:
            studio.publish_sprite(m, f"building.{k}", None, glazed[k], anchor, list(fp), extra)
        # the town's props: light and life points (sprite px)
        props = {
            "lamp-post": {"light": {"x": 25, "y": 21, "r": 70}, "glow": "lamp-post.glow.png"},
            "lighthouse": {"light": {"x": 37, "y": 42, "r": 90}, "emitters": [{"kind": "beam", "x": 37, "y": 42}]},
            "fountain": {"emitters": [{"kind": "spray", "x": 96, "y": 34}]},
        }
        for key, extra in props.items():
            if key in m["sprites"]:
                m["sprites"][key].update(extra)
        studio.save_manifest(m)
    lp = studio.PUBLIC / "sprites" / "lamp-post.png"
    if lp.exists():
        glow_mask(Image.open(lp)).save(studio.PUBLIC / "sprites" / "lamp-post.glow.png", optimize=True)
    print("published", [f"building.{k}" for k, *_ in results])


if __name__ == "__main__":
    main()
