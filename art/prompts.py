"""Prompt blocks for Minglewood art. STYLE is prepended verbatim to every generation (`gen --style`)."""

STYLE = """\
STYLE — Minglewood isometric pixel art (repeat exactly):
Premium isometric pixel art game asset for a cozy, handcrafted social world, in the spirit of classic 2000s \
isometric hotel/room games but entirely original. Strict 2:1 dimetric isometric projection: every floor-aligned \
edge runs exactly 2 pixels across for each 1 pixel down (about 26.6 degrees), seen from above the front corner, \
with no perspective and no vanishing points — parallel edges stay parallel. Crisp hand-placed pixels in clean \
clusters; no blur, no soft airbrush, no noise, no dithering speckle. Light comes from the upper left: top faces \
lightest, left-facing sides medium, right-facing sides darkest. Shadows are hue-shifted toward plum and blue, \
highlights toward warm cream. Selective outlines: each silhouette is outlined with a darker shade of that \
object's own color, never pure black. Warm, rich, jewel-toned palette. Materials rendered with care: wood with \
grain lines, brass and gold with bright specular glints, velvet with soft tufting, glass with two diagonal \
reflection streaks, marble with fine veins, jade with milky highlights. Charming, slightly chunky proportions \
that read clearly at small size. Each object isolated on a fully transparent background: no floor, no ground, \
no cast shadow, no text, no logos, no watermark, no frame."""

SHEET = """\
LAYOUT: a sprite sheet with exactly {n} separate objects arranged in a {cols} by {rows} grid. One object \
centered in each grid cell, never touching or overlapping another cell, with generous empty transparent space \
around each. All objects share one consistent pixel scale where one floor tile is about {tile} pixels wide.\
"""


def sheet(items: list[str], cols: int, rows: int, tile: int = 150) -> str:
    """A sheet prompt body: layout block + numbered cell descriptions (left→right, top→bottom)."""
    lines = [SHEET.format(n=len(items), cols=cols, rows=rows, tile=tile), "", "CELLS (left to right, top to bottom):"]
    lines += [f"{i + 1}. {d}" for i, d in enumerate(items)]
    return "\n".join(lines)

WALL_STYLE = """\
STYLE — Minglewood wall art (repeat exactly):
Premium pixel art game asset for a cozy, handcrafted social world. A FLAT, perfectly front-facing orthographic \
view — no isometric angle, no perspective, no tilt — exactly as if the object were scanned straight on; it will be \
mapped onto a wall in the game. Crisp hand-placed pixels in clean clusters; no blur, no noise, no dithering speckle. \
Light from the upper left. Shadows hue-shifted toward plum, highlights toward warm cream. Outlines are darker shades \
of each object's own color, never pure black. Warm, rich, jewel-toned palette with real materials: gilded frames \
with bright glints, dark slate chalkboards with soft chalk, polished brass. Each object isolated on a fully \
transparent background filling its cell edge to edge: no wall, no shadow, no text or letters, no logos, no \
watermark."""


# THE SEATING TYPES — what the game's seat rules assume of a drawing, per family (src/client/engine/sprites/
# seatModelFit.ts familyOf; the kinds the rules read off the fitted model: src/shared/world/seatModels.ts seatKind).
# Every seat is drawn to its construction guide: the floor diamond is its footprint, the wire box its height, and the
# thin GREEN rectangle the top of its cushion — the surface a person sits on. The backrest stands directly behind the
# cushion at the far edge of the footprint (never beside it), arms at the sides, legs inside the footprint. The back
# view is the same three-quarter 2:1 view turned round, never a straight-on rear view.
SEAT_FAMILIES = {
    "floor-cushion": "A soft low floor cushion or meditation pillow, resting directly on the floor with no legs or back. "
                     "The top is the green sitting plane. Leave clear floor in front for bent knees and feet.",
    "chair": "A single chair for one person: a cushion or seat pan filling most of the footprint with its top exactly at "
             "the green cushion plane, four legs inside the footprint, a backrest rising from the cushion's back edge, "
             "no arms unless described.",
    "armchair": "A single armchair for one person: a deep cushion with its top exactly at the green cushion plane, a thick "
                "padded backrest rising from the cushion's back edge, padded arms of equal height along both sides, "
                "short feet inside the footprint.",
    "couch": "A sofa with one sitting place per tile across its footprint: one long cushion or individual cushions with its top exactly "
             "at the green cushion plane, a padded backrest along the whole back edge, matching arms at both ends, "
             "short feet inside the footprint.",
    "bench": "A bench with one sitting place per tile across its footprint: a long flat seat with its top exactly at the green cushion "
             "plane, on legs or a frame inside the footprint; a backrest along the back edge only if described.",
    "stool": "A round stool for one person, no back and no arms: a small round seat with its top exactly at the green "
             "cushion plane, on legs or a column centred in the footprint.",
    "beanbag": "A beanbag for one person: a soft sack squashed into a seat, its dented top at the green cushion plane and "
               "a plump rise behind it as a backrest, filling most of the footprint, no legs.",
    "ottoman": "A round upholstered ottoman for one person, no back and no arms: a padded top exactly at the green "
               "cushion plane, on short feet inside the footprint.",
    "throne": "A single throne for one person: a cushion with its top exactly at the green cushion plane, a very tall "
              "ornate backrest rising from its back edge, solid arms along both sides, on a base inside the footprint.",
}

