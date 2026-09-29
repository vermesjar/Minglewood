"""One-off: wave 7, zones for Engineering (kitchenette, pairing, meeting nook), the Quiet Grove (reading nooks,
globe, plants) and the Design Loft (crit wall, materials, plant corner). Idempotent."""
import json
from pathlib import Path

HERE = Path(__file__).parent


def add(room, sheet):
    p = HERE / f"{room}.json"
    s = json.loads(p.read_text(encoding="utf-8"))
    if not any(sh["name"] == sheet["name"] for sh in s["sheets"]):
        s["sheets"].append(sheet)
        p.write_text(json.dumps(s, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


ROUND = {"facing": "se", "also_facings": ["nw"]}

add("eng", {"name": "kitchen", "grid": "3x2", "items": [
    {"key": "fridge", "facing": "sw", "w": 1, "d": 1, "h": 50, "width": 50, "fit": "diamond",
     "prompt": "A tall retro office fridge in matte sage green with rounded corners and a chrome handle, a few colorful magnets, a sticky note and a small team photo on its door. Its door faces along the red arrow."},
    {"key": "fridge", "facing": "ne", "w": 1, "d": 1, "h": 50, "width": 50, "fit": "diamond",
     "prompt": "The SAME sage green retro fridge seen from behind: its plain sage back with a dark coil grille and a power cord."},
    {"key": "water-cooler", **ROUND, "w": 1, "d": 1, "h": 40, "width": 30, "fill": 0.4,
     "prompt": "An office water cooler: a clear blue water bottle upside down on a slim white cabinet with a red and a blue tap and a stack of paper cups on the side."},
    {"key": "whiteboard-stand", "facing": "sw", "w": 1, "d": 1, "h": 48, "width": 50, "fill": 0.5,
     "prompt": "A rolling mobile whiteboard on a black steel A-frame stand with four small wheels: a pairing sketch of boxes, arrows and a little bug doodle in blue and red marker, a marker tray. Its writing side faces along the red arrow."},
    {"key": "whiteboard-stand", "facing": "ne", "w": 1, "d": 1, "h": 48, "width": 50, "fill": 0.5,
     "prompt": "The SAME rolling whiteboard seen from behind: the plain white back of the board, the black steel A-frame stand and wheels."},
    {"key": "fruit-bowl", **ROUND, "w": 1, "d": 1, "h": 10, "width": 28, "fill": 0.3,
     "prompt": "A shallow white ceramic bowl heaped with fruit: green apples, oranges, a bunch of bananas, beside a small stack of mugs."}]})

add("eng", {"name": "wall2", "kind": "wall", "grid": "2x1", "size": "1536x1024", "items": [
    {"key": "dashboard", "span": 2, "wall": {"v": [22, 46], "margin": 0.06},
     "prompt": "A wide wall-mounted TV screen, about 1.9 : 1, in a slim black bezel showing a dark build-status dashboard: a row of green check tiles and one amber tile, a small green line chart trending up, a big green circle, tidy panels (no letters or numbers)."},
    {"key": "poster.ship", "span": 1, "wall": {"v": [20, 46], "margin": 0.14},
     "prompt": "A framed retro screen-print poster, portrait 2:3, in a thin black frame: a stylised rocket lifting off over a lake at dawn in teal, orange and cream, bold flat shapes (no letters)."}]})

add("focus", {"name": "nooks", "grid": "3x2", "items": [
    {"key": "side-table.walnut", **ROUND, "w": 1, "d": 1, "h": 26, "width": 34, "fill": 0.4, "extra": {"light": {"x": 18, "y": 8, "r": 34}},
     "prompt": "A small round dark walnut side table on a turned pedestal holding a brass banker's lamp with a green glass shade glowing warmly, a teacup and a small stack of books."},
    {"key": "globe-stand", **ROUND, "w": 1, "d": 1, "h": 44, "width": 36, "fill": 0.4,
     "prompt": "An antique floor globe: a parchment-colored world globe in a brass meridian ring, on a carved dark walnut tripod stand."},
    {"key": "plant.fern", **ROUND, "w": 1, "d": 1, "h": 34, "width": 40, "fill": 0.45,
     "prompt": "A lush Boston fern with long arching fronds spilling over a woven wicker basket planter."},
    {"key": "plant.ivy", **ROUND, "w": 1, "d": 1, "h": 46, "width": 34, "fill": 0.4,
     "prompt": "A tall slim dark walnut plant stand holding a glazed green pot of trailing ivy that cascades down to the floor."},
    {"key": "ottoman.green", **ROUND, "w": 1, "d": 1, "h": 14, "width": 36, "fill": 0.55, "extra": {"seat": 9},
     "prompt": "A round bottle-green velvet ottoman footstool with deep button tufting and short turned walnut feet."},
    {"key": "book-stack", **ROUND, "w": 1, "d": 1, "h": 16, "width": 26, "fill": 0.35,
     "prompt": "A tidy tall stack of old leather-bound books on the floor in deep red, green and brown, a pair of reading glasses resting on top."}]})

add("design", {"name": "crit", "grid": "3x2", "items": [
    {"key": "materials-shelf", "facing": "sw", "w": 1, "d": 1, "h": 52, "width": 60, "fit": "diamond",
     "prompt": "A tall open light-oak shelving unit full of design materials: folded fabric bolts in terracotta, mustard and sage, rolls of paper, jars of brushes and markers, paint tins, a stack of swatch books and a small trailing plant on top. Its open front faces along the red arrow."},
    {"key": "materials-shelf", "facing": "ne", "w": 1, "d": 1, "h": 52, "width": 60, "fit": "diamond",
     "prompt": "The SAME light-oak materials shelf seen from behind: its plain oak back panel with the trailing plant on top."},
    {"key": "stool.drafting", **ROUND, "w": 1, "d": 1, "h": 24, "width": 28, "fill": 0.35, "extra": {"seat": 17},
     "prompt": "A tall drafting stool with a round mustard-yellow cushioned seat, a chrome gas lift and a ring footrest on a five-star base."},
    {"key": "plant.snake", **ROUND, "w": 1, "d": 1, "h": 34, "width": 28, "fill": 0.35,
     "prompt": "A tall snake plant with upright variegated green-and-yellow leaves in a round terracotta pot."},
    {"key": "plant.fiddle", **ROUND, "w": 1, "d": 1, "h": 56, "width": 40, "fill": 0.4,
     "prompt": "A tall fiddle-leaf fig tree with big glossy leaves in a woven seagrass basket."},
    {"key": "paper-bin", **ROUND, "w": 1, "d": 1, "h": 30, "width": 28, "fill": 0.35,
     "prompt": "A tall woven basket holding big rolls of drawing paper and tracing paper standing upright, one roll slightly unfurled."}]})

add("design", {"name": "wall2", "kind": "wall", "grid": "2x1", "size": "1536x1024", "items": [
    {"key": "pinup", "span": 3, "wall": {"v": [16, 48], "margin": 0.05},
     "prompt": "A wide crit wall, about 3 : 1: a pale grey felt pin-up board in a light oak frame covered in pinned printouts of app screens and layouts in terracotta, mustard and sage, sticky notes, a few red circles and arrows drawn on them, and a row of little brass pins (no readable text)."},
    {"key": "print.poster", "span": 1, "wall": {"v": [20, 46], "margin": 0.14},
     "prompt": "A framed modernist art print, portrait 2:3, in a thin light oak frame: bold overlapping circles and arches in terracotta, mustard, sage and ink plum on cream paper."}]})
print("wave 7 specs")
