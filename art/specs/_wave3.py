"""One-off: wave-3 additions (Launch workshop, Lantern Hall bar cart). Idempotent."""
import json
from pathlib import Path

HERE = Path(__file__).parent


def load(n):
    return json.loads((HERE / f"{n}.json").read_text(encoding="utf-8"))


def save(n, s):
    (HERE / f"{n}.json").write_text(json.dumps(s, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


s = load("launch")
if not any(sh["name"] == "workshop" for sh in s["sheets"]):
    s["sheets"].append({"name": "workshop", "grid": "2x2", "items": [
        {"key": "workbench", "facing": "sw", "w": 2, "d": 1, "h": 30, "width": 96, "fit": "diamond",
         "prompt": "A sturdy maker's workbench two tiles long in pale plywood on navy steel legs: a small 3D printer printing a white rocket fin, a soldering iron in its stand, a green circuit board, a bench vise, a tape measure and a few tools laid out neatly, a spool of orange filament. Its working side faces along the red arrow."},
        {"key": "workbench", "facing": "ne", "w": 2, "d": 1, "h": 30, "width": 96, "fit": "diamond",
         "prompt": "The SAME plywood-and-navy-steel maker's workbench seen from behind: a plain plywood back panel with a power strip, the back of the 3D printer and the orange filament spool on top."},
        {"key": "parts-rack", "facing": "sw", "w": 1, "d": 1, "h": 50, "width": 60, "fit": "diamond",
         "prompt": "A tall navy steel shelving rack with four shelves of clear storage bins holding bolts and parts, spare white rocket fins and nose cones, spools of orange and white filament, a safety-orange toolbox on the bottom shelf. Its open front faces along the red arrow."},
        {"key": "parts-rack", "facing": "ne", "w": 1, "d": 1, "h": 50, "width": 60, "fit": "diamond",
         "prompt": "The SAME navy steel shelving rack seen from behind: the backs of the storage bins, filament spools and the toolbox through the open shelves."}]})
    save("launch", s)

s = load("events")
if not any(sh["name"] == "bar" for sh in s["sheets"]):
    s["sheets"].append({"name": "bar", "grid": "2x1", "items": [
        {"key": "bar-cart", "facing": "se", "w": 1, "d": 1, "h": 30, "width": 46, "fill": 0.5,
         "prompt": "A polished brass bar cart with two glass shelves and big spoked wheels: a pitcher of pink lemonade, a row of coupe glasses, a bottle of sparkling cider in an ice bucket, a small vase of rose-colored flowers. Its handle is on the far side."},
        {"key": "bar-cart", "facing": "nw", "w": 1, "d": 1, "h": 30, "width": 46, "fill": 0.5,
         "prompt": "The SAME brass bar cart with glass shelves seen from the other side, its curved brass handle nearest to us, the lemonade, coupe glasses and ice bucket behind it."}]})
    save("events", s)
print("wave 3 specs")
