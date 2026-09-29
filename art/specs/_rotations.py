"""Writes specs/rotations.json: the missing views of the indoor catalog (docs/furniture.md, the four-rotation
standard). Every sheet shows the SAME piece from all the sides it needs; the finished drawings are references, and
only the missing views are published (cells without a key are drawn for consistency and thrown away).

Handedness: a piece turned a quarter-turn keeps every detail on the same side OF THE PIECE. So the two front views
(se, sw) show the front's details in the same left-to-right order, and so do the two back views (ne, nw); a detail
that sticks out sideways (a lamp's arm) swings round with the piece: out to the right (se), toward us (sw), out to
the left (nw), away from us (ne).

  uv run python specs/_rotations.py && uv run studio.py build specs/rotations.json
"""
import json
from pathlib import Path

FRONT = {
    "se": "Its front faces the LOWER RIGHT.",
    "sw": "Its front faces the LOWER LEFT.",
    "ne": "Seen from BEHIND: its front faces away from us, to the UPPER RIGHT.",
    "nw": "Seen from BEHIND: its front faces away from us, to the UPPER LEFT.",
}


def sheet(name, key, refs, note, size, cells, w=1, d=1, h=40, fill=0.5, tile=280, model=None):
    items = []
    for facing, (prompt, publish) in cells.items():
        it = {"facing": facing, "w": w, "d": d, "h": h, "fill": fill, "prompt": prompt, **size}
        if publish:
            it["key"] = key
        items.append(it)
    grid = "2x1" if len(items) <= 2 else "2x2"
    sh = {"name": name, "grid": grid, "size": "1536x1024", "tile": tile, "refs": refs, "items": items,
          "note": "The extra reference images are finished drawings of this exact piece. EVERY cell shows the SAME "
                  "piece, same size, materials and colours, seen from a different side as each cell says. " + note}
    if model:
        sh["model"] = model
    return sh


