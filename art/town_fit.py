"""Seat the town's props on their footprints by the furniture standard (src/client/engine/sprites/footing.ts).

  uv run town_fit.py

Every prop's base is read from its drawing exactly as footing.ts reads it (the lower 30 % of the silhouette:
its width is the base diamond's width, its lowest pixel the diamond's front corner, so the base centre is a
quarter of that width above it) and the anchor is set so that centre lands on the footprint's centre. Props
drawn wider than a tile get an honest footprint (a moored rowboat, a picnic set with benches, a flower cart
and the lighthouse on its rocks take 2×2). Updates public/art/manifest.json under the studio lock.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import studio  # noqa: E402

HERE = Path(__file__).resolve().parent
SPRITES = studio.PUBLIC / "sprites"
# key -> footprint (w, d); every prop in town-props.json that stands on the ground
PROPS = {
    "tree/pine.a": (1, 1), "tree/pine.b": (1, 1), "tree/round.a": (1, 1), "tree/round.b": (1, 1),
    "tree/birch.a": (1, 1), "tree/birch.b": (1, 1), "tree/oak-big": (3, 3),
    "lamp-post": (1, 1), "signpost": (1, 1), "mailbox": (1, 1), "bike-rack": (1, 1), "noticeboard": (1, 1),
    "umbrella-table.red": (1, 1), "umbrella-table.teal": (1, 1), "reeds": (1, 1),
    "bush.plain": (1, 1), "bush.flower": (1, 1), "rocket-statue": (1, 1),
    "boat.red": (2, 2), "boat.yellow": (2, 2), "picnic": (2, 2), "flower-cart": (2, 2), "lighthouse": (2, 2),
}
# drawn wider than their new footprint: re-pixelize from the raw generation at this sprite width
RESIZE = {"picnic": ("leisure", 124), "flower-cart": ("park", 124), "tree/oak-big": ("landmarks", 196)}


def base_centre(img: np.ndarray) -> tuple[float, float]:
    """footing.ts baseCentre, exactly."""
    a = img[..., 3] > 0
    ys, xs = np.where(a)
    t, b = ys.min(), ys.max()
    top = round(b - (b - t) * 0.3)
    band = a[top:b + 1]
    cols = np.where(band.any(0))[0]
    l, r = cols.min(), cols.max()
    return (l + r) / 2, b - (r - l) / 4


def contact(img: np.ndarray, w: int, d: int) -> tuple[float, float]:
    """Where the piece meets the ground. A narrow base (a trunk, a post, a keel: its bottom rows narrower than
    half the footprint) meets it at the middle of its very bottom rows; anything wider stands on its base
    diamond (footing.ts baseCentre). Mirrors scripts/furniture-review.ts."""
    a = img[..., 3] > 0
    ys, _ = np.where(a)
    b = ys.max()
    cols = np.where(a[max(0, b - 5):b + 1].any(0))[0]
    bl, br = cols.min(), cols.max()
    if br - bl < (w + d) * 32 * 0.5:
        return (bl + br) / 2, b - (br - bl) / 4
    return base_centre(img)


def main():
    fitted = {}
    for key, (w, d) in PROPS.items():
        if key in RESIZE:
            sheet, width = RESIZE[key]
            raw = Image.open(HERE / "out" / "town-props" / sheet / f"{key}.raw.png")
            img = studio.pixelize(raw, width, None, 32, "none", no_trim=True)
            img.save(SPRITES / f"{key}.png", optimize=True)
        img = np.array(Image.open(SPRITES / f"{key}.png").convert("RGBA"))
        bx, by = contact(img, w, d)
        # footprint centre from its back vertex, 2x density: (16 (w - d), 8 (w + d))
        ax, ay = round(bx - 16 * (w - d)), round(by - 8 * (w + d))
        fitted[key] = ([ax, ay], [w, d])
        print(f"{key:22} {img.shape[1]:>3}x{img.shape[0]:<3} footprint {w}x{d} anchor ({ax}, {ay})")
    with studio.ManifestLock():
        m = studio.load_manifest()
        for key, (anchor, fp) in fitted.items():
            e = m["sprites"].get(key)
            if not e:
                print("  ! not in manifest:", key)
                continue
            e["anchor"] = anchor
            e["footprint"] = fp
            e["fit"] = "anchor"
        studio.save_manifest(m)
    print("updated", len(fitted))


if __name__ == "__main__":
    main()
