"""Writes specs/rotations-town.json: the missing views of the town props under the four-rotation standard
(docs/furniture.md), for the TOWN pass to run. Before building, apply the relabels below (the drawings some props
were first published with face another way than their records say):

  uv run python specs/_rotations_town.py --relabel     # under the manifest lock
  uv run studio.py build specs/rotations-town.json

Honest classes (see art/rotation.py):
  mirror  the rowboats (bow along their facing), the mailbox, the notice board (symmetric), the bike rack (the rack
          is symmetric; the parked bike is loose, it may be parked either way round)
  full    the flower cart (big wheel at one end, handles at the other), the street lamp (its lantern on an arm to
          one side), the signpost (its arrows point one way)
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _rotations import FRONT, sheet  # noqa: E402

# what each single drawing actually shows (art/review/rot-town-todo.png)
RELABEL = {"boat.red": "sw", "boat.yellow": "sw", "flower-cart": "sw", "mailbox": "sw", "noticeboard": "sw",
           "bike-rack": "se", "lamp-post": "se", "signpost": "se"}
ROTATION = {"boat.red": "mirror", "boat.yellow": "mirror", "mailbox": "mirror", "noticeboard": "mirror",
            "bike-rack": "mirror", "flower-cart": "full", "lamp-post": "full", "signpost": "full"}
TOWN = {"rooms": ["outdoors"]}

SHEETS = []
for colour in ("red", "yellow"):
    SHEETS.append(sheet(f"boat-{colour}", f"boat.{colour}", [f"out/town-props/leisure/boat.{colour}.raw.png"],
                        "Reference: the rowboat with its pointed bow toward the lower left.", {"width": 112}, {
                            "sw": (f"The {colour} wooden rowboat exactly as in the reference: its pointed bow toward "
                                   "the LOWER LEFT, its square stern toward the upper right, oars resting inside.",
                                   False),
                            "ne": (f"The SAME {colour} wooden rowboat turned half round: its pointed bow now toward "
                                   "the UPPER RIGHT, away from us, its square stern toward the lower left, nearest "
                                   "us; the oars resting inside.", True),
                        }, w=2, d=2, h=16, fill=0.6, tile=240, model=TOWN))
SHEETS += [
    sheet("mailbox", "mailbox", ["out/town-props/street/mailbox.raw.png"],
          "Reference: the mailbox from the front (its slot and star face the lower left).", {"height_px": 77}, {
              "sw": ("The blue street mailbox exactly as in the reference. " + FRONT["sw"], False),
              "ne": ("The SAME blue mailbox seen from BEHIND. " + FRONT["ne"] + " Its plain rounded blue back faces "
                     "us, with a small hinged collection door and a brass lock; no slot and no star visible.", True),
          }, h=34, fill=0.3, model=TOWN),
    sheet("noticeboard", "noticeboard", ["out/town-props/park/noticeboard.raw.png"],
          "Reference: the notice board from the front (its pinned notices face the lower left).", {"height_px": 106}, {
              "sw": ("The wooden town notice board exactly as in the reference. " + FRONT["sw"], False),
              "ne": ("The SAME notice board seen from BEHIND. " + FRONT["ne"] + " The plain planked back of the board "
                     "between its two posts faces us, ivy climbing the posts, the mossy shingle roof on top; no "
                     "notices visible.", True),
          }, h=48, fill=0.3, model=TOWN),
    sheet("bike-rack", "bike-rack", ["out/town-props/street/bike-rack.raw.png"],
          "Reference: the bike rack with a bicycle parked in it.", {"width": 76}, {
              "se": ("The black steel hoop bike rack with the mint bicycle exactly as in the reference.", False),
              "nw": ("The SAME bike rack and bicycle seen from the other side, from BEHIND the rack: the hoops and the "
                     "parked bicycle's other side, its basket now at the other end.", True),
          }, h=24, fill=0.5, model=TOWN),
    sheet("flower-cart", "flower-cart", ["out/town-props/park/flower-cart.raw.png"],
          "Reference: the flower cart with its flower display facing the lower left, its big spoked wheel at the LEFT "
          "end and its handles at the RIGHT end. The wheel and handles turn with the cart.", {"width": 124}, {
              "sw": ("The flower cart exactly as in the reference. " + FRONT["sw"], False),
              "se": ("The SAME flower cart turned a quarter-turn: its flower display now faces the LOWER RIGHT. As in "
                     "the reference seen from the display side, the big spoked wheel is at the LEFT end and the "
                     "handles at the RIGHT end; the striped awning on top.", True),
              "ne": ("The SAME flower cart seen from BEHIND: its display faces away to the UPPER RIGHT. We see the "
                     "cart's plain wooden back; the big spoked wheel is now at the RIGHT end and the handles at the "
                     "LEFT end; flowers peeking over the top; the striped awning.", True),
              "nw": ("The SAME flower cart seen from BEHIND: its display faces away to the UPPER LEFT. We see the "
                     "cart's plain wooden back; the big spoked wheel is at the RIGHT end and the handles at the LEFT "
                     "end; flowers peeking over the top; the striped awning.", True),
          }, w=2, d=2, h=64, fill=0.4, tile=240, model=TOWN),
]
ARM = {
    "sw": "now reaches out TOWARD US, in front of the post (lower on the page, overlapping the post)",
    "nw": "now reaches out to the LEFT of the post (like a mirror image of the reference)",
    "ne": "now reaches out AWAY from us, BEHIND the post (higher on the page, partly hidden behind the post)",
}
for key, ref, what, arm, hpx, base in [
    ("lamp-post", "out/town-props/street/lamp-post.raw.png", "The black iron street lamp on its round foot",
     "its curled arm holding the lantern", 100, "centred"),
    ("signpost", "out/town-props/street/signpost.raw.png", "The wooden town signpost in its flower planter",
     "its three painted arrow signs (cream, teal and red, no text)", 112, "filled"),
]:
    SHEETS.append(sheet(key, key, [ref], f"Reference: the piece with {arm} out to the RIGHT. That part swings round "
                        "with the piece as it turns; the post stays on the same spot.", {"height_px": hpx}, {
                            "se": (f"{what} exactly as in the reference: {arm} out to the RIGHT.", False),
                            **{f: (f"The SAME piece turned: {what}; {arm} {ARM[f]}.", True) for f in ("sw", "nw", "ne")},
                        }, h=56, fill=0.3, model={**TOWN, "base": base}))

spec = {
    "name": "rotations-town",
    "note": "The four-rotation standard: the missing views of the town props.",
    "mood": "A cosy seaside town in the Minglewood house style.",
    "colors": 28,
    "quality": "high",
    "sheets": SHEETS,
}

if "--relabel" in sys.argv:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import studio  # noqa: E402
    with studio.ManifestLock():
        m = studio.load_manifest()
        for key, facing in RELABEL.items():
            e = m["sprites"][key]
            if e.get("file"):
                e["facings"] = {facing: {"file": e.pop("file"), "anchor": e.pop("anchor")}}
            e["rotation"] = ROTATION[key]
        studio.save_manifest(m)
    print("relabelled", ", ".join(RELABEL))
Path(__file__).with_name("rotations-town.json").write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8", newline="\n")
print(f"{len(SHEETS)} sheets")