SHEETS = [
    sheet("espresso", "espresso",
          ["out/cafe/countertop2/espresso.sw.raw.png", "out/cafe/countertop2/espresso.ne.raw.png"],
          "References: the machine from the front (its front to the lower left) and from behind (to the upper right).",
          {"width": 40}, {
              "sw": ("The vintage brass-and-cream espresso machine exactly as in the front reference: " + FRONT["sw"] +
                     " The group head is on the front with its walnut-handled portafilter sticking out at the LEFT end "
                     "of the front; the steam wand is on the right; white cups on top. No text.", False),
              "se": ("The SAME espresso machine turned a quarter-turn. " + FRONT["se"] + " Exactly as in the front "
                     "reference, the walnut-handled portafilter sticks out at the LEFT end of the front, the pressure "
                     "gauge above it, the steam wand at the RIGHT end; white cups on top. No text.", True),
              "ne": ("The SAME machine exactly as in the back reference. " + FRONT["ne"] + " Its plain cream-enamel "
                     "back panel with a small brass plate faces us; the portafilter's walnut handle peeks out on the "
                     "RIGHT; cups on top. No text.", False),
              "nw": ("The SAME machine seen from behind, turned a quarter-turn from the back reference. " + FRONT["nw"] +
                     " Its plain cream-enamel back panel with a small brass plate faces us (toward the lower right); "
                     "the portafilter's walnut handle peeks out on the RIGHT, just as in the back reference; cups on "
                     "top. No text.", True),
          }, h=22, fill=0.35),
    sheet("register", "register",
          ["out/cafe/countertop2/register.sw.raw.png", "out/fix-backs/register-back/register.ne.raw.png"],
          "References: the register from the front (keys, to the lower left) and from behind (the customer's side).",
          {"width": 32}, {
              "sw": ("The antique brass cash register exactly as in the front reference. " + FRONT["sw"] + " Rows of "
                     "round typewriter keys, the walnut cash drawer at the bottom. No text or numbers.", False),
              "se": ("The SAME register turned a quarter-turn. " + FRONT["se"] + " Rows of round typewriter keys on "
                     "the front, the walnut cash drawer below them, every detail on the same side as in the front "
                     "reference. No text or numbers.", True),
              "ne": ("The SAME register exactly as in the back reference. " + FRONT["ne"] + " Its big flat polished "
                     "brass back panel with raised scrollwork faces us, the round amount flag on top facing us. No "
                     "text or numbers.", False),
              "nw": ("The SAME register seen from behind, turned a quarter-turn from the back reference. " + FRONT["nw"] +
                     " Its big flat polished brass back panel with raised scrollwork and a small oval maker's plate "
                     "faces us (toward the lower right); the round amount flag on top faces us too. No keys and no "
                     "drawer visible. No text or numbers.", True),
          }, h=16, fill=0.3),
    sheet("piano", "heirloom-piano",
          ["out/heirlooms/grand/heirloom-piano.sw.raw.png", "out/heirlooms/grand/heirloom-piano.ne.raw.png"],
          "References: the grand piano from the keyboard side (to the lower left) and from its tail end. A grand piano "
          "is handed: for a pianist sitting at the keyboard, the straight side of the case is on their LEFT and the "
          "long curved side on their RIGHT, and the lid is propped open on the curved side.",
          {"width": 124}, {
              "sw": ("The black-lacquer grand piano with gold trim exactly as in the first reference. " + FRONT["sw"] +
                     " Keyboard and red velvet bench toward the lower left; lid propped open.", False),
              "se": ("The SAME grand piano turned a quarter-turn. " + FRONT["se"] + " The keyboard and its red velvet "
                     "bench are on the lower-right side. For the pianist on the bench, the straight side of the case "
                     "is on their LEFT and the long curved side swings round on their RIGHT; the lid is propped open "
                     "on the curved side.", True),
              "ne": ("The SAME grand piano exactly as in the second reference. " + FRONT["ne"], False),
              "nw": ("The SAME grand piano seen from its tail end, turned a quarter-turn from the second reference. " +
                     FRONT["nw"] + " The keyboard and bench are on the far side (upper left), mostly hidden behind "
                     "the case. As we look at it, the straight side of the case is on the RIGHT and the curved side "
                     "on the LEFT; the lid is propped open on the curved side.", True),
          }, w=2, d=2, h=34, tile=240, fill=1.0),
    sheet("dragonlamp", "heirloom-dragonlamp",
          ["out/heirlooms/hall/heirloom-dragonlamp.se.raw.png", "out/heirlooms/hall/heirloom-dragonlamp.nw.raw.png"],
          "References: the lamp with its lantern hanging out to the right, and turned half round with it on the left. "
          "The lantern swings round with the lamp.",
          {"height_px": 84}, {
              "se": ("The jade dragon lamp exactly as in the first reference: the green jade dragon coiled up a brass "
                     "pole on a round rosewood base, a glowing round paper lantern hanging from its jaws out to the "
                     "RIGHT of the pole.", False),
              "sw": ("The SAME jade dragon lamp turned a quarter-turn: the dragon's head and the glowing round paper "
                     "lantern it holds now hang out TOWARD US, in front of the pole (lower on the page, overlapping "
                     "the dragon's coils); round rosewood base.", True),
              "nw": ("The SAME lamp exactly as in the second reference: the lantern hangs out to the LEFT of the "
                     "pole.", False),
              "ne": ("The SAME jade dragon lamp turned the other way: the dragon's head and the glowing lantern now "
                     "hang out AWAY from us, BEHIND the pole (higher on the page, partly hidden by the pole and the "
                     "coils, its glow showing round them); we see the dragon's back and tail; round rosewood base.",
                     True),
          }, h=52, fill=0.35, model={"base": "centred"}),
    sheet("vending", "vending-machine",
          ["out/arcade/snacks/vending-machine.sw.raw.png", "out/arcade/snacks/vending-machine.ne.raw.png"],
          "References: the machine from the front (to the lower left) and from behind.",
          {"width": 50}, {
              "sw": ("The magenta neon snack vending machine exactly as in the front reference. " + FRONT["sw"] +
                     " Big glass window of snacks on the LEFT part of the front, the button panel and coin slot on "
                     "the RIGHT part, the pickup flap along the bottom. No text.", False),
              "se": ("The SAME vending machine turned a quarter-turn. " + FRONT["se"] + " Exactly as in the front "
                     "reference: the big glowing glass window of snacks on the LEFT part of the front, the button "
                     "panel and coin slot on the RIGHT part, the pickup flap along the bottom. No text.", True),
              "ne": ("The SAME machine exactly as in the back reference. " + FRONT["ne"], False),
              "nw": ("The SAME vending machine seen from behind, turned a quarter-turn from the back reference. " +
                     FRONT["nw"] + " Its plain magenta back panel with vents and a power cord at the bottom faces "
                     "us, just as in the back reference. No text.", True),
          }, h=54, fill=1.0),
    sheet("popcorn", "popcorn-cart",
          ["out/arcade/snacks/popcorn-cart.se.raw.png"],
          "Reference: the cart from the front (its glass popcorn case to the lower right). The cart is handed: its big "
          "spoked wheel is at one end.",
          {"width": 42}, {
              "se": ("The red-and-gold popcorn cart exactly as in the reference. " + FRONT["se"] + " Big spoked wheel "
                     "at the LEFT end.", False),
              "sw": ("The SAME popcorn cart turned a quarter-turn. " + FRONT["sw"] + " Its glass case full of popcorn "
                     "faces the lower left; exactly as in the reference seen from the front, the big spoked gold "
                     "wheel is at the LEFT end and the red popcorn boxes at the right; red roof on top.", False),
              "nw": ("The SAME popcorn cart seen from BEHIND. " + FRONT["nw"] + " We see the back of the glass case "
                     "(a red door panel with a brass knob, popcorn visible through the glass above it); the big spoked "
                     "gold wheel is now at the RIGHT end; red roof on top.", False),
              "ne": ("The SAME popcorn cart seen from BEHIND, turned the other way. " + FRONT["ne"] + " We see the "
                     "back of the glass case (a red door panel with a brass knob, popcorn visible through the glass "
                     "above it); the big spoked gold wheel is at the RIGHT end; red roof on top.", True),
          }, h=50, fill=0.45, model={"base": "centred"}),
    sheet("water-cooler", "water-cooler",
          ["out/eng/kitchen/water-cooler.se.raw.png"],
          "Reference: the cooler from the front (its taps face the lower left). The taps are handed: the red hot tap "
          "is on the LEFT, the blue cold tap on the RIGHT, as you face them.",
          {"height_px": 74}, {
              "sw": ("The white office water cooler exactly as in the reference. " + FRONT["sw"], False),
              "se": ("The SAME water cooler turned a quarter-turn. " + FRONT["se"] + " The red hot tap on the LEFT and "
                     "the blue cold tap on the RIGHT of the front, the drip tray below, the paper-cup holder on the "
                     "side; the big blue water bottle upside down on top.", True),
              "nw": ("The SAME water cooler seen from BEHIND. " + FRONT["nw"] + " Its plain white back panel with a "
                     "vent grille and a power cord faces us; no taps visible; the big blue water bottle on top.", True),
              "ne": ("The SAME water cooler seen from BEHIND, turned the other way. " + FRONT["ne"] + " Its plain "
                     "white back panel with a vent grille and a power cord faces us; the paper-cup holder on the side; "
                     "the big blue water bottle on top.", True),
          }, h=40, fill=0.4),
]

