"""Regenerate the catalog's seats to THE SEATING TYPES (prompts.py SEAT_FAMILIES) and install them.

  uv run regen_seats.py KEY [KEY ...]      draw the seats named (or `all`), install their drawings and entries
  uv run regen_seats.py KEY --dry          write the specs only (art/out/regen/<key>/spec.json), draw nothing

For each seat: a spec from its manifest entry (footprint, height, seat height, how it's sat in, backrest, arms, the
drawing's width so the scale holds), its current front drawing as the look reference, drawn through the Lab's own
pipeline (`studio.py lab-generate`: the construction guide with the cushion plane, both views on one sheet, the facing
checks). Its new drawings replace the old under public/art/sprites, its manifest entry keeps its name, tags, rooms,
category and seat profile and takes the new drawings' files, anchors, height and base. The seat's model must then be
refitted from scratch: `node --no-maglev --import tsx scripts/seat-model.ts --fit KEY --force`.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

import studio

HERE = Path(__file__).resolve().parent
OUT = HERE / "out" / "regen"
KEEP = ("name", "category", "tags", "rooms", "themes", "seat", "sitStyle", "backrest", "arms", "use", "walk", "layer")


def ink_width(path: Path) -> int:
    im = Image.open(path).convert("RGBA")
    box = im.getbbox()
    return (box[2] - box[0]) if box else im.width


def front_ref(e: dict) -> Path | None:
    """The seat's current front drawing (its raw generation if kept, else the sprite), for the look."""
    rec = (e.get("facings") or {}).get("se") or (e.get("facings") or {}).get("sw") or {"file": e.get("file")}
    if not rec.get("file"):
        return None
    stem = rec["file"][:-4]
    for raw in sorted(HERE.glob(f"out/*/*/{stem}.raw.png")):
        return raw
    p = studio.PUBLIC / "sprites" / rec["file"]
    return p if p.exists() else None


def spec_for(key: str, e: dict) -> dict:
    fam = studio.seat_family(key)
    rec = (e.get("facings") or {}).get("se") or (e.get("facings") or {}).get("sw") or {"file": e.get("file")}
    width = ink_width(studio.PUBLIC / "sprites" / rec["file"]) if rec.get("file") else None
    spec = {
        "key": key,
        "name": e.get("name", studio.humanize(key)),
        "category": "seating",
        "rotation": e.get("rotation", "mirror"),
        "footprint": list(e["footprint"]),
        "height": e.get("height", 30),
        "fit": "stand",
        "fill": 0.5 if e.get("base") == "centred" else 0.7,
        "colors": 28,
        "seat": e["seat"],
        "sitStyle": e.get("sitStyle", "chair"),
        "backrest": bool(e.get("backrest")),
        "arms": bool(e.get("arms")),
        "quality": "medium",
        "prompt": f"{e.get('name', studio.humanize(key))}: the exact piece in the first reference image — its colours, "
                  f"materials, upholstery and proportions — redrawn to the construction guide as a {fam}.",
    }
    if width:
        spec["width"] = width
    if fam in ("stool", "ottoman") and spec["rotation"] == "radial":
        spec["prompt"] += " Seen from the front corner; it looks the same from every side."
    return spec


def install(key: str, res: dict, m: dict) -> None:
    """The new drawings under public/art/sprites and the entry updated in the manifest (under its lock)."""
    e = dict(m["sprites"][key])
    new = res["entry"]
    old_files = {r["file"] for r in [e, *(e.get("facings") or {}).values()] if r.get("file")}
    for k in ("file", "anchor", "facings", "height", "base", "fit"):
        e.pop(k, None)
    for k in ("file", "anchor", "facings", "height", "base", "fit"):
        if k in new:
            e[k] = new[k]
    for k in KEEP:
        if k in m["sprites"][key]:
            e[k] = m["sprites"][key][k]
    new_files = {r["file"] for r in [e, *(e.get("facings") or {}).values()] if r.get("file")}
    sprites = Path(res["sprites"])
    for f in new_files:
        shutil.copyfile(sprites / f, studio.PUBLIC / "sprites" / f)
    for f in old_files - new_files:
        (studio.PUBLIC / "sprites" / f).unlink(missing_ok=True)
    m["sprites"][key] = e


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry" in sys.argv
    m = studio.load_manifest()
    keys = sorted(k for k, e in m["sprites"].items() if e.get("seat") is not None) if args == ["all"] else args
    results: dict[str, dict] = {}
    for key in keys:
        e = m["sprites"][key]
        spec = spec_for(key, e)
        d = OUT / key
        d.mkdir(parents=True, exist_ok=True)
        (d / "spec.json").write_text(json.dumps(spec, indent=2), encoding="utf-8")
        ref = front_ref(e)
        if dry:
            print(f"{key}: spec written (ref {ref})")
            continue
        cmd = ["uv", "run", "studio.py", "lab-generate", "--spec", str(d / "spec.json"), "--out", str(d)]
        if ref:
            cmd += ["--ref", str(ref)]
        r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True)
        line = next((ln for ln in reversed(r.stdout.splitlines()) if ln.startswith("{")), None)
        if not line:
            print(f"{key}: FAILED\n{r.stdout[-800:]}\n{r.stderr[-800:]}")
            continue
        res = json.loads(line)
        results[key] = res
        print(f"{key}: {'ok' if res.get('ok') else 'CHECK FAILED'} ${res.get('usd', 0):.3f} "
              f"{' '.join(f'{f}:{v['anchor']}' for f, v in res.get('views', {}).items())} {res.get('problems') or ''}")
    if dry:
        return 0
    with studio.ManifestLock():
        m = studio.load_manifest()
        for key, res in results.items():
            if res.get("entry"):
                install(key, res, m)
        studio.save_manifest(m)
    print(f"installed {len(results)}: {', '.join(sorted(results))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
