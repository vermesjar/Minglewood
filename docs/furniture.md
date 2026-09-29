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
| **Seats** | the seat standard's `SEAT_FIELDS` | `seat`, `seatDepth`, `backDepth`, `sitStyle` and `backrest` are owned by the seat standard (`src/shared/world/seats.ts`) and fitted by `scripts/seat-fit.ts`. Seating has `walk: 'seat'` and `use` includes `sit`. A colour variant borrows its family's profile. |
| **Use** | `use?: { face, actions }` | `actions` lists the kinds of action it offers (`ObjectAction['kind']`). With `face: 'front'` it's used from the tiles in front of its working face, which is the way it faces. With `face: 'any'` it's used from any side (a bell, a pool table). |
| **Light and life** | `light`, `glow`, `emitters`, `animated`, `still` | These are points in each drawing's own px. A model with more than one real drawing puts them on every drawing (`facings.nw.light`, …); the entry's own apply only to its first drawing. Mirrored sides reflect them. Animations are keyed by drawing file (`src/client/engine/animations.ts`). An `animated` model animates in every drawing except the ones listed in `still` (the back of an arcade cabinet). |
| **Wall** | `wall: { v, margin?, walls?, text? }` | Wall art has `rotation: 'flat'`, `category: 'wall-art'` and `layer: 'wall'`. It hangs on either wall (or only on `walls`) and is never mirrored: the left wall draws it reversed, so text and logos read the right way round. |

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
  - seats have a profile
- `npm run furniture:review` shows every model in all four facings, with the footprint and the fill rule
  (`art/review/furniture/<key>.png`).
- `uv run art/check_facings.py`: seat back views face the right way.
- `src/shared/world/rotations.test.ts`: every interactive piece works in all four facings. It is approached from its
  working face, the tile is reachable, and every cushion of a seat seats someone. User-placed pieces get the same
  interactions as the room's own (`withUseActions`).

## Rooms

Decorate mode rotates a piece before and after placing it, with the **R** key or the ↻ button. The ghost shows
the rotation. The server stores the facing and validates it with the same rules as placement: doors and seats stay
reachable, and so does the piece's working face.