ARM = {
    "sw": "now reaches out TOWARD US, in front of the pole (lower on the page, overlapping the pole)",
    "nw": "now reaches out to the LEFT of the pole (like a mirror image of the reference)",
    "ne": "now reaches out AWAY from us, BEHIND the pole (higher on the page, partly hidden behind the pole)",
}
for key, ref, what, arm, hpx, h in [
    ("lamp", "out/cafe/seats/lamp.raw.png", "The brass floor lamp with a pleated cream shade", "its shade on a short "
     "arm", 81, 60),
    ("lamp-arc", "out/design/studio2/lamp-arc.raw.png", "The brass arc floor lamp on a round white marble base",
     "its long arching stem and copper dome shade", 77, 60),
    ("lantern-floor", "out/events/party2/lantern-floor.se.raw.png", "The festive floor lantern: a dark wooden "
     "shepherd's-hook post on a round foot", "its hook with the glowing round pink paper lantern", 55, 56),
    ("stanchion", "out/hq/museum/stanchion.se.raw.png", "The museum stanchion: a polished brass post on a round "
     "base", "its red velvet rope, hanging from the top of the post", 43, 30),
]:
    SHEETS.append(sheet(key, key, [ref],
                        f"Reference: the piece with {arm} out to the RIGHT. That part swings round with the piece as "
                        "it turns; the base stays on the same spot.", {"height_px": hpx}, {
                            "se": (f"{what} exactly as in the reference: {arm} reaches out to the RIGHT.", False),
                            **{f: (f"The SAME piece turned: {what}; {arm} {ARM[f]}.", True) for f in ("sw", "nw", "ne")},
                        }, h=h, fill=0.3, model={"base": "centred"}))

