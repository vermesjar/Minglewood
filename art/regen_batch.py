"""Regenerate specific part views with hand-written prompts (4 at a time), then publish them serially.

  uv run regen_batch.py            # the list below
  uv run regen_batch.py hair-long-back top-shirt-back
"""
from __future__ import annotations

import concurrent.futures as cf
import subprocess
import sys

COLOR = {"hair": "in a warm medium chestnut brown", "top": "in a solid medium teal colour"}

# job → (prompt, extra flags). Back views describe what is actually visible from behind, because the model
# otherwise copies front details (buttons, pockets, lapels) onto the back.
JOBS: dict[str, tuple[str, list[str]]] = {
    "hair-pigtails-back": ("Seen from BEHIND: the hair is parted straight down the middle of the back of the head and "
                           "gathered into two pigtails tied just behind the ears, each hanging down to the shoulder.", ["--long"]),
    "hair-ponytail-back": ("Seen from BEHIND: the hair is pulled smoothly back into a high ponytail tied at the back of "
                           "the crown; the ponytail hangs straight down the middle of the back to between the shoulder "
                           "blades, no wider than the neck.", ["--long"]),
    "hair-long-back": ("Seen from BEHIND: long straight hair covering the back of the head and falling straight down "
                       "the back to the shoulder blades, no wider than the shoulders.", ["--long"]),
    "hair-mullet-back": ("Seen from BEHIND: short on the crown, a longer layer at the nape falling to the top of the "
                         "shoulders, no wider than the neck.", ["--long"]),
    "hair-braids-front": ("Long box braids: about eight thick, distinct braids with clear gaps between them, framing the "
                          "face and falling past the shoulders.", ["--long"]),
    "hair-braids-back": ("Seen from BEHIND: about eight thick, distinct box braids with clear gaps between them, hanging "
                         "straight down the back to the shoulder blades, no wider than the shoulders.", ["--long"]),
    "hair-undercut-back": ("Seen from BEHIND: an undercut: the back and sides are clipped very short (a flat even layer "
                           "close to the scalp), the longer top swept over to one side.", []),
    "top-sweater-front": ("A cosy crew-neck knit sweater: smooth knit in clean flat colour with two or three vertical "
                          "cable lines down the front as single shade pixels, a ribbed neckline and hem. No speckles "
                          "or noise texture.", []),
    "top-sweater-back": ("Seen from BEHIND: the back of a cosy knit sweater: smooth knit in clean flat colour, a ribbed "
                         "hem, the neckline as a band at the nape. No speckles or noise texture.", []),
    "hair-afro-front": ("A rounded afro, soft and textured, about one and a half times as wide as the head and a "
                        "little taller than it; the hair frames the face and ends at the jaw.", []),
    "hair-afro-back": ("Seen from BEHIND: a rounded afro, soft and textured, about one and a half times as wide as the "
                       "head, covering the whole back of the head down to the nape.", []),
    "top-hoodie-back": ("Seen from BEHIND: the back of a pullover hoodie: the empty hood lies flat between the "
                        "shoulder blades, a plain back, a ribbed hem. No pocket and no drawstrings on the back.", []),
    "top-shirt-back": ("Seen from BEHIND: the back of a button-up shirt: the collar folded round the back of the neck, "
                       "a yoke seam across the shoulders, a plain back. NO buttons and NO pocket.", []),
    "top-blazer-back": ("Seen from BEHIND: the back of a tailored blazer: a smooth back with a centre seam and the "
                        "collar at the nape. NO lapels, NO buttons, no shirt showing.", []),
    "top-jersey-back": ("Seen from BEHIND: the back of a sports jersey: a round contrast trim at the nape and the stripe "
                        "continuing across the back. No numbers or text.", []),
    "top-cardigan-back": ("Seen from BEHIND: the back of a knit cardigan: a plain knit back with a ribbed hem. No buttons.", []),
    "top-overalls-back": ("Seen from BEHIND: the back of denim-style overalls over a plain tee: two straps crossing in "
                          "an X over the tee, the top of the back panel at the waist.", []),
    "top-kimono-back": ("Seen from BEHIND: the back of a wrap top: smooth fabric, a wide sash round the waist tied in a "
                        "bow at the back.", []),
}


def split(job: str) -> tuple[str, str, str]:
    kind, rest = job.split("-", 1)
    name, view = rest.rsplit("-", 1)
    return kind, name, view


def run(job: str) -> str:
    kind, name, view = split(job)
    prompt, flags = JOBS[job]
    prompt = f"{prompt} The {'hair' if kind == 'hair' else 'garment'} is {COLOR[kind]}."
    cmd = [sys.executable, "charkit.py", kind, name, "--view", view, "--prompt", prompt, "--regen", "--no-publish", *flags]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return f"{job}: {'ok' if r.returncode == 0 else 'FAILED ' + r.stderr.strip()[-200:]}"


def main():
    jobs = sys.argv[1:] or list(JOBS)
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for line in ex.map(run, jobs):
            print(line, flush=True)
    r = subprocess.run([sys.executable, "charkit.py", "extract", *jobs], capture_output=True, text=True)
    print(r.stdout.strip() or r.stderr.strip()[-400:])


if __name__ == "__main__":
    main()
