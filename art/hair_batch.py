"""Generate the whole hairstyle catalog onto the character frame (front + back), 4 at a time.

  uv run hair_batch.py [style ...]

Each style is drawn by charkit (masked gpt-image edit on the frame's mannequin), extracted to a tone map
and published into src/client/engine/sprites/hairLib.json.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import subprocess
import sys

STYLES: dict[str, tuple[str, bool]] = {
    "short": ("Short neat hair: a soft rounded crop with a tidy fringe along the hairline, short on the sides and back.", False),
    "messy": ("Short, messy, textured hair: a tousled top with a few spiky tufts sticking up, a short fringe sweeping right.", False),
    "crop": ("A very short textured crop, close to the head, with a slightly spiky top.", False),
    "pixie": ("A playful pixie cut: short choppy layers with a side-swept fringe.", False),
    "sidepart": ("A classic side part: hair combed over from a clear parting on the left, glossy and neat.", False),
    "swoop": ("A big glossy quiff swept up and over to the right, with short sides.", False),
    "undercut": ("An undercut: shaved short sides and back with a longer top flopped over to the right.", False),
    "mohawk": ("A bold spiky mohawk: a tall strip of spikes down the middle of the head, shaved sides.", False),
    "buzz": ("A buzz cut: very short fuzzy hair close to the scalp, following the head shape.", False),
    "curlyshort": ("Short tight curls all over the head, bouncy and round.", False),
    "curly": ("Medium-length bouncy curls framing the face down to the jaw, voluminous.", False),
    "afro": ("A big, round, voluminous afro, soft and textured, much wider than the head.", False),
    "bob": ("A sleek chin-length bob with a straight fringe, the ends curving in at the chin.", False),
    "mullet": ("A retro mullet: short on top and sides, long at the back down to the shoulders.", True),
    "long": ("Long straight hair falling past the shoulders, parted in the middle.", True),
    "wavy": ("Long hair with soft waves falling past the shoulders.", True),
    "bangs": ("Straight shoulder-length hair with blunt heavy bangs across the forehead, just above the brows.", True),
    "ponytail": ("Hair pulled back into a high ponytail that swings down behind the head, a few loose strands at the temple.", True),
    "pigtails": ("Two pigtails tied at the sides of the head, hanging down to the shoulders.", True),
    "bun": ("Hair pulled up into a neat round bun on top of the crown.", False),
    "spacebuns": ("Two cute space buns on top of the head, one on each side.", False),
    "braids": ("Long box braids falling past the shoulders.", True),
    "locs": ("Shoulder-length locs, chunky and textured, a few falling in front.", True),
}
COLOR = "in a warm medium chestnut brown"


def run(style: str, view: str, publish: bool, regen: bool) -> str:
    desc, long = STYLES[style]
    prompt = f"{desc} The hair is {COLOR}." if view == "front" else f"The same hairstyle seen from BEHIND: {desc} The hair is {COLOR}."
    cmd = [sys.executable, "charkit.py", "hair", style, "--view", view, "--prompt", prompt]
    if long:
        cmd.append("--long")
    if not publish:
        cmd.append("--no-publish")
    if regen:
        cmd.append("--regen")
    r = subprocess.run(cmd, capture_output=True, text=True)
    first = (r.stdout.strip().splitlines() or [r.stderr.strip()[-200:]])[0]
    return f"{style}/{view}: {'ok' if r.returncode == 0 else 'FAILED'} {first[:90]}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("styles", nargs="*")
    ap.add_argument("--regen", action="store_true")
    a = ap.parse_args()
    styles = a.styles or list(STYLES)
    jobs = [(s, v) for s in styles for v in ("front", "back")]
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for line in ex.map(lambda j: run(j[0], j[1], False, a.regen), jobs):
            print(line, flush=True)
    # publish serially (the library file is shared)
    for s, v in jobs:
        run(s, v, True, False)
    print("published", len(jobs))


if __name__ == "__main__":
    main()
