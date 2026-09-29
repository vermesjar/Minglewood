"""Turnaround sheets for review: each piece in se, sw, ne, nw at one scale, as the game resolves them (a missing
facing is its partner mirrored), with freshly built drawings (out/<build>/) shown in place of published ones.

  uv run rotation_sheet.py OUT.png KEY [KEY ...] [--build rotations]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "public" / "art"
MIRROR = {"se": "sw", "sw": "se", "ne": "nw", "nw": "ne"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("keys", nargs="+")
    ap.add_argument("--build")
    ap.add_argument("--zoom", type=int, default=3)
    a = ap.parse_args()
    m = json.loads((PUBLIC / "manifest.json").read_text(encoding="utf-8"))["sprites"]
    rows = []
    for k in a.keys:
        e = m[k]
        recs = e.get("facings") or ({"se": {"file": e["file"]}} if e.get("file") else {})
        cells = []
        for f in ("se", "sw", "ne", "nw"):
            new = sorted((HERE / "out" / a.build).glob(f"*/{k}.{f}.png")) if a.build else []
            if new:
                cells.append((f"{f} NEW", Image.open(new[-1]).convert("RGBA")))
            elif f in recs:
                cells.append((f, Image.open(PUBLIC / "sprites" / recs[f]["file"]).convert("RGBA")))
            elif MIRROR[f] in recs:
                im = Image.open(PUBLIC / "sprites" / recs[MIRROR[f]]["file"]).convert("RGBA")
                cells.append((f"{f} (mirror)", im.transpose(Image.FLIP_LEFT_RIGHT)))
            elif e.get("file"):
                cells.append((f"{f} (same)", Image.open(PUBLIC / "sprites" / e["file"]).convert("RGBA")))
            else:
                cells.append((f"{f} missing", Image.new("RGBA", (8, 8))))
        rows.append((k, cells))
    z = a.zoom
    cw = max(i.width for _, c in rows for _, i in c) * z + 20
    ch = max(i.height for _, c in rows for _, i in c) * z + 34
    sheet = Image.new("RGB", (cw * 4 + 150, ch * len(rows)), (200, 186, 164))
    d = ImageDraw.Draw(sheet)
    for r, (k, cells) in enumerate(rows):
        d.text((6, r * ch + 6), k, fill=(40, 20, 40))
        for c, (label, im) in enumerate(cells):
            big = im.resize((im.width * z, im.height * z), Image.NEAREST)
            sheet.paste(big, (150 + c * cw + (cw - big.width) // 2, r * ch + ch - 22 - big.height), big)
            d.text((150 + c * cw + 6, r * ch + ch - 18), label, fill=(40, 20, 40))
    out = HERE / "review" / a.out
    sheet.save(out)
    print(out, sheet.size)


if __name__ == "__main__":
    main()
