"""Generate a catalog of character parts onto the frame (front + back), 4 at a time, then publish.

  uv run parts_batch.py top|hat [name ...]
"""
from __future__ import annotations

import concurrent.futures as cf
import subprocess
import sys

TOPS: dict[str, str] = {
    "tee": "a plain crew-neck cotton T-shirt with a round neckline",
    "tank": "a sleeveless tank top with a scooped neckline and narrow shoulder straps, bare shoulders showing",
    "hoodie": "a cosy pullover hoodie: the hood gathered around the back of the neck, two drawstrings, a front kangaroo pocket, ribbed hem",
    "shirt": "a button-up shirt with a pointed collar, a button placket down the middle and a breast pocket",
    "sweater": "a chunky cable-knit crew-neck sweater with visible knit texture and a ribbed hem",
    "turtleneck": "a fitted ribbed turtleneck sweater with a tall folded neck",
    "flannel": "a plaid flannel shirt with a collar and buttons, the check pattern in two darker tones of the same colour",
    "cardigan": "an open knit cardigan with buttons, worn over a plain tee that shows in the middle",
    "jersey": "a sports jersey with a V-neck, a contrast trim at the neck and a stripe across the chest (no numbers or text)",
    "puffer": "a puffy quilted puffer jacket with horizontal baffles, a zip down the middle and a high collar",
    "overalls": "denim-style overalls: a bib with a front pocket and two shoulder straps with buttons, over a plain tee",
    "blazer": "a tailored blazer with notched lapels and two buttons, open over a plain tee",
    "kimono": "a wrap top that crosses over at the front with a wide sash tied at the waist",
}
HATS: dict[str, tuple[str, bool]] = {
    "beanie": ("a slouchy ribbed knit beanie with a folded cuff and a pom-pom on top", False),
    "cap": ("a baseball cap with a curved brim pointing forward toward the lower right", False),
    "capback": ("a baseball cap worn backwards, the brim pointing back toward the upper left behind the head", False),
    "bucket": ("a soft bucket hat with a droopy brim all the way round", False),
    "beret": ("a classic felt beret tilted to one side", False),
    "headband": ("a wide fabric headband across the top of the head", False),
    "bow": ("a big satin hair bow on top of the head, slightly to one side", False),
    "catears": ("a headband with two pointy cat ears with pink insides", False),
    "flowers": ("a flower crown of small colourful blossoms and leaves around the head", False),
    "headphones": ("chunky over-ear headphones with a padded band over the top of the head and round ear cups over the ears", False),
    "cowboy": ("a cowboy hat with a pinched crown, a band, and a wide curled brim", False),
    "crown": ("a small golden crown with points and little red and blue jewels", False),
    "hijab": ("a soft draped hijab that covers the hair, ears and neck, framing the face and falling over the shoulders", True),
    "turban": ("a neatly wrapped turban covering the hair, with visible folds", False),
    "party": ("a striped cone party hat with a pom-pom on the tip, on an elastic", False),
}


def run(kind: str, name: str, view: str, publish: bool) -> str:
    if kind == "top":
        desc = TOPS[name]
        what = f"The torso wears {desc}, in a solid medium teal colour."
        extra = []
    else:
        desc, drape = HATS[name]
        what = f"The head wears {desc}, in a solid medium teal colour (gold for the crown)."
        extra = ["--drape"] if drape else []
    prompt = what if view == "front" else f"Seen from BEHIND. {what}"
    cmd = [sys.executable, "charkit.py", kind, name, "--view", view, "--prompt", prompt, *extra]
    if not publish:
        cmd.append("--no-publish")
    r = subprocess.run(cmd, capture_output=True, text=True)
    return f"{kind}/{name}/{view}: {'ok' if r.returncode == 0 else 'FAILED ' + r.stderr.strip()[-160:]}"


def main():
    kind = sys.argv[1]
    names = sys.argv[2:] or list(TOPS if kind == "top" else HATS)
    jobs = [(n, v) for n in names for v in ("front", "back")]
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for line in ex.map(lambda j: run(kind, j[0], j[1], False), jobs):
            print(line, flush=True)
    for n, v in jobs:
        run(kind, n, v, True)
    print("published", len(jobs))


if __name__ == "__main__":
    main()
