"""Faces from image generation, on the character standard.

  uv run facekit.py            # generate (if needed) + extract + publish every face
  uv run facekit.py --regen dot-smile

Each job draws one whole face (eyes, brows, mouth) on the bare template head (art/review/ref-face-front.png,
exported by scripts/export-refs.ts), with only the face zone editable. The result is split into elements and
each is CONFORMED to the standard: every eye is centred on the frame's eye anchor (where glasses hang), the
mouth on the mouth anchor, the brows just above the eyes. Tones, tinted by the kit:
  k line/pupil   w white   i iris (eye colour)   h highlight   p lips/tongue   s skin shade   b brow (hair colour)
Output: src/client/engine/sprites/faceLib.json  {eyes: {style: map}, mouth: {style: map}, brows: {style: map}}
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures as cf
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import studio  # noqa: E402
from charkit import CANVAS, OFFSET, S, snap_grid  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE / "out" / "facekit"
LIB = HERE.parent / "src" / "client" / "engine" / "sprites" / "faceLib.json"
X0, Y0 = 34, 36  # head box (stand pose)
# the standard's anchors (src/client/engine/sprites/avatarFrame.ts)
EYE_NEAR, EYE_FAR, MOUTH = (41, Y0 + 11), (49, Y0 + 11), (47, Y0 + 16)
ZONE = (X0 + 3, Y0 + 3, X0 + 21, Y0 + 20)  # x0, y0, x1, y1 (frame px) the model may draw in

EYES = {
    "dot": "friendly classic eyes: each eye has a dark upper lash line, a white, a vivid pure-blue iris with a dark pupil and one tiny white highlight",
    "wide": "big bright open eyes: each eye a little taller, a white on both sides of a vivid pure-blue iris, a dark pupil and a white highlight, a clean dark lash line",
    "lashes": "eyes with pretty lashes: a thicker dark upper lash line that flicks out at the outer corner, a vivid pure-blue iris, a dark pupil and a white highlight",
    "happy": "happy closed eyes: each eye is a dark upward arc (^), smiling eyes, no iris showing",
    "sleepy": "sleepy half-closed eyes: a heavy dark upper lid covering the top half, the vivid pure-blue iris showing below it",
    "wink": "a wink: the near (left) eye open with a dark lash line, a vivid pure-blue iris, pupil and highlight; the far (right) eye closed as a dark downward-curved line",
    "sparkle": "sparkly delighted eyes: a vivid pure-blue iris with a big white highlight and a second small highlight, a dark lash line",
}
MOUTHS = {
    "smile": "a small warm closed smile, a dark curved line with slightly upturned corners",
    "o": "a small round surprised 'o' mouth, a dark outline with a darker inside",
    "smirk": "a sly smirk: a short dark line lifted at the right corner",
    "grin": "a big open grin showing a band of white teeth, with a dark outline",
    "neutral": "a calm neutral mouth: a short straight dark line",
    "tongue": "a cheeky smile with a little pink tongue poking out",
}
JOBS = {  # face → (eyes, mouth, brows)
    "dot-smile": ("dot", "smile", "soft"),
    "wide-o": ("wide", "o", "soft"),
    "lashes-smirk": ("lashes", "smirk", "soft"),
    "happy-grin": ("happy", "grin", "bold"),
    "sleepy-neutral": ("sleepy", "neutral", "soft"),
    "wink-tongue": ("wink", "tongue", "soft"),
    "sparkle-smile": ("sparkle", "smile", "soft"),
}
BROWS = {
    "soft": "short soft eyebrows just above each eye, 3 pixels wide, in dark brown",
    "bold": "bold thick eyebrows just above each eye, 4 pixels wide and 2 pixels tall, in dark brown",
}


def reference() -> Image.Image:
    fig = Image.open(HERE / "review" / "ref-face-front.png").convert("RGBA")
    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    canvas.paste(fig, OFFSET, fig)
    return canvas


def mask() -> Image.Image:
    a = np.zeros((CANVAS[1], CANVAS[0], 4), np.uint8)
    a[..., 3] = 255
    x0, y0, x1, y1 = ZONE
    a[OFFSET[1] + y0 * S: OFFSET[1] + y1 * S, OFFSET[0] + x0 * S: OFFSET[0] + x1 * S, 3] = 0
    return Image.fromarray(a)


def generate(name: str, regen: bool, quality: str) -> str:
    OUT.mkdir(parents=True, exist_ok=True)
    raw = OUT / f"{name}.raw.png"
    if raw.exists() and not regen:
        return f"{name}: cached"
    eyes, mouth, brows = JOBS[name]
    ref, msk = OUT / "ref.png", OUT / "mask.png"
    reference().save(ref)
    mask().save(msk)
    prompt = (
        "This is a pixel-art game avatar enlarged 8×: every art pixel is an exact 8×8 square block. The head is "
        "shown in 3/4 front view, facing the viewer's lower right. Draw ONLY a face inside the transparent (masked) "
        "area, on exactly the same 8×8 pixel grid, in crisp classic isometric social-game (hotel) avatar style: "
        "small, clear, charming, readable at 1:1. Keep the head, its outline and everything else exactly as it is. "
        "The near eye sits left of centre and the far eye to its right, close together because the head is turned; "
        "the mouth is centred below them, slightly toward the right. "
        f"Eyes: {EYES[eyes]}. Each open eye is 3 pixels wide and 3-4 pixels tall. NO eyebrows (they are added "
        "separately) — leave the forehead above the eyes plain skin. "
        f"Mouth: {MOUTHS[mouth]}. No nose lines, no blush, no freckles, no anti-aliasing, no gradients."
    )
    (OUT / f"{name}.prompt.txt").write_text(prompt, encoding="utf-8")
    files = [("image[]", (ref.name, ref.read_bytes(), "image/png")), ("mask", (msk.name, msk.read_bytes(), "image/png"))]
    data = {"model": studio.MODEL, "prompt": prompt, "size": f"{CANVAS[0]}x{CANVAS[1]}", "quality": quality,
            "background": "transparent", "n": "1", "output_format": "png"}
    t = time.time()
    j = studio.post(f"{studio.API}/images/edits", files=files, data=data)
    ns = argparse.Namespace(model=studio.MODEL, quality=quality, size=data["size"], count=1)
    usd = studio.log("facekit", ns, j.get("usage"), time.time() - t, f"face-{name}")
    raw.write_bytes(base64.b64decode(j["data"][0]["b64_json"]))
    return f"{name}: generated (${usd:.3f}, total ${studio.spent():.2f})"


def classify(c: np.ndarray, skin: np.ndarray) -> str | None:
    """One snapped pixel → face tone (None = bare skin)."""
    import colorsys

    r, g, b = (c[:3] / 255).tolist()
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    if np.abs(c[:3].astype(int) - skin[:3].astype(int)).sum() < 40:
        return None
    if lum > 0.82 and s < 0.35:
        return "w"
    if 0.52 <= h <= 0.72 and s > 0.3 and lum > 0.18:
        return "i"
    if (h >= 0.9 or h <= 0.03) and s > 0.3 and lum > 0.25:
        return "p"
    if lum < 0.3:
        return "k"
    return "s"


def extract(name: str) -> dict:
    """Snap the face and split it by the face's own structure — the eye band (rows with whites / irises, plus
    the lash row above), brows above it, the mouth below — near and far halves either side of the centre line.
    Each element is then conformed to its anchor on the standard."""
    grid = snap_grid(Image.open(OUT / f"{name}.raw.png"))
    base = np.array(Image.open(HERE / "review" / "ref-face-front-1x.png").convert("RGBA"))
    x0, y0, x1, y1 = ZONE
    skin = base[Y0 + 11, X0 + 11, :3].astype(int)
    tone = np.full((112, 88), "", dtype=object)
    for y in range(y0, y1):
        for x in range(x0, x1):
            if grid[y, x, 3] == 0 or base[y, x, 3] == 0 or base[y, x, :3].astype(int).sum() < 200:
                continue
            t = classify(grid[y, x], skin)
            if t:
                tone[y, x] = t
    # dark pixels hugging the head's outline are the model redrawing the jaw / cheek line, not features
    import cv2
    outline = ((base[..., :3].astype(int).sum(-1) < 200) & (base[..., 3] > 0)).astype(np.uint8)
    near_outline = cv2.dilate(outline, np.ones((5, 5), np.uint8)).astype(bool)
    for y in range(y0, y1):
        for x in range(x0, x1):
            if tone[y, x] == "k" and near_outline[y, x]:
                tone[y, x] = ""
    has = lambda y, ts: any(tone[y, x] != "" and tone[y, x] in ts for x in range(x0, x1))
    # no brows are drawn: the eyes are every feature row above the mouth
    drawn = [y for y in range(y0, Y0 + 13) if has(y, "kwih")]
    e0, e1 = (min(drawn), max(drawn)) if drawn else (Y0 + 8, Y0 + 10)
    # columns: the empty column between the two eyes
    occ = [x for x in range(x0, x1) if any(tone[y, x] != "" and tone[y, x] in "kwih" for y in range(e0, e1 + 1))]
    gaps = [x for x in range(X0 + 7, X0 + 17) if x not in occ]
    mid = (min(gaps, key=lambda g: abs(g - (X0 + 12))) + 0.5) if gaps else (EYE_NEAR[0] + EYE_FAR[0]) / 2 + 0.5
    bands = {"eyes": range(e0, e1 + 1), "mouth": range(e1 + 2, min(y1, Y0 + 18))}
    keep = {"brows": "k", "eyes": "kwihs", "mouth": "kwp"}
    out = {}
    for el, rows in bands.items():
        sides = [("near", lambda x: x < mid), ("far", lambda x: x >= mid)] if el != "mouth" else [("all", lambda x: True)]
        placed = np.full((112, 88), "", dtype=object)
        for side, inside in sides:
            pts = [(y, x) for y in rows for x in range(x0, x1) if inside(x) and tone[y, x] and tone[y, x] in keep[el]]
            if el == "eyes":  # a shade pixel only counts as a lid crease next to the eye
                pts = [(y, x) for y, x in pts if tone[y, x] != "s" or any(tone[y + a, x + b] != "" and tone[y + a, x + b] in "kwi" for a, b in ((0, 1), (0, -1), (1, 0), (-1, 0)))]
            if el == "mouth" and pts:
                # the mouth is its main shape (stray jaw bits are separate pieces)
                m = np.zeros((112, 88), np.uint8)
                for y, x in pts:
                    m[y, x] = 1
                n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
                big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
                pts = [(y, x) for y, x in pts if lab[y, x] == big]
            if not pts:
                continue
            ys = [p[0] for p in pts]
            xs = [p[1] for p in pts]
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            if el == "eyes":
                ax, ay = EYE_NEAR if side == "near" else EYE_FAR
                ay += 0.5
            elif el == "brows":
                ax, ay = (EYE_NEAR if side == "near" else EYE_FAR)[0], None
            else:
                ax, ay = MOUTH[0], MOUTH[1] + 0.5
            dx = int(round(ax - cx))
            dy = int(round(ay - cy)) if ay is not None else 0
            for y, x in pts:
                placed[y + dy, x + dx] = "b" if el == "brows" else tone[y, x]
        # brows sit two rows above the conformed eye tops
        ys, xs = np.where(placed != "")
        if not len(ys):
            continue
        out[el] = {"x": int(xs.min()), "y": int(ys.min()),
                   "rows": ["".join(placed[y, x] or "." for x in range(xs.min(), xs.max() + 1)).rstrip(".") or "." for y in range(ys.min(), ys.max() + 1)]}
    if "brows" in out and "eyes" in out:
        out["brows"]["y"] = out["eyes"]["y"] - len(out["brows"]["rows"]) - 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--regen", nargs="*", default=[])
    ap.add_argument("--quality", default="high")
    a = ap.parse_args()
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for line in ex.map(lambda n: generate(n, n in a.regen, a.quality), JOBS):
            print(line, flush=True)
    lib = {"eyes": {}, "mouth": {}}
    for name, (eyes, mouth, brows) in JOBS.items():
        parts = extract(name)
        (OUT / f"{name}.json").write_text(json.dumps(parts, indent=1), encoding="utf-8")
        if "eyes" in parts:
            lib["eyes"].setdefault(eyes, parts["eyes"])
        if "mouth" in parts:
            lib["mouth"].setdefault(mouth, parts["mouth"])
        print(name, {k: len(v["rows"]) for k, v in parts.items()})
    LIB.write_text(json.dumps(lib, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("published", {k: sorted(v) for k, v in lib.items()})


if __name__ == "__main__":
    main()