SHEETS += [
    sheet("grinder", "grinder", ["out/cafe/countertop2/grinder.raw.png"],
          "Reference: the grinder from the front (its drawer faces the lower right).", {"width": 20}, {
              "se": ("The antique coffee grinder exactly as in the reference: a glass hopper of beans on a walnut box "
                     "with a little brass-knobbed drawer, " + FRONT["se"], False),
              "nw": ("The SAME coffee grinder seen from BEHIND. " + FRONT["nw"] + " The glass hopper of beans on top, "
                     "the plain back of the walnut box toward us (the drawer faces away and is hidden).", True),
          }, h=16, fill=0.15),
    sheet("time-capsule", "time-capsule", ["out/hq/lobby/time-capsule.raw.png"],
          "Reference: the time capsule from the front (its porthole and plaque face the lower left).", {"width": 44}, {
              "sw": ("The brass-and-steel time capsule exactly as in the reference: a tall cylinder with a round "
                     "porthole, on a navy plinth with a brass plaque. " + FRONT["sw"], False),
              "ne": ("The SAME time capsule seen from BEHIND. " + FRONT["ne"] + " The back of the steel cylinder with "
                     "its brass bands and rivets, a hinge and a bolted service hatch instead of the porthole; the "
                     "back of the navy plinth is plain (the plaque faces away).", True),
          }, h=34, fill=0.45),
]

# Views this build drew as mirror images instead of turning the piece: their second takes (specs/_rotations2.py)
# are published instead, so here they're drawn for context only.
SECOND_TAKES = {("espresso", "se"), ("vending-machine", "se"), ("heirloom-piano", "se"), ("heirloom-piano", "nw"),
                ("heirloom-dragonlamp", "sw"), ("lamp-arc", "sw"), ("lamp-arc", "ne"), ("water-cooler", "se"),
                ("water-cooler", "nw"), ("water-cooler", "ne")}
for sh in SHEETS:
    for it in sh["items"]:
        if (it.get("key"), it["facing"]) in SECOND_TAKES:
            del it["key"]

spec = {
    "name": "rotations",
    "note": "The four-rotation standard: the missing views of the indoor catalog, drawn from the finished ones.",
    "mood": "The Minglewood house style: warm, glossy, detailed pixel art furniture.",
    "colors": 28,
    "quality": "high",
    "sheets": SHEETS,
}
Path(__file__).with_name("rotations.json").write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8", newline="\n")
print(f"{len(SHEETS)} sheets")
