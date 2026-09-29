"""One-off: wave-2 additions to the room specs (seat/light metadata, fixes, new pieces). Idempotent."""
import json
from pathlib import Path

HERE = Path(__file__).parent


def load(n):
    return json.loads((HERE / f"{n}.json").read_text(encoding="utf-8"))


def save(n, s):
    (HERE / f"{n}.json").write_text(json.dumps(s, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def items(s):
    for sh in s["sheets"]:
        for it in sh["items"]:
            yield sh, it


def has(s, name):
    return any(sh["name"] == name for sh in s["sheets"])


SEATS = {"chair.office": 15, "beanbag.orange": 8, "beanbag.purple": 8, "beanbag.cyan": 8, "beanbag.pink": 8,
         "couch.blue": 12, "chair.red": 15, "armchair.rust": 12, "armchair.green": 12, "chair.wood": 15,
         "couch.purple": 12}

for n in ["hq", "eng", "launch", "events", "focus", "arcade", "design"]:
    s = load(n)
    for sh, it in items(s):
        k = it.get("key")
        if k in SEATS:
            it.setdefault("extra", {})["seat"] = SEATS[k]
        if n == "hq" and k and k.startswith("frame."):
            it["wall"] = {"v": [14, 50], "margin": 0.04}
        if n == "focus" and k == "fireplace" and it.get("facing") == "sw":
            it.setdefault("extra", {})["light"] = {"x": 37, "y": 47, "r": 42}

    if n == "hq" and not has(s, "clock"):
        s["sheets"].append({"name": "clock", "grid": "2x1", "items": [
            {"key": "clock-grand", "facing": "se", "w": 1, "d": 1, "h": 64, "width": 40, "fill": 0.45,
             "prompt": "A tall walnut grandfather clock with brass trim: an arched top with a small brass star finial, a cream enamel clock face with brass hands, a glass door showing a long brass pendulum, carved feet. Its face and glass door face along the red arrow."},
            {"key": "clock-grand", "facing": "nw", "w": 1, "d": 1, "h": 64, "width": 40, "fill": 0.45,
             "prompt": "The SAME tall walnut grandfather clock seen from directly behind: its plain walnut back panel, the arched top with the brass star finial, carved feet."}]})

    if n == "launch":
        for sh, it in items(s):
            if it.get("key") == "table-long":
                it["prompt"] = ("A long white war-room conference table four tiles long and two tiles deep on navy steel legs. On top: "
                                "open laptops, scattered printouts and sticky notes, two coffee cups, a small orange rocket model and a "
                                "cable tray down the middle. ONLY the table: absolutely NO chairs, no stools, no people around it.")
                sh["note"] = "Draw only the objects listed. The table stands alone with empty floor all around it."
        if not has(s, "mission"):
            s["sheets"].append({"name": "mission", "kind": "wall", "grid": "1x1", "size": "1536x1024", "items": [
                {"key": "screen.countdown", "span": 2, "wall": {"v": [16, 46], "margin": 0.06},
                 "prompt": "A wide wall-mounted mission-control screen, about 2 : 1, in a slim navy bezel: a dark navy display with a glowing orange launch trajectory arc from a small rocket icon up to a star, a big circular countdown ring in orange and white segments on the right, thin grid lines and tiny status dots (no letters or numbers)."}]})

    if n == "events":
        if not has(s, "chair-back"):
            s["sheets"].append({"name": "chair-back", "grid": "1x1", "size": "1024x1024", "tile": 320,
                                "refs": ["out/events/hall/chair.red.se.raw.png"],
                                "note": "The second reference image shows this exact banquet chair from the front. Draw the SAME chair turned around so we look at it from directly BEHIND: the outside of the raspberry cushioned backrest and its gold frame are nearest to us, in front, hiding most of the seat, which is only glimpsed behind it. Same colours, same proportions, same pixel style.",
                                "items": [{"key": "chair.red", "facing": "nw", "w": 1, "d": 1, "h": 30, "width": 40, "fill": 0.5,
                                           "extra": {"seat": 15},
                                           "prompt": "The gold-and-raspberry banquet chair from the reference, seen from behind."}]})
            for sh in s["sheets"]:
                if sh["name"] == "hall":
                    for it in sh["items"]:
                        if it.get("key") == "chair.red" and it.get("facing") == "nw":
                            it["key"] = None
        if not has(s, "decor"):
            s["sheets"].append({"name": "decor", "kind": "wall", "grid": "1x2", "size": "1536x1024", "items": [
                {"key": "lantern-string", "span": 3, "wall": {"v": [40, 56], "margin": 0.02},
                 "prompt": "A string of glowing round paper lanterns hanging in a gentle swag, about 5 : 1: seven lanterns in plum, rose, gold and cream on a thin dark cord, each glowing softly from inside."},
                {"key": "banner", "span": 6, "wall": {"v": [36, 54], "margin": 0.03},
                 "prompt": "A long festive fabric bunting banner, about 10 : 1: a scalloped plum velvet band with gold fringe along the bottom and a row of triangular pennants in rose, gold, cream and plum hanging below it (no letters)."}]})

    if n == "arcade" and not has(s, "games"):
        s["sheets"].append({"name": "games", "grid": "3x2", "items": [
            {"key": "jukebox", "facing": "sw", "w": 1, "d": 1, "h": 44, "width": 50, "fill": 0.6, "extra": {"light": {"x": 25, "y": 30, "r": 30}},
             "prompt": "A retro 1950s jukebox: a rounded arch top with glowing neon tubes in magenta and cyan, a chrome grille, a window showing records, rows of glowing selection buttons, a wood-and-chrome body. Its front faces along the red arrow."},
            {"key": "jukebox", "facing": "ne", "w": 1, "d": 1, "h": 44, "width": 50, "fill": 0.6,
             "prompt": "The SAME retro neon jukebox seen from behind: its rounded wooden back panel with vents and a power cord, a hint of neon glow at the edges."},
            {"key": "claw-machine", "facing": "sw", "w": 1, "d": 1, "h": 52, "width": 52, "fill": 0.7, "extra": {"light": {"x": 26, "y": 22, "r": 26}},
             "prompt": "A prize claw machine: a glass box full of cute plush toys (a star, a duck, a cat) with a chrome claw hanging from a gantry, a glowing pink marquee on top (no text), a control panel with a joystick and a big button, a prize chute below. Its front faces along the red arrow."},
            {"key": "claw-machine", "facing": "ne", "w": 1, "d": 1, "h": 52, "width": 52, "fill": 0.7,
             "prompt": "The SAME claw machine seen from behind: its glass box with the plush toys visible through it, the back of the pink marquee, a plain panelled base."},
            {"key": "air-hockey", "w": 2, "d": 1, "h": 20, "width": 96, "fit": "diamond",
             "prompt": "An air hockey table two tiles long: a glossy white playfield with a cyan centre line and circles, magenta and cyan rails, two paddles and a puck, a glowing LED strip along the sides, on chrome legs."},
            {"key": "stool.neon", "w": 1, "d": 1, "h": 22, "width": 30, "fill": 0.4, "extra": {"seat": 17},
             "prompt": "A small round chrome bar stool with a glossy magenta vinyl seat and a chrome foot ring."}]})

    if n == "design" and not has(s, "studio2"):
        s["sheets"].append({"name": "studio2", "grid": "3x2", "items": [
            {"key": "dress-form", "facing": "se", "w": 1, "d": 1, "h": 50, "width": 34, "fill": 0.4,
             "prompt": "A dress form mannequin on a turned oak stand with a tripod foot, draped with a half-finished mustard linen jacket pinned together, a tape measure over the shoulders. It faces along the red arrow."},
            {"key": "dress-form", "facing": "nw", "w": 1, "d": 1, "h": 50, "width": 34, "fill": 0.4,
             "prompt": "The SAME dress form with the mustard linen jacket seen from behind: the back of the jacket with pins along the seam, the tape measure hanging down the back, the oak tripod stand."},
            {"key": "plan-chest", "facing": "sw", "w": 1, "d": 1, "h": 24, "width": 62, "fit": "diamond",
             "prompt": "A low wide light-oak plan chest with five shallow drawers and brass cup handles, rolled paper plans, a jar of pencils and a small cactus on top. Its drawers face along the red arrow."},
            {"key": "plan-chest", "facing": "ne", "w": 1, "d": 1, "h": 24, "width": 62, "fit": "diamond",
             "prompt": "The SAME light-oak plan chest seen from behind: its plain oak back panel, the rolled plans and pencil jar on top."},
            {"key": "lamp-arc", "w": 1, "d": 1, "h": 60, "width": 52, "fill": 0.3, "extra": {"light": {"x": 40, "y": 12, "r": 44}},
             "prompt": "A tall mid-century arc floor lamp: a heavy round white marble base, a long curved brass arm, and a large dome shade in terracotta enamel glowing warmly from underneath."},
            {"key": "plant.pothos", "w": 1, "d": 1, "h": 24, "width": 34, "fill": 0.4,
             "prompt": "A terracotta pot on short legs with a lush trailing pothos plant spilling over its rim."}]})
    save(n, s)
print("specs updated")
