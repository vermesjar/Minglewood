"""Exercise Design Lab staging and automatic compilation with renamed existing art.

No image generation, manual rig, published catalog mutation, or paid API call.
Run: art/.venv/Scripts/python.exe scripts/seat-lab-check.py
"""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "art"))
import designlab

manifest = json.loads((ROOT / "public/art/manifest.json").read_text(encoding="utf-8"))["sprites"]
report = []
for index, key in enumerate(["armchair.green", "beanbag.purple", "bench.navy", "chair.cafe", "couch.green", "heirloom-throne", "ottoman.green", "stool.neon"]):
    entry = manifest[key]
    renamed = f"audit-user-piece-{index}"
    directory = ROOT / "art/review/designlab-seating" / renamed
    directory.mkdir(parents=True, exist_ok=True)
    furniture = {**{k: entry[k] for k in ["footprint", "height", "seat", "sitStyle", "seatKind", "rotation", "backrest", "arms"] if k in entry},
                 "category": "seating", "name": renamed, "rooms": ["lounge"], "tags": ["audit"], "layer": "object"}
    views = {}
    for facing, drawing in entry.get("facings", {"one": entry}).items():
        filename = f"{facing}.png"
        shutil.copyfile(ROOT / "public/art/sprites" / drawing["file"], directory / filename)
        views[facing] = {"file": filename, "anchor": drawing["anchor"], "nudge": [0, 0], "take": 1, "accepted": True}
    draft = {"id": renamed, "key": renamed, "title": renamed, "furniture": furniture, "views": views}
    staged, _ = designlab.stage(directory, draft)
    problems = designlab.model_check(directory, draft, staged)
    assert "seatModel" in draft["furniture"], key
    assert not draft["furniture"]["seatModel"]["model"].get("views"), key
    report.append({"source": key, "renamed": renamed, "problems": problems})
    print(f"{key} -> {renamed}: {problems or 'passed'}", flush=True)
(ROOT / "art/review/designlab-seating/report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
assert all(not row["problems"] for row in report), report
