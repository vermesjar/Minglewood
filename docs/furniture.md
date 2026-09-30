# Models: the spec every piece is built to

Users will get room-building tools, so **every piece of furniture turns four ways (se, sw, ne, nw) and works from
every one of them**, and every model declares what it is, how it stands and how it's used. A model is one entry of
`public/art/manifest.json`. Its type and validator are in **`src/shared/models.ts`** (`ModelSpec`,
`validateModel`); this page describes the same rules in prose. Nothing is published unless it passes
**`npx tsx scripts/model-check.ts`**, and the gate runs that check on the whole catalog.

## What a model declares

| | fields | rule |
| --- | --- | --- |
| **Identity** | `name`, `category`, `tags`, `rooms`, `themes?` | `category` is one of: seating, table, counter, storage, appliance, lighting, play, plant, decor, rug, wall-art, street, nature, landmark, building. `rooms` lists at least one room kind (lobby, office, cafe, lab, hall, lounge, arcade, studio, outdoors). `themes` (warm, bright, dim, neon, festive) narrows the fit; leave it out and the model suits any theme. |
| **Size** | `footprint`, `height` | `footprint` is `[width, depth]` in tiles: width across the front, depth front to back. Facing sw or ne the model covers w = width and d = depth; facing se or nw they swap (`footprintFacing`). `height` runs from the floor to the top, in art px. Height class: flat < 4, low < 20, mid < 40, tall < 72 (hides people behind it), towering above that. |
| **Drawings** | `rotation`, `file`/`anchor` or `facings`, `sameFromBehind?` | See [rotation](#how-a-model-turns-rotation). |
| **Footing** | `base` | See [the fill rule](#how-it-stands-base-and-the-fill-rule). |
| **Walking** | `walk` | `blocked`, `seat` (blocked, but the path ends on it to sit) or `open` (rugs, and wall art, which isn't on the floor). |
| **Layer** | `layer` | `floor` is drawn beneath everything (rugs, blankets). `object` stands on the floor and is depth-sorted by its footprint. `surface` stands on another model's `surface`, is placed with that z and is drawn after its host (an espresso machine on a counter); it never goes on the bare floor. `wall` is painted into the wall. |
| **Surfaces** | `surface?` | Things can stand on it at this z, in art px (a counter top is 20.5, `COUNTER_TOP`). |
| **Seats** | the seat standard's `SEAT_FIELDS` | `seat` (the cushion's height), `sitStyle`, `backrest` and `arms` (`src/shared/world/seats.ts`), written by `scripts/seat-build.ts` from the seat's spec. Seating has `walk: 'seat'` and `use` includes `sit`. How people sit in it is its spec's build ([seats](#seats-how-people-sit), docs/seating.md). |
| **Use** | `use?: { face, actions }` | `actions` lists the kinds of action it offers (`ObjectAction['kind']`). With `face: 'front'` it's used from the tiles in front of its working face, which is the way it faces. With `face: 'any'` it's used from any side (a bell, a pool table). |
| **Light and life** | `light`, `glow`, `emitters`, `animated`, `still` | These are points in each drawing's own px. A model with more than one real drawing puts them on every drawing (`facings.nw.light`, …); the entry's own apply only to its first drawing. Mirrored sides reflect them. Animations are keyed by drawing file (`src/client/engine/animations.ts`). An `animated` model animates in every drawing except the ones listed in `still` (the back of an arcade cabinet). |
| **Wall** | `wall: { v, walls?, text?, floor? }` | Wall art has `rotation: 'flat'`, `category: 'wall-art'` and `layer: 'wall'`, `footprint: [span, 1]`. It hangs on either wall (or only on `walls`) and is never mirrored: the left wall draws it reversed, so text and logos read the right way round. Its size is its drawing's (the wall art standard, below): `v` is [bottom, bottom + height/2]. `floor`: it stands on the floor like a door (the lift). `margin` is retired. |

## How a model turns: `rotation`

| rotation | drawings | when |
| --- | --- | --- |
| `radial` | one | Round or amorphous: truthful from every side (a round stool, a round table, a plant, a tree). Its silhouette has to be roughly symmetric; nature is exempt. |
| `mirror` | a front (`se` or `sw`) and a back (`nw` or `ne`) | Left-right symmetric about the way it faces. The other two sides are mirror images (most chairs, couches, tables, shelves, desks). Loose clutter may swap sides. A model that honestly looks the same from behind declares `sameFromBehind` and may use one image for both. |
| `full` | `se`, `sw`, `ne`, `nw` | Handed: a detail sits on one side of the piece itself (a grand piano, a cart with its wheel at one end, sign arrows, a portafilter, a vending machine's panel, a register's crank). |
| `flat` | one | Wall art. |
| `fixed` | one | Buildings and map landmarks that never turn. |

**Which is honest?** Picture the piece turned a quarter-turn. If the mirror image of a drawing shows exactly what
you'd see, `mirror` is enough. If a handed detail would end up on the wrong side, the model is `full`.

## The wall art standard

Wall art is drawn at exactly **2:1** against the wall: one drawing px is half a wall unit each way, so 32 drawing px
per tile along the wall and 2 per wall unit up it. That is the wall texture's own density (interior.ts), so a
drawing is painted onto the wall pixel for pixel and never resampled. (Squeezing a drawing onto the wall with
nearest-neighbour sampling drops whole pixel columns: the café's menu board lost its right frame that way.)

- Its **size comes from its drawing**, never from hand-tuned numbers: w/32 tiles wide, h/2 units tall. `wall.v` is
  where it hangs, bottom to top, and the top is always the bottom + h/2.
- It is **centred in its span** (a whole number of drawing px from each end).
- What shows of it (its opaque pixels) stays **clear of the baseboard** (4.5) and **the crown moulding** (58).
- A drawing **wider than its span** is a model-spec error: grow the span (`footprint[0]`). Never squeeze it.

`models.ts` `wallFit` is the rule. `scripts/model-check.ts` (the gate runs `--category wall-art`) fails a model
that breaks it, `scripts/room-map.ts` fails a room that hangs a piece in too narrow a span, and the Design Lab
stages wall pieces to it (art/designlab.py `wall_standard`: the span grows to hold the drawing).

## How it stands: `base` and the fill rule

- **Small models** (well narrower than their footprint: a lamp, an espresso machine, an ornament) are `centred`.
  At runtime their base is centred on the footprint, whatever the anchor says (`art.ts`, `footing.ts`).
- **Large models** stand by their anchor and must meet **the fill rule** (`footing.ts` `fillProblems`) in every
  facing, mirrors included:
  - `filled`: it covers its footprint (a couch, a desk, a bench, a cart on its wheels, a ring of stones). Its
    drawing fills the footprint diamond or is inset evenly. Its sides reach alike toward the side corners (within
    6 px of each other), overhang them by at most 6 px (arms, curls), and its lowest pixel is where a base that
    wide, centred on the footprint, would end (within 4 px). A piece drawn to fill ends on the front corner. A bench
    drawn 16 px too high puts its seats on the pavement in front of it, and this rule fails it.
  - `centred`: it stands on one base narrower than its footprint (a pot, a post, a pedestal, a trunk). The
    bottom of that base is centred on the footprint's centre, within 6 px.
  - `fillAnchor` works out the anchor that satisfies the rule. `npx tsx scripts/model-backfill.ts --fix-fill`
    applies it across the catalog.

## Drawing and publishing: the pipeline

`art/studio.py` draws every view of a piece together and refuses to publish anything that fails the model check.

- **All views in one sheet.** Give an item `"views": "mirror"` or `"views": "full"` and no `facing`. It expands
  into front + back, or all four sides, in a single sheet. `"prompts": {"se": "…"}` places handed details view by
  view. To add views to an existing piece, put its drawing in the sheet's `refs`.
- **The declaration.** studio fills in what it can know: name, tags, height (measured), base, walk, layer, and a
  seat's `use`. What it can't know goes in a `"model"` block on the spec, the sheet or the item; later blocks
  override earlier ones. At least `{"category": …, "rooms": […]}`. `publish` takes `--model '<json>'`.
- **Checked before anything is written.** Images are staged. The model check runs on the staged entries and
  images, and only then is anything saved. `--partial` lets a turnaround split over several builds publish one side
  at a time; the gate still fails the piece until it's complete.
- **Orientation.** A mirrored back of a seat is flipped automatically (`orient_backs`). The check fails any square
  model whose drawings lean the wrong way for their facings: se and ne lean alike, sw and nw the opposite way.
- **JSON commands for tools** (the Design Lab). Each prints one JSON object on the last line of stdout and exits 0
  (ok), 1 (refused) or 2 (bad input):
  - `studio.py lab-generate --spec model.json [--ref img.png …] --out DIR [--view se] [--quality q]` draws every
    view a model spec needs and returns `{ok, key, usd, views, entry, sprites, problems}`.
  - `studio.py check [KEY …] [--entries e.json --sprites DIR]` runs the model check on the catalog or on staged
    entries.
  - `studio.py lab-publish --entries e.json --sprites DIR [--overwrite]` publishes staged entries under the
    manifest lock, if they pass.
- Every manifest write goes through studio's `ManifestLock` (Node scripts use the same lock:
  `scripts/lib/manifest.ts`).

## Checks

- `npx tsx scripts/model-check.ts [key …]` (in `scripts/gate.sh`) checks:
  - the declaration
  - every drawing and glow mask exists
  - the rotation is honest: radial models are round, a back isn't a copy of its front, a full model's sides aren't
    copies or mirror copies
  - drawings face the way they say
  - the fill rule in all four facings
  - height matches the drawing
  - animation hooks are declared
  - seats have a profile (and `scripts/seat-grade.ts --check`, in the gate: every catalog seat passes the seat grade)
- `npm run furniture:review` shows every model in all four facings, with the footprint and the fill rule
  (`art/review/furniture/<key>.png`).
- `uv run art/check_facings.py`: seat back views face the right way.
- `src/shared/world/rotations.test.ts`: every interactive piece works in all four facings. It is approached from its
  working face, the tile is reachable, and every cushion of a seat seats someone. User-placed pieces get the same
  interactions as the room's own (`withUseActions`).

## Rooms

Decorate mode has two categories. **Furniture** stands on the floor. **Wall** holds every model of category
`wall-art` in the catalog (a piece published from the Design Lab joins it at once) and windows. A wall piece is a
`Decoration` with `wall: 'left' | 'right'` and its span's first tile along that wall in `x` (right wall) or `y`
(left wall), like an authored wall object. Floor saves without `wall` load as before. Hover a wall to see the ghost
(green: it fits; red: it doesn't), click to hang it; the ✋ tool moves a team piece, 🧹 removes it. A wall piece
never overlaps another, the door or a memory-wall slot, and is never hidden behind anything standing (the same
occlusion rule room-map checks the rooms with: src/shared/world/wallPieces.ts). A floor piece is never placed where
it would hide one. Client and server run the same checks on the same drawings (the client's loaded art, the
server's from disk: src/shared/art/source.ts). A placed window gets the live view and sun patches like an authored one.

Decorate mode rotates a piece before and after placing it, with the **R** key or the ↻ button. The ghost shows
the rotation. The server stores the facing and validates it with the same rules as placement: doors and seats stay
reachable, and so does the piece's working face.

## Seats: how people sit

Seating is its own framework: **[docs/seating.md](seating.md)**. A seat is a spec on one of nine kinds
(`src/shared/world/seatSpec.ts`, `src/shared/art/seatCatalog.ts`), built into a 3D model sized from the figure, drawn
from that model in all four facings by the seat renderer, and composed with its sitters pixel by pixel against the
render's own depth. `scripts/seat-build.ts` writes the PNGs and manifest entries; `scripts/seat-grade.ts --check`
(the gate) and `tests/e2e/seat-grade.spec.ts` (live) grade every seat in every facing at every zoom. The Design Lab
doesn't draw seating.

Depth against people for every other piece (a person passing a table, a jar on a counter) is still whole-object
ordering (`engine/depth.ts`); the seat compositor is the model for extending it: give a piece a model, render from it,
and settle people against it per pixel.
