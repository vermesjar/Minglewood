"""Writes specs/rotations2.json: second takes of the turnaround views the first build (specs/_rotations.py) drew as
mirror images instead of turning the piece, described cell by cell as a layout on the page, which the image model
follows where it doesn't follow "turn it".

A detail on a piece's own left side (as the piece faces) sits counterclockwise from its facing on the page: facing
the lower left, its left is the lower right; facing the lower right, the upper right; facing the upper right, the
upper left; facing the upper left, the lower left.

  uv run python specs/_rotations2.py && uv run studio.py build specs/rotations2.json
"""
import json
from pathlib import Path

from _rotations import FRONT, sheet

SHEETS = [
    sheet("espresso-se", "espresso", ["out/cafe/countertop2/espresso.sw.raw.png"],
          "Reference: the machine with its front to the lower left. The right cell shows it turned so its front faces "
          "the lower right; it is NOT a mirror image of the reference.", {"width": 40}, {
              "sw": ("The vintage brass-and-cream espresso machine exactly as in the reference. " + FRONT["sw"], False),
              "se": ("The SAME espresso machine. " + FRONT["se"] + " Its FRONT is the face toward the LOWER RIGHT. "
                     "Reading that front face from left to right on the page: the round pressure gauge high up at its "
                     "LEFT end (near the middle of the machine on the page), then the group head with the "
                     "walnut-handled portafilter sticking out toward the lower right, a little right of centre. The "
                     "face toward the LOWER LEFT is the machine's plain cream-enamel side panel with brass trim. The "
                     "steam wand is on the far side, only its tip peeking out at the top right. White cups on top. No "
                     "text.", True),
          }, h=22, fill=0.35),
    sheet("vending-se", "vending-machine", ["out/arcade/snacks/vending-machine.sw.raw.png"],
          "Reference: the machine with its front to the lower left. The right cell shows it turned so its front faces "
          "the lower right.", {"width": 50}, {
              "sw": ("The magenta neon snack vending machine exactly as in the reference. " + FRONT["sw"], False),
              "se": ("The SAME vending machine. " + FRONT["se"] + " Its FRONT is the tall face toward the LOWER RIGHT: "
                     "on it, the big glowing glass window full of snacks fills the LEFT part and the narrow button "
                     "panel with the coin slot runs down the RIGHT part; the dark pickup flap along the bottom of the "
                     "front. The face toward the LOWER LEFT is a plain magenta side panel with a few vents near the "
                     "bottom. No text.", True),
          }, h=54, fill=1.0),
    sheet("piano-se", "heirloom-piano", ["out/heirlooms/grand/heirloom-piano.sw.raw.png"],
          "Reference: the grand piano with its keyboard to the lower left. The right cell shows it turned so its "
          "keyboard faces the lower right; it is NOT a mirror image of the reference.", {"width": 124}, {
              "sw": ("The black-lacquer grand piano with gold trim exactly as in the reference. " + FRONT["sw"], False),
              "se": ("The SAME grand piano. The keyboard runs along the LOWER-RIGHT edge, with the red velvet bench in "
                     "front of it at the bottom right. The long tail of the piano points to the UPPER LEFT. The case's "
                     "STRAIGHT side runs along the LOWER-LEFT edge, from the bottom corner up to the tail. The big "
                     "CURVED bulge of the case is along the UPPER-RIGHT edge. The lid is hinged along the straight "
                     "lower-left side and propped open, rising on the upper-right (curved) side.", True),
          }, w=2, d=2, h=34, tile=260, fill=1.0),
    sheet("piano-nw", "heirloom-piano", ["out/heirlooms/grand/heirloom-piano.ne.raw.png"],
          "Reference: the grand piano seen from its tail end, its keyboard away to the upper right. The right cell "
          "shows it turned so its keyboard faces the upper left; it is NOT a mirror image of the reference.",
          {"width": 124}, {
              "ne": ("The black-lacquer grand piano with gold trim exactly as in the reference. " + FRONT["ne"], False),
              "nw": ("The SAME grand piano seen from its tail end. The keyboard and bench are along the far UPPER-LEFT "
                     "edge, mostly hidden. The rounded tail points toward us, to the LOWER RIGHT. The case's STRAIGHT "
                     "side runs along the UPPER-RIGHT edge. The big CURVED bulge is along the LOWER-LEFT edge. The lid "
                     "is hinged along the straight upper-right side and propped open, rising on the lower-left "
                     "(curved) side.", True),
          }, w=2, d=2, h=34, tile=260, fill=1.0),
    sheet("dragonlamp-sw", "heirloom-dragonlamp", ["out/heirlooms/hall/heirloom-dragonlamp.se.raw.png"],
          "Reference: the lamp with its lantern hanging out to the right of the pole.", {"height_px": 84}, {
              "se": ("The jade dragon lamp exactly as in the reference.", False),
              "sw": ("The SAME jade dragon lamp turned so the dragon's head and its glowing round paper lantern face "
                     "US: the lantern hangs directly IN FRONT of the pole, centred on it, covering the middle of the "
                     "pole and the dragon's coils, low above the round rosewood base; the dragon's head leans toward "
                     "us just above the lantern.", True),
          }, h=52, fill=0.35, model={"base": "centred"}),
    sheet("lamp-arc-sw-ne", "lamp-arc", ["out/design/studio2/lamp-arc.raw.png"],
          "Reference: the arc lamp with its arc and shade out to the right of its pole.", {"height_px": 77}, {
              "sw": ("The SAME brass arc floor lamp on its round white marble base, turned so the arc swings straight "
                     "TOWARD US: the copper dome shade hangs directly IN FRONT of the pole, centred on it and low, just "
                     "above the marble base, its glowing opening facing down; the brass stem curves over from the top "
                     "of the pole toward us.", True),
              "ne": ("The SAME brass arc floor lamp on its round white marble base, turned so the arc swings straight "
                     "AWAY from us: the copper dome shade hangs directly BEHIND the top of the pole, centred on it and "
                     "high, partly hidden by the pole; the stem curves away from us over the top.", True),
          }, h=60, fill=0.3, model={"base": "centred"}),
    sheet("water-cooler-2", "water-cooler", ["out/eng/kitchen/water-cooler.se.raw.png"],
          "Reference: the cooler with its taps facing the lower left; its paper-cup holder is on its side panel "
          "toward the lower right.", {"height_px": 74}, {
              "sw": ("The white office water cooler exactly as in the reference. " + FRONT["sw"], False),
              "se": ("The SAME water cooler. " + FRONT["se"] + " Its FRONT (toward the LOWER RIGHT) has the red hot tap "
                     "on the LEFT, the blue cold tap on the RIGHT and the drip tray below. The side panel toward the "
                     "LOWER LEFT is plain white with a vent grille: NO cup holder on it (the cup holder is on the far "
                     "side, hidden). The big blue water bottle upside down on top.", True),
              "nw": ("The SAME water cooler seen from behind. " + FRONT["nw"] + " The face toward the LOWER RIGHT is its "
                     "plain white back panel with a vent grille and a power cord. The side panel toward the LOWER LEFT "
                     "carries the paper-cup holder. No taps visible. The big blue water bottle on top.", True),
              "ne": ("The SAME water cooler seen from behind. " + FRONT["ne"] + " The face toward the LOWER LEFT is its "
                     "plain white back panel with a vent grille and a power cord. The side panel toward the LOWER "
                     "RIGHT is plain white: NO cup holder (it is on the far side, hidden). No taps visible. The big "
                     "blue water bottle on top.", True),
          }, h=40, fill=0.4),
]

