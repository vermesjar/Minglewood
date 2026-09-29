"""One-off: wave 4, back views for pieces drawn once (tables, the rocket, balloons) so every rotation exists.
Each front item gets an explicit facing; a 1x1 reference sheet per piece draws the same object from behind."""
import json
from pathlib import Path

HERE = Path(__file__).parent


def load(n):
    return json.loads((HERE / f"{n}.json").read_text(encoding="utf-8"))


def save(n, s):
    (HERE / f"{n}.json").write_text(json.dumps(s, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


# room -> [(key, front facing, back facing, what it is)]
BACKS = {
    "arcade": [("air-hockey", "sw", "ne", "air hockey table"), ("pool-table", "sw", "ne", "pool table")],
    "launch": [("table-long", "sw", "ne", "war-room table"), ("rocket-model", "se", "nw", "cardboard model rocket on its plywood launch stand")],
    "design": [("table-long.light", "sw", "ne", "light oak worktable")],
    "events": [("cake-table", "sw", "ne", "party table"), ("balloons", "se", "nw", "balloon bunch"),
               ("balloons.b", "se", "nw", "balloon bunch"), ("balloons.c", "se", "nw", "balloon bunch")],
}
TABLE_NOTE = ("The second reference image shows this exact {what}. Draw the SAME {what} from the OPPOSITE side, turned "
              "half way round: the same shape, size, colours and pixel style, with everything on it seen from the other "
              "side (what was on the left is now on the right, what was at the back is now at the front). Its long side "
              "still runs from the upper left to the lower right.")
ROUND_NOTE = ("The second reference image shows this exact {what}. Draw the SAME {what} seen from the other side, turned "
              "half way round: same shape, size, colours and pixel style.")

for room, pieces in BACKS.items():
    s = load(room)
    for key, front, back, what in pieces:
        src = None
        for sh in s["sheets"]:
            for it in sh["items"]:
                if it.get("key") == key and not it.get("facing"):
                    it["facing"] = front
                    src = (sh, it)
                elif it.get("key") == key and it.get("facing") == front:
                    src = (sh, it)
        if not src:
            raise SystemExit(f"{room}: no front for {key}")
        sh, it = src
        name = f"back-{key.replace('.', '-')}"
        if any(x["name"] == name for x in s["sheets"]):
            continue
        item = {k: v for k, v in it.items() if k not in ("prompt", "facing", "also")}
        item.update({"facing": back, "prompt": f"The {what} from the reference, seen from the other side."})
        note = (TABLE_NOTE if it.get("w", 1) != it.get("d", 1) else ROUND_NOTE).format(what=what)
        s["sheets"].append({"name": name, "grid": "1x1", "size": "1024x1024", "tile": 300,
                            "refs": [f"out/{room}/{sh['name']}/{key}.{front}.raw.png"], "note": note, "items": [item]})
    if room == "arcade":
        for sh in s["sheets"]:
            for it in sh["items"]:
                if it.get("key") == "arcade-cabinet.pink" and it.get("facing") == "sw":
                    it["also"] = ["arcade-cabinet"]
    save(room, s)
print("wave 4 specs")
