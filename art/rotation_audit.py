"""Audit the catalog for the four-rotation standard (docs/furniture.md): a contact sheet of every piece's
drawings with measurements, to classify each piece honestly.

  uv run rotation_audit.py [--sheet]        # table + (optionally) contact sheets in art/review/rot-audit-*.png
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "public" / "art"
REVIEW = HERE / "review"
FACINGS = ("se", "sw", "ne", "nw")


def alpha(file: str) -> np.ndarray:
    return np.array(Image.open(PUBLIC / "sprites" / file).convert("RGBA"))[..., 3] > 0


def mirror_iou(a: np.ndarray) -> float:
    """How alike a silhouette is to its own mirror image (1 = symmetric), aligned on the silhouette's centre."""
    ys, xs = np.where(a)
    if not len(xs):
        return 1.0
    a = a[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
    b = a[:, ::-1]
    return float((a & b).sum() / max(1, (a | b).sum()))


def is_furniture(key: str, e: dict) -> bool:
    return not key.startswith("building.") and not e.get("wall")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", action="store_true")
    a = ap.parse_args()
    m = json.loads((PUBLIC / "manifest.json").read_text(encoding="utf-8"))["sprites"]
    use_p = HERE / "out" / "rotation-usage.json"
    use = json.loads(use_p.read_text(encoding="utf-8")) if use_p.exists() else {}
    rows = []
    for key, e in sorted(m.items()):
        if not is_furniture(key, e):
            continue
        f = e.get("facings") or {}
        drawn = sorted(f) if f else ["one"]
        files = [r["file"] for r in f.values()] if f else [e["file"]]
        iou = mirror_iou(alpha(files[0]))
        u = use.get(key, {})
        rows.append({"key": key, "drawn": drawn, "files": files, "iou": iou, "n": u.get("n", 0),
                     "facings": u.get("facings", []), "actions": u.get("actions", []), "rotation": e.get("rotation"),
                     "footprint": e.get("footprint", [1, 1])})
    for r in rows:
        print(f"{r['key']:26} {'+'.join(r['drawn']):14} iou {r['iou']:.2f} used {r['n']:3} "
              f"{','.join(r['facings']):14} {','.join(r['actions']):14} {r['rotation'] or ''}")
    print(len(rows), "pieces")
    if not a.sheet:
        return
    cell, per = 150, 40
    for page in range(0, len(rows), per):
        chunk = rows[page: page + per]
        cols = 8
        W = cols * cell * 2
        H = ((len(chunk) + cols - 1) // cols) * (cell + 34)
        sheet = Image.new("RGB", (W, H), (58, 50, 70))
        d = ImageDraw.Draw(sheet)
        for i, r in enumerate(chunk):
            x0 = (i % cols) * cell * 2
            y0 = (i // cols) * (cell + 34)
            for j, file in enumerate(r["files"][:2]):
                im = Image.open(PUBLIC / "sprites" / file).convert("RGBA")
                k = min((cell - 8) / im.width, (cell - 8) / im.height, 3)
                im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.NEAREST)
                bg = Image.new("RGBA", (cell, cell), (200, 186, 164, 255))
                bg.alpha_composite(im, ((cell - im.width) // 2, (cell - im.height) // 2))
                sheet.paste(bg.convert("RGB"), (x0 + j * cell, y0))
            d.text((x0 + 3, y0 + cell + 2), f"{r['key']}  [{'+'.join(r['drawn'])}]", fill=(255, 240, 210))
            d.text((x0 + 3, y0 + cell + 16), f"iou {r['iou']:.2f}  used {r['n']}  {','.join(r['actions'])[:24]}",
                   fill=(200, 200, 220))
        out = REVIEW / f"rot-audit-{page // per + 1}.png"
        sheet.save(out)
        print("sheet", out)


if __name__ == "__main__":
    main()
