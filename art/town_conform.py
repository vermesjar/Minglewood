"""Conform generated building exteriors to the iso grid, then publish them.

  uv run town_conform.py [key ...] [--no-publish]

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
    warm = (al > 0) & (hue >= 34) & (hue <= 58) & (sat > 0.42) & (val > 0.86)
    out = np.zeros_like(a)
    out[warm] = a[warm]
    out[warm, 3] = 255
    return Image.fromarray(out.astype(np.uint8))


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
    a = ap.parse_args()
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
    for k, img, *_ in results:
        glow_mask(img).save(studio.PUBLIC / "sprites" / f"building.{k}.glow.png", optimize=True)
    with studio.ManifestLock():
        m = studio.load_manifest()
        for k, img, anchor, fp, extra in results:
            studio.publish_sprite(m, f"building.{k}", None, img, anchor, list(fp), extra)
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
