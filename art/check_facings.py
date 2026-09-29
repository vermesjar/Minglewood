"""Back views must face the opposite way to their fronts.

  uv run check_facings.py

For one-tile seats with a backrest (chairs, armchairs, thrones), the front drawing ('se') has its
backrest's top left of the piece's centre and the back drawing ('nw') has it right of centre. A back view whose
top leans the same way as its front was drawn facing ne and mislabelled nw: mirrored for 'ne' it then faces nw,
and the chair sits sideways to its desk. Exits 1 if any piece fails.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

PUBLIC = Path(__file__).resolve().parent.parent / "public" / "art"


def lean(file: str) -> float:
    """How far the top quarter of the drawing sits right (+) or left (−) of its centre, as a fraction of its width."""
    a = np.array(Image.open(PUBLIC / "sprites" / file).convert("RGBA"))[..., 3] > 0
    ys, xs = np.where(a)
    h = ys.max() - ys.min() + 1
    top = a[ys.min(): ys.min() + max(3, h // 4)]
    _, tx = np.where(top)
    return float((tx.mean() - xs.mean()) / (xs.max() - xs.min() + 1))


# Seats that have a back or a hump (so their drawing says which way the sitter faces), whatever their silhouette.
BACKED = {"chair", "armchair", "couch", "sofa", "bench", "throne", "heirloom-throne", "beanbag"}


def symmetry(file: str) -> float:
    """How closely the upper half of a drawing's silhouette (seat and backrest, not the legs, which splay in
    perspective) matches its own mirror image: intersection over union, 1 = symmetric."""
    a = np.array(Image.open(PUBLIC / "sprites" / file).convert("RGBA"))[..., 3] > 0
    ys, xs = np.where(a)
    a = a[ys.min(): ys.min() + (ys.max() - ys.min() + 1) // 2, xs.min(): xs.max() + 1]
    b = a[:, ::-1]
    return float((a & b).sum() / max(1, (a | b).sum()))


def main() -> int:
    sprites = json.loads((PUBLIC / "manifest.json").read_text(encoding="utf-8"))["sprites"]
    bad = []
    checked = 0
    # A seat drawn once serves every facing, so it must look the same from every side (round stools, ottomans).
    # Anything with a back or a hump needs its own back view.
    for key, e in sprites.items():
        if e.get("seat") is None or e.get("facings") or not e.get("file"):
            continue
        sym = symmetry(e["file"])
        checked += 1
        if key.split(".")[0] in BACKED:
            bad.append(f"{key}: a seat with a back (or a hump) drawn once for every facing; give it facings {{se, nw}}")
        elif sym < 0.9:
            bad.append(f"{key}: one drawing for every facing, but it isn't symmetric (IoU {sym:.2f}); give it facings {{se, nw}}")
    for key, e in sprites.items():
        f = e.get("facings") or {}
        # seats: their backrest is what says which way they face (props with one drawing for both views skip)
        if e.get("seat") is None or e.get("footprint", [1, 1]) != [1, 1] or "se" not in f or "nw" not in f:
            continue
        front, back = lean(f["se"]["file"]), lean(f["nw"]["file"])
        if abs(front) < 0.06:  # no clear backrest to judge by (plants, tables, stools)
            continue
        checked += 1
        if (front < 0) == (back < 0) and abs(back) > 0.03:
            bad.append(f"{key}: back view '{f['nw']['file']}' faces the same way as its front (lean {front:+.2f} / {back:+.2f})")
    for b in bad:
        print("  !", b)
    print(f"{checked} directional piece(s) checked, {len(bad)} with back views facing the wrong way")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
