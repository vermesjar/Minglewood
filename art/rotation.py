"""The four-rotation furniture standard (docs/furniture.md): every piece's declared rotation, the drawings each
rotation needs, and the checker the gate and studio.py run.

  uv run rotation.py check          # exit 1 if any entry breaks the standard (the gate runs this)
  uv run rotation.py apply          # write each entry's declared `rotation` into the manifest (under the lock)
  uv run rotation.py table          # the catalog by rotation

Rotations
  radial  one drawing, true from every side (round or amorphous: a round stool, a plant, a bush, a tree)
  mirror  a front drawing (se or sw) and a back drawing (nw or ne); the other two sides are their mirror images.
          Only for pieces left-right symmetric about the way they face (loose clutter on top may swap sides).
          A piece that looks the same from behind (a table, a planter) may use one image for front and back.
  full    four drawings, se, sw, ne and nw: anything handed (a grand piano, a cart with its wheel at one end, a
          bike, sign arrows, a portafilter or a vending machine's panel on one side)
  flat    wall art: one drawing, painted onto either wall so it reads the right way round (never mirrored)
  fixed   buildings and landmarks that are part of the map and never turn
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "public" / "art"
MIRROR = {"se": "sw", "sw": "se", "ne": "nw", "nw": "ne"}
FRONTS, BACKS = ("se", "sw"), ("ne", "nw")

# ─────────────────────────────── declarations ───────────────────────────────
# Pieces not listed here: wall art is 'flat', buildings are 'fixed', anything with one drawing must be declared
# (the checker fails an undeclared one), and two-drawing pieces default to 'mirror'.
RADIAL = {
    "bush.flower", "bush.plain", "cake-stand", "cups", "fountain", "gazebo", "heirloom-globe", "heirloom-gold",
    "heirloom-trophy", "jar", "lighthouse", "plant.a", "plant.b", "plant.pothos", "reeds", "rocket-statue", "stool",
    "stool.neon", "table-round", "table-low.side", "umbrella-table.red", "umbrella-table.teal", "flowerbed.blue",
    "flowerbed.pink", "flowerbed.red", "flowerbed.yellow",
}
FULL = {
    "espresso", "register", "heirloom-piano", "heirloom-dragonlamp", "vending-machine",
    "flower-cart", "bike-rack", "signpost", "lamp", "lamp-arc", "lantern-floor", "stanchion", "water-cooler",
}
# Pieces with a front and a back that were first drawn once: 'mirror', and the checker fails them until their
# back drawing exists (or, for BACK_SAME ones, the front is published as the back too).
MIRROR_PIECES = {
    "boat.red", "boat.yellow", "mailbox", "time-capsule", "noticeboard", "grinder", "bar-cart", "popcorn-cart",
    "lamp-post", "picnic", "table-low", "heirloom-bell",
}
FIXED_PREFIXES = ("building.",)
# Round, doubly-symmetric pieces whose back drawing is honestly the same image as their front.
BACK_SAME = {
    "book-stack", "coat-rack", "cocktail-table", "flower-stand", "fruit-bowl", "globe-stand", "ottoman.green",
    "paper-bin", "plant.fern", "plant.fiddle", "plant.ivy", "plant.snake", "planter.brass", "plinth",
    "stool.drafting", "table-high.neon", "table-side.brass", "side-table.walnut", "picnic", "table-low",
    "heirloom-bell", "balloons", "balloons.b", "balloons.c",
}
# Radial pieces must be round: their silhouette alike its own mirror image. Trees and plants are amorphous,
# so the bar is lower for nature.
RADIAL_MIN_IOU = 0.45


def declared(key: str, e: dict) -> str:
    if e.get("wall"):
        return "flat"
    if key.startswith(FIXED_PREFIXES):
        return "fixed"
    if key.startswith("tree/") or key in RADIAL:
        return "radial"
    if key in FULL:
        return "full"
    if e.get("facings") or key in MIRROR_PIECES:
        return "mirror"
    return "undeclared"


def needs(rotation: str) -> str:
    return {"radial": "one drawing", "mirror": "a front (se/sw) and a back (ne/nw) drawing",
            "full": "four drawings (se, sw, ne, nw)", "flat": "one wall drawing", "fixed": "one drawing"}[rotation]


# ─────────────────────────────── checks ───────────────────────────────

def _alpha(file: str) -> np.ndarray:
    return np.array(Image.open(PUBLIC / "sprites" / file).convert("RGBA"))[..., 3] > 0


def _rgba(file: str) -> np.ndarray:
    return np.array(Image.open(PUBLIC / "sprites" / file).convert("RGBA")).astype(int)


def mirror_iou(a: np.ndarray) -> float:
    ys, xs = np.where(a)
    if not len(xs):
        return 1.0
    a = a[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
    b = a[:, ::-1]
    return float((a & b).sum() / max(1, (a | b).sum()))


def _same(a: str, b: str) -> bool:
    x, y = _rgba(a), _rgba(b)
    return x.shape == y.shape and float(np.abs(x - y).mean()) < 1


def _mirrored(a: str, b: str) -> bool:
    x, y = _rgba(a), _rgba(b)
    return x.shape == y.shape and float(np.abs(x - y[:, ::-1]).mean()) < 1


def check_entry(key: str, e: dict, staged: bool = False) -> list[str]:
    """What's wrong with one manifest entry under the standard (empty = fine). `staged`: its images may not be
    written yet (studio checks a build before writing it), so only the declared drawings are checked, not pixels."""
    rot = e.get("rotation")
    if staged:
        return _check_records(key, e, rot or declared(key, e))
    want = declared(key, e)
    out = []
    if rot is None:
        out.append(f"no `rotation` declared (it should be '{want}')")
        rot = want
    elif want != "undeclared" and rot != want:
        out.append(f"declared '{rot}' but the standard's table says '{want}'")
    if rot == "undeclared":
        return [f"one drawing and no declared rotation: declare it radial (round) or give it the drawings it needs"]
    f = e.get("facings") or {}
    files = {k: v["file"] for k, v in f.items()}
    for k, fl in files.items():
        if not (PUBLIC / "sprites" / fl).exists():
            out.append(f"{k} drawing {fl} is missing")
    if out and any("missing" in o for o in out):
        return out
    if rot in ("flat", "fixed"):
        return out
    if rot == "radial":
        fl = e.get("file") or (next(iter(files.values())) if files else None)
        if not fl:
            return out + ["radial but no drawing"]
        if files and len({*files.values()}) > 1:
            out.append("radial pieces have one drawing, this has several")
        iou = mirror_iou(_alpha(fl))
        if iou < RADIAL_MIN_IOU and not key.startswith("tree/"):
            out.append(f"declared radial but its silhouette isn't round (mirror IoU {iou:.2f} < {RADIAL_MIN_IOU})")
        return out
    fronts = [x for x in FRONTS if x in files]
    backs = [x for x in BACKS if x in files]
    if rot == "mirror":
        if not fronts or not backs:
            out.append(f"'mirror' needs {needs('mirror')}; it has {sorted(files) or ['one drawing']}")
            return out
        fr, bk = files[fronts[0]], files[backs[0]]
        if _same(fr, bk) and key not in BACK_SAME:
            out.append(f"its back drawing is a copy of its front ({bk}); draw the back, or list it as looking the same from behind")
        return out
    if rot == "full":
        missing = [x for x in ("se", "sw", "ne", "nw") if x not in files]
        if missing:
            out.append(f"'full' needs {needs('full')}; missing {missing}")
            return out
        # four real drawings: no side may be a copy or a mirror-copy of its partner (that would be 'mirror')
        for a, b in (("se", "sw"), ("ne", "nw")):
            if _same(files[a], files[b]) or _mirrored(files[a], files[b]):
                out.append(f"{a} and {b} are the same drawing (mirrored or not): a 'full' piece needs both sides drawn")
            # the two sides of a turnaround face opposite ways: a drawing that leans like its partner was drawn
            # facing the wrong way round
            la, lb = lean(files[a]), lean(files[b])
            if abs(la) >= 0.08 and abs(lb) >= 0.08 and (la < 0) == (lb < 0):
                out.append(f"{a} and {b} lean the same way ({la:+.2f} / {lb:+.2f}): one of them faces the wrong way")
    return out


def lean(file: str) -> float:
    """How far the top quarter of a drawing sits right (+) or left (−) of its centre, as a fraction of its width."""
    al = _alpha(file)
    ys, xs = np.where(al)
    if not len(xs):
        return 0.0
    h = ys.max() - ys.min() + 1
    _, tx = np.where(al[ys.min(): ys.min() + max(3, h // 4)])
    return float((tx.mean() - xs.mean()) / (xs.max() - xs.min() + 1))


def _check_records(key: str, e: dict, rot: str) -> list[str]:
    """The drawings a rotation needs are declared (no pixel checks)."""
    files = set((e.get("facings") or {}).keys())
    if rot in ("flat", "fixed", "radial"):
        return []
    if rot == "undeclared":
        return ["one drawing and no declared rotation"]
    if rot == "mirror" and not (files & set(FRONTS) and files & set(BACKS)):
        return [f"'mirror' needs {needs('mirror')}; it has {sorted(files) or ['one drawing']}"]
    if rot == "full" and not {"se", "sw", "ne", "nw"} <= files:
        return [f"'full' needs {needs('full')}; missing {sorted({'se', 'sw', 'ne', 'nw'} - files)}"]
    return []


def check_manifest(m: dict | None = None) -> list[str]:
    m = m or json.loads((PUBLIC / "manifest.json").read_text(encoding="utf-8"))
    problems = []
    for key, e in sorted(m["sprites"].items()):
        for p in check_entry(key, e):
            problems.append(f"{key}: {p}")
    return problems


def apply():
    sys.path.insert(0, str(HERE))
    import studio  # noqa: PLC0415
    with studio.ManifestLock():
        m = studio.load_manifest()
        for key, e in m["sprites"].items():
            rot = declared(key, e)
            if rot != "undeclared":
                e["rotation"] = rot
        studio.save_manifest(m)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "apply":
        apply()
        print("rotation declared on every classified entry")
        return 0
    m = json.loads((PUBLIC / "manifest.json").read_text(encoding="utf-8"))
    if cmd == "table":
        from collections import Counter  # noqa: PLC0415
        c = Counter(e.get("rotation", "undeclared") for e in m["sprites"].values())
        for k, v in c.most_common():
            print(f"{v:4} {k}")
        return 0
    problems = check_manifest(m)
    for p in problems:
        print("  !", p)
    n = len(m["sprites"])
    print(f"{n} catalog entries, {len(problems)} breaking the four-rotation standard (docs/furniture.md)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