# the arc lamp's front view: two takes to choose from
for take in ("a", "b"):
    SHEETS.append(sheet(f"lamp-arc-sw-{take}", "lamp-arc", ["out/design/studio2/lamp-arc.raw.png"],
                        "Reference: the arc lamp with its arc and shade out to the right of its pole. The right cell "
                        "shows it turned a quarter-turn so the arc reaches toward the viewer.", {"height_px": 77}, {
                            "se": ("The brass arc floor lamp exactly as in the reference.", False),
                            "sw": ("The SAME brass arc floor lamp, seen so its arc reaches straight toward the viewer: "
                                   "the round white marble base and the upright brass pole are at the BACK, and the "
                                   "copper dome shade hangs IN FRONT of them, horizontally centred on the pole, its "
                                   "glowing opening facing down; the shade overlaps and hides the middle of the pole. "
                                   "The stem rises from the base, bends over at the top and comes forward and down to "
                                   "the shade. Nothing reaches out to the left or right.", True),
                        }, h=60, fill=0.3, model={"base": "centred"}))

# the arc lamp's front view: take a was chosen (art/review/rot-lamparc-takes.png)
for sh in SHEETS:
    for it in sh["items"]:
        if it.get("key") == "lamp-arc" and it["facing"] == "sw" and sh["name"] != "lamp-arc-sw-a":
            del it["key"]

spec = {
    "name": "rotations2",
    "note": "Second takes of turnaround views drawn as mirror images instead of turned.",
    "mood": "The Minglewood house style: warm, glossy, detailed pixel art furniture.",
    "colors": 28,
    "quality": "high",
    "sheets": SHEETS,
}
Path(__file__).with_name("rotations2.json").write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8", newline="\n")
print(f"{len(SHEETS)} sheets")
