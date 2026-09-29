"""One-off: wave 6, a permanent refreshment table for Lantern Hall. Idempotent."""
import json
from pathlib import Path

HERE = Path(__file__).parent
p = HERE / "events.json"
s = json.loads(p.read_text(encoding="utf-8"))
if not any(sh["name"] == "buffet" for sh in s["sheets"]):
    s["sheets"].append({"name": "buffet", "grid": "2x1", "items": [
        {"key": "buffet", "facing": "sw", "w": 2, "d": 1, "h": 30, "width": 96, "fit": "diamond",
         "prompt": "A refreshment table two tiles long: a long white tablecloth with a plum velvet runner and gold fringe, two tall glass drink dispensers of pink lemonade and cucumber water with brass taps, a tiered stand of pastel macarons, a tray of little sandwiches, stacked glass tumblers and a small vase of peonies. Its long front faces along the red arrow."},
        {"key": "buffet", "facing": "ne", "w": 2, "d": 1, "h": 30, "width": 96, "fit": "diamond",
         "prompt": "The SAME refreshment table seen from the other side: the white tablecloth and plum runner, the two glass drink dispensers (seen from behind), the macaron stand, the tumblers and the peonies."}]})
    p.write_text(json.dumps(s, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
print("wave 6 specs")
