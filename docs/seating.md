# Seating: the framework, the art, the grade

Every seat in Minglewood is built on one framework. There is no seat art that a model has to be fitted to: the model
is the art. A seat is a **spec** (`src/shared/art/seatCatalog.ts`) on one of nine **kinds**
(`src/shared/world/seatSpec.ts`); the spec builds a 3D model of boxes and cylinders; the renderer draws that model in
all four facings (`src/shared/art/seatRender.ts`) and hands back, with every pixel, the height at which its view ray
meets the seat; and a sitter is composed against that depth pixel by pixel (`src/shared/art/seatCompose.ts`). The
grade (`src/shared/art/seatGrade.ts`) measures every seat, in every facing, with every review look on every
cushion, offline and then in the running game.

## The figure sets the sizes

The character (`src/shared/world/seatFigure.ts`, `avatarFrame.ts`) stands 34 world px tall with its hip 11 px above
its feet; seated, its thighs reach `SEAT_REACH` (0.4 tile; 0.5 on the floor) and its shins `SHIN_MAX` (12 px). The
kinds are sized from that, never from real furniture: a cushion the figure can put its feet on the floor from
(≤ 10.5), a back that stops under the ears (≤ 17 above the cushion), arms a forearm rests on (3–9 above the cushion).
The old generated seats were drawn at real-world proportions (cushions at 10–22 px on a figure whose seated hip is
6.5 px above its feet), which is why every sitter's legs were stretched and every view needed a hand-tuned exception.

| kind | footprint | cushion | back | arms | legs | sat as |
| --- | --- | --- | --- | --- | --- | --- |
| chair | 1×1 | 10 | rails, ladder or slab, 12 | none or rails | block, turned, tapered or a cross base | chair |
| armchair | 1×1 | 9 | padded or wing, 13 | padded or roll, 6 | a skirt on feet | lounge |
| couch | 2×1 | 9 | padded, 13 | padded or roll, 6 | a skirt on feet | lounge |
| bench | 2×1 | 9.5 | none or slats, 11 | none | ends, iron ends, blocks | chair |
| stool | 1×1 | 10 | none | none | a column | stool |
| barstool | 1×1 | 15 (footring at 5.5) | none | none | a column | stool |
| beanbag | 1×1 | 4.5 | a rolled back, 6.5 | none | none | floor |
| ottoman | 1×1 | 7.5 | none | none | feet | chair |
| throne | 1×1 | 10 | a slab with a crest, 16 | solid, 6 | blocks on a plinth | chair |

A spec chooses a kind, materials (fabric, frame, trim, accent: a colour and a material kind, which sets the ramp's
contrast) and, within the kind's limits, its cushion, back, arms, legs and footrest. `buildSeat` turns it into parts
in the seat's local frame (u across, v from the front edge, z up: `seatModels.ts`) and places one sitting point per
cushion by **the standard**: the pelvis `SIT_GAP` (0.1 tile) in front of the back's face, or a touch behind the
middle of a backless seat, sat forward when the thighs wouldn't reach the front from there; the knees `KNEE_OUT` past
the front edge; the shins down to the floor or the footrest (`sitLegs.ts`). One point in the world, the same from
every side.

## The render

`renderSeat(model, materials, facing)` casts every pixel's view ray into the parts and keeps the nearest surface
(the camera is toward +x, +y and up, so the higher hit is the nearer). The surface picks the tone the house style
asks for (`art/ART_DIRECTION.md`): tops lightest, sides toward screen-left mid, toward screen-right darkest; a soft
top rolls over at its front edges; details (tufting, grain, cane weave, seams) are stamped in the surface's own
coordinates so they turn with the seat; a contact shadow falls where a nearer part meets a farther one; a rim of
light runs along the upper-left edges; the silhouette's outermost pixels take the material's deepest tone. Lighting is
fixed in the world, so the four facings are four honest drawings (`rotation: 'full'`), not mirrors.

The client draws seats straight from their specs (`sprites/art.ts artSprite`), so it has the depth with the pixels.
`scripts/seat-build.ts` writes the same render to `public/art/sprites/<key>.<facing>.png` and the manifest entry, for
the server (`src/server/art.ts`), the furniture review and the Design Lab; the grade proves the files are the render.

## The composition

For a sitter, every figure pixel gets the height at which its ray meets their body: the head, torso and arms on a
vertical cylinder round the pelvis (`BODY_R`), the thighs along the legs the seat gave them, the shins hanging from
the knees; the avatar kit's layer map says which pixel is which. Where the seat's surface is nearer, the seat is
drawn back over them (`overMask`); WorldView does exactly this per sitter (`drawSeatFront`, `sprites/seatLayers.ts`).
There is no cover line, no traced polygon, no whole-part rule and no per-view sitting point. The feet are drawn from
behind too: the seat hides what stands between them and us, and shows them under a stool or between a chair's legs.

## The grade

`node --no-maglev --import tsx scripts/seat-grade.ts [--keys a,b] [--check]` — in `scripts/gate.sh`. Per seat and
facing, every measurement must pass:

- **model** — the build is well-formed; each cushion's sitting point is on its cushion top; the pelvis sits 35–85%
  into the cushion's depth; the knees stand past the front edge; the soles are on the floor or footrest to ¼ px; no
  part intrudes into the torso or thighs (an armrest may run under a forearm); a back's face is at the sitter's back.
- **render** — every solid pixel lies inside the model's projection plus its outline; the projection is solid
  (IoU ≥ 0.97); nothing is drawn below the floor line.
- **composition**, for each of `SEAT_LOOKS` on each cushion — no figure pixel is composed against its depth; the head
  (crown to just under the eyes) shows whole from the front and at least 75% from behind; from the front the torso is
  at least 70% visible and the shoes at least half.
- **files** — the PNG is the render pixel for pixel; the manifest entry is the build's.

Sheets: `art/review/seat-grade/<key>.png` (each facing empty and with each look at 2×, everyone seated at 4×) and
`all.png`; the report `report.json`.

**Live**: `PLAYTEST_URL=http://localhost:5190 PLAYTEST_TAG=grade npx playwright test seat-grade --workers 4`
(`tests/e2e/seat-grade.spec.ts`) sits a bot on every cushion of every seat in its lab room, in every facing and every
review look, and reads the canvas back on the drawing's pixel grid at every zoom the game uses (1–5 CSS px per art px).
At the crisp zooms (2, play scale, and 4) every pixel of the seat and the sitter must equal the composition; at the
half steps (1, 3, 5) the canvas samples the drawing unevenly, so each drawing px is read where the browser lands it and
99.5% must match. Sheets: `art/review/seat-grade-live/<key>-<facing>.png`, with the sit-down and stand-up frames.
`scripts/seat-shots.ts` shoots the same rooms for a quick look.

## Adding or changing a seat

1. Add a spec to `SEAT_SPECS` (or change one). Rooms place seats by key (`sprite` and `variant`), so a new colour of
   a family is a new key: `couch.teal`.
2. `node --no-maglev --import tsx scripts/seat-build.ts` (PNGs, manifest).
3. `node --no-maglev --import tsx scripts/seat-grade.ts --keys couch.teal` and read its sheet.
4. Run the live grade for it, then the gate.

The Design Lab doesn't draw seating: its generator refuses the category and points here.
