# Minglewood — Art Direction

**North star: a handcrafted diorama you want to live in.** Minglewood should feel like the best
isometric pixel worlds of the 2000s — warm, jewel-toned, crisp, every object readable at a glance,
a few pieces so beautiful people walk over just to look at them — but it is *ours*: no furniture,
avatar or layout from any existing game is copied, traced or closely paraphrased. Our references are
real-world decorative arts (Art Deco brass, Qing jade carving, Arts & Crafts oak, mid-century
upholstery, Italian marble), drawn through a pixel-art lens.

Taste in one line: **cozy, precious, never cheap.** Not generic SaaS. Not muddy. Not noisy.

---

## 1. Grid, scale, light

| Rule | Value |
| --- | --- |
| Projection | 2:1 dimetric. Floor edges run exactly 2 px across per 1 px down. |
| Density | **1 floor tile = 64 × 32 sprite px** (2× the engine's 32 × 16 art units; `Sprite.scale = 2`). Never mix densities in a scene. |
| Light | From the **upper left**. Top faces lightest; left-facing (south-west) faces mid; right-facing (south-east) faces darkest. |
| Shading | 3 tones per material minimum (light / base / shadow) + a 4th highlight for glossy materials. Hue-shift: shadows lean **plum/blue**, highlights lean **warm cream/yellow**. Never shade by adding black or white. |
| Edges | Crisp, hand-placed pixels. No soft brushes or blur on sprites. Glows and light pools are separate additive layers. |

## 2. Outlines — selective, never black

- The outer silhouette uses a **darkened, plum-shifted version of the adjacent fill** ("sel-out"),
  so a brass lamp gets a deep amber line and a sage sofa a deep green one. Pure `#000` never appears.
- Interior lines only where materials change or a form turns sharply. Upholstery seams and
  wood joints are drawn with the material's shadow tone, not an outline.
- The top-left edge of a form may carry a 1 px highlight rim; that's what makes things *pop*.

## 3. Palette

Named ramps (dark → light). Anything we draw should map onto these; per-company themes swap
ramps, not individual colors.

| Ramp | Colors |
| --- | --- |
| Ink / plum (outlines, deepest shadows) | `#1d1522` `#2a1f2d` `#43324a` `#5e4a66` |
| Paper / cream | `#c9b79a` `#e4d3b5` `#f6ead6` `#fff8ec` |
| Oak | `#5a3522` `#7a4a2e` `#a0683f` `#c98f5a` `#e5b47a` |
| Walnut | `#2f1d17` `#4a2c20` `#6b4230` `#8c5a3f` |
| Terracotta | `#7a3325` `#a8492f` `#d0663f` `#ec9160` |
| Sage / jade | `#1f4b3c` `#2f6d55` `#3f9a6b` `#76c49a` `#bfe6c8` |
| Brass / gold | `#6b3f10` `#a8661a` `#d99a2b` `#f2c14e` `#ffe89a` `#fffbe6` |
| Velvet oxblood | `#3d0f1a` `#6b1a2c` `#9b2c3f` `#c9505e` |
| Lake blue | `#1f3a5c` `#2f5f8f` `#3f8fd8` `#8cc6ef` `#d7efff` |
| Marble | `#8d8494` `#bdb5c2` `#e7e1e8` `#fbf8fb` (veins `#9c8fb0`) |

## 4. Materials (how each is drawn)

- **Wood** — 3 tones + grain lines along the long axis in the shadow tone, broken every few px.
  Top faces lighter with a 1 px front-edge highlight. Joints at board ends.
- **Brass / gold** — 5 tones, strongly contrasted: deep amber shadow → mid gold → bright yellow →
  near-white glint. Hard 1–2 px specular dots on every convex turn. Gold is *the* pop material;
  use it where it earns attention.
- **Glass** — pale cyan-white at low opacity feel, two parallel diagonal reflection strokes
  (top-left to bottom-right), a bright rim on the lit edge.
- **Velvet / fabric** — soft 3–4 tone ramp, no hard specular. Tufting = a shadow pixel with a light
  pixel just below it. Piping on edges in a contrasting tone.
- **Marble / stone** — cream-violet base, thin broken veins, one polished highlight band.
- **Jade** — deep green → mint with a milky, slightly cyan highlight; carved detail as shadow cuts.
- **Plants** — 3–4 greens, lighter leaf tips toward the light, a few leaves overlapping the pot rim.
  Terracotta or glazed pots with a rim highlight.
- **Paper, screens, signage** — flat and bright, a little glow for screens. No readable brand text
  in sprites (labels are rendered by the UI).

## 5. Rooms: light and atmosphere

A room is lit, not just colored.

- **Floors** are materials, never noise: planks with staggered joints and per-board tone variance and
  a faint sheen band; checkerboard or herringbone tiles; carpet with a subtle weave. Rugs have
  borders and a motif.
- **Walls** have construction: baseboard, wainscot or panelling on the lower third, a chair rail,
  wallpaper or plaster above, a crown trim on top. Windows have sills, mullions and depth.
- **Daylight**: every window throws a soft, warm parallelogram of light onto the floor (additive,
  low alpha), angled consistently with the upper-left light.
- **Lamps glow**: a radial additive glow at the shade and a warm pool on the floor below.
- **Contact shadows**: every object and person sits on a soft, low-alpha plum shadow. Ambient
  occlusion darkens the seam where floor meets wall.
- Rooms float on the dark plum void, so the diorama edge (floor slab) is part of the composition.

## 6. Characters

- Proportions: chibi-leaning but with **real shoulders**, a neck hint and a waist — head ≈ 40 % of
  standing height. Standing height ≈ 88 px at 2× (without hats). Head ≈ 30 px wide.
- Faces must read at 1:1: eyes are 2–3 px tall with a light catch pixel, brows 1 px, mouth 1–2 px
  with a clear shape. Cheeks get a soft blush pixel pair when chosen.
- Hair: 3 tones + a highlight band that follows the upper-left light; silhouette first (the hairstyle
  must be recognisable as a silhouette alone).
- Clothing: 3 tones, fold pixels at elbows/waist, a collar/neckline shape per garment, pattern
  overlays follow the torso.
- Motion: arms swing opposite the legs; a 1 px head bob on the passing frame. Sitting, waving and
  wheelchair poses are first-class, never afterthoughts.
- Every avatar sits on a soft elliptical contact shadow.
- All wardrobe items (hair, headwear incl. hijab and turban, eyewear, neckwear, tops, patterns,
  bottoms, shoes, held items, pets, wheelchair, cane) keep working in all four facings.

## 7. Heirlooms (the premium collection)

Showpieces are the jewelry of a room: the most contrast, the richest materials, the one place where
gold and gloss are allowed to shout. Each has:
- an original design grounded in a real decorative tradition (never a lookalike of a game item);
- a **moment** — a slow glint sweep, a flicker, bubbles, a sway;
- a story: it's earned by a company milestone and carries a provenance plaque.

## 8. Company vibes (theme packs)

A company's world is re-skinned by swapping ramps: **Heritage** (walnut, brass, oxblood, marble),
**Nordic** (birch, sage, linen, lake blue), **Neon Arcade** (plum, magenta, cyan, chrome),
**Garden** (terracotta, jade, cream, oak). Sprites that must recolor are authored against ramps.

---

## Generation protocol (gpt-image, via `art/studio.py`)

1. Every prompt starts with the **STYLE** block from `art/prompts.py`, verbatim. Consistency comes
   from repetition.
2. Generate on a **transparent background**, several objects per sheet in a strict grid (one object
   per cell, generous spacing) so a set shares one style.
3. Explore at `medium`, finish at `high`. Hard budget in `art/budget.json`; the tool refuses to spend
   past it.
4. Post-process with `studio.py pixelize`: trim → downsample to the exact sprite size → quantize →
   hard alpha → sel-out outline check.
5. **Look at every result** (contact sheet, then 1:1 and 4× in the sprite lab, then in the room).

**Reject** (regenerate, don't publish) when: the angle isn't 2:1 isometric; perspective drifts
(vanishing lines); the object is cropped or fused with a neighbour; there's baked-in text, logos or
a floor/shadow; it reads as soft or blurry after pixelizing; it looks like a known game asset; it
fights the palette of its room.
