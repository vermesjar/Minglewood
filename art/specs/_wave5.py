"""One-off: wave 5, composition pieces (plinths and benches for HQ, Launch wall decor, Lantern Hall party
pieces, the Arcade snack-and-prize corner). Idempotent."""
import json
from pathlib import Path

HERE = Path(__file__).parent


def load(n):
    return json.loads((HERE / f"{n}.json").read_text(encoding="utf-8"))


def save(n, s):
    (HERE / f"{n}.json").write_text(json.dumps(s, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def add(room, sheet):
    s = load(room)
    if not any(sh["name"] == sheet["name"] for sh in s["sheets"]):
        s["sheets"].append(sheet)
        save(room, s)


add("hq", {"name": "museum", "grid": "3x2", "items": [
    {"key": "plinth", "facing": "se", "also_facings": ["nw"], "w": 1, "d": 1, "h": 16, "width": 46, "fill": 0.75,
     "prompt": "A square museum display plinth about knee high: navy blue lacquered sides with a slim polished brass band at the foot and a brass-edged top, a flat cream marble top surface. Empty on top. Simple, elegant, symmetric."},
    {"key": "bench.navy", "facing": "sw", "w": 2, "d": 1, "h": 18, "width": 96, "fit": "diamond", "extra": {"seat": 11},
     "prompt": "A long upholstered lobby bench two tiles long with no back: a deep navy velvet cushion with button tufting in a row, a slim white-oak frame and four brass-capped tapered legs. Its long side runs along the red arrow."},
    {"key": "bench.navy", "facing": "ne", "w": 2, "d": 1, "h": 18, "width": 96, "fit": "diamond", "extra": {"seat": 11},
     "prompt": "The SAME backless navy velvet lobby bench seen from the other side: the tufted navy cushion, the white-oak frame, brass-capped legs."},
    {"key": "planter.brass", "facing": "se", "also_facings": ["nw"], "w": 1, "d": 1, "h": 40, "width": 40, "fill": 0.45,
     "prompt": "A tall clipped boxwood topiary ball on a slim trunk, in a square polished brass planter box with a navy band."},
    {"key": "table-side.brass", "facing": "se", "also_facings": ["nw"], "w": 1, "d": 1, "h": 16, "width": 34, "fill": 0.4,
     "prompt": "A small round side table with a white marble top on three slim brass legs, a tiny vase of white tulips and a coffee-table book on it."},
    {"key": "stanchion", "facing": "se", "also_facings": ["nw"], "w": 1, "d": 1, "h": 30, "width": 26, "fill": 0.3,
     "prompt": "A polished brass museum stanchion post on a round weighted brass base, a short loop of deep red velvet rope hanging from the top ring."}]})

add("launch", {"name": "wall2", "kind": "wall", "grid": "3x1", "size": "1536x1024", "items": [
    {"key": "mission-patches", "span": 1, "wall": {"v": [18, 46], "margin": 0.1},
     "prompt": "A deep navy shadow-box frame, portrait 3:4, holding six round embroidered mission patches in two columns: rockets, stars, a lake, a small planet, each with orange, white and gold stitching (no letters)."},
    {"key": "star-map", "span": 2, "wall": {"v": [16, 48], "margin": 0.06},
     "prompt": "A wide framed star chart, about 2 : 1, in a thin brass frame: a deep navy sky with fine gold constellation lines joining white stars, a curved orbit path in orange with a tiny rocket icon on it, a small compass rose in the corner (no letters)."},
    {"key": "clock-wall", "span": 1, "wall": {"v": [28, 46], "margin": 0.16},
     "prompt": "A round industrial wall clock with a navy steel rim, a cream face with bold black tick marks and an orange second hand (no numbers)."}]})

add("events", {"name": "party2", "grid": "2x2", "items": [
    {"key": "cocktail-table", "facing": "se", "also_facings": ["nw"], "w": 1, "d": 1, "h": 36, "width": 40, "fill": 0.4,
     "prompt": "A tall round cocktail table for standing: a white linen cloth gathered at the waist with a plum satin sash tied in a bow, a small glass candle holder with a lit candle and two champagne coupes on top."},
    {"key": "lantern-floor", "facing": "se", "also_facings": ["nw"], "w": 1, "d": 1, "h": 56, "width": 30, "fill": 0.3,
     "extra": {"light": {"x": 15, "y": 14, "r": 42}},
     "prompt": "A tall standing paper lantern floor lamp: a large round rose-and-cream paper lantern glowing warmly from inside, hanging from a curved dark bamboo pole on a round weighted base."},
    {"key": "coat-rack", "facing": "se", "also_facings": ["nw"], "w": 1, "d": 1, "h": 56, "width": 34, "fill": 0.35,
     "prompt": "A dark wooden bentwood coat rack on a tripod foot, a plum wool coat, a cream scarf and a straw hat hanging from its curved hooks, an umbrella leaning against it."},
    {"key": "flower-stand", "facing": "se", "also_facings": ["nw"], "w": 1, "d": 1, "h": 48, "width": 38, "fill": 0.35,
     "prompt": "A tall slim brass flower stand holding a big lush arrangement of pink peonies, cream roses, eucalyptus and trailing greenery."}]})

add("arcade", {"name": "snacks", "grid": "3x2", "items": [
    {"key": "vending-machine", "facing": "sw", "w": 1, "d": 1, "h": 54, "width": 50, "fit": "diamond",
     "extra": {"light": {"x": 22, "y": 30, "r": 30}},
     "prompt": "A retro snack vending machine: a tall glossy magenta cabinet, a big glowing glass front with rows of colorful snacks and soda cans on spiral coils, a lit coin panel and keypad on the right, a pickup flap at the bottom. Its glass front faces along the red arrow."},
    {"key": "vending-machine", "facing": "ne", "w": 1, "d": 1, "h": 54, "width": 50, "fit": "diamond",
     "prompt": "The SAME magenta snack vending machine seen from behind: its plain glossy magenta back panel with vents and a power cord, a glow at the edges."},
    {"key": "prize-counter", "facing": "sw", "w": 2, "d": 1, "h": 26, "width": 96, "fit": "diamond", "extra": {"light": {"x": 48, "y": 30, "r": 34}},
     "prompt": "An arcade prize counter two tiles long: a glowing glass display case full of prizes (plush toys, a rubber duck, yo-yos, candy, a giant pencil, bouncy balls) on shelves, a chrome and magenta frame, a ticket-counting machine and a bell on top. Its glass front faces along the red arrow."},
    {"key": "prize-counter", "facing": "ne", "w": 2, "d": 1, "h": 26, "width": 96, "fit": "diamond",
     "prompt": "The SAME arcade prize counter seen from the attendant's side: open shelves with stacks of prize tickets, a cash drawer, the back of the ticket machine and the bell."},
    {"key": "table-high.neon", "facing": "se", "also_facings": ["nw"], "w": 1, "d": 1, "h": 36, "width": 38, "fill": 0.35,
     "prompt": "A tall round chrome bar table with a glossy black top edged in a glowing cyan neon ring, a basket of fries and two sodas with straws on it."},
    {"key": "popcorn-cart", "facing": "se", "also_facings": ["nw"], "w": 1, "d": 1, "h": 50, "width": 42, "fill": 0.45,
     "extra": {"light": {"x": 21, "y": 20, "r": 26}},
     "prompt": "A little red-and-gold popcorn cart: a glass cabinet full of fluffy popcorn under a warm light, a red roof with gold trim, striped paper popcorn boxes on the shelf below, big spoked wheels."}]})
print("wave 5 specs")
