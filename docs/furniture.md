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
| **Seats** | the seat standard's `SEAT_FIELDS` | `seat` (the cushion's height, which seeds the fit), `sitStyle`, `backrest` and `arms` (`src/shared/world/seats.ts`). Seating has `walk: 'seat'` and `use` includes `sit`. A colour variant borrows its family's profile. How people sit in it is its entry in `art/seat-models.json`: a 3D model shared by all four facings, with per-drawing overrides where needed ([seats](#seats-how-people-sit)). |
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
  - seats have a profile (and `scripts/seat-layers.ts --check`, in the gate: every seat kind has a model that holds)
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

Every seat kind has one entry in **`art/seat-models.json`** (format and helpers: `src/shared/world/seatModels.ts`),
and people are drawn into it by one path, **`src/client/engine/sprites/seatLayers.ts`**, the same in the game, the
review tools and the Design Lab. It's Habbo's way: the seat's drawing in two layers, one behind its sitters and one
over them.

**The model.** A few boxes in 3D (`parts`: seat, back, arm, leg, base, wrap, other) in a local frame shared by all
four facings: `u` across the seat (0 … W tiles), `v` the depth from its front edge (0) to its back (D tiles), `z` up in
world px. `sits` has one sitting point per cushion, `[u, v, z]`: the middle of the underside of the pelvis on the
cushion top, as the seat is seen from the front. `size` is the catalog footprint `[W, D]`. Placed facing se:
x = w − v, y = u; sw: x = w − u, y = d − v; ne: x = u, y = v; nw: x = v, y = d − u; then the drawing's projection
(ax + 32 (x − y), ay + 16 (x + y) − 2 z).

**What goes over a sitter** (`overParts`). Every pixel of a drawing is labelled with the part its view ray meets first
(`seatModel.ts seatDepth`), and whole parts go over the people sitting in it: the arm on the camera's side, and seen
from behind the back, a wrap or a crest. The split follows the drawing's own pixels. Over a sitter the layer stops at
their shoulders, so their head always shows.

**Where a sitter sits** (`viewSits`). The figure is small for its furniture, so no one depth serves every view. From the
front a sitter sits forward so their knees reach the front edge (`standardSitV`); from behind, deep under the backrest
so it hides their hips (`backSitV`). Each view is composed on its own, as sprite games do.

**The legs** (`src/shared/world/sitLegs.ts`). The thighs run from the hip toward the camera, foreshortened at the
floor's 2:1, to just past the front of whatever the shins would hang through; the shins drop to the floor when they
can reach it (`SHIN_MAX`), else hang. Seen from behind on a single seat only the seat of the trousers shows; on a long
seat (a couch, a bench) the whole thighs lie out along the cushion, a shoe just past each knee. The avatar kit draws
the figure with these legs (`frameFor(…, legs)`), so every sitter's legs fit the seat they're in.

**Per-drawing overrides.** Generated drawings aren't exact 3D, and a drawing sometimes needs its sitters or its over
layer somewhere the boxes don't say. A model may carry, per facing, `views` (a sitting point per cushion, `[u, v]`) and
`over` (polygons in that facing's drawing px, traced along the drawing's edges). The catalog's came from its audited
per-view rigs; tune them by eye, never by rule. A player's "forward" and "back" are the seat's own (back is toward the
backrest), whichever way it faces on screen; when a direction is ambiguous, show labelled candidates and let them pick.

**Getting in and out.** Sitting down, a person turns, crouches and settles into the seat; getting up, they rise just
past the seat's edge on the side they'll step off by (never inside it) and step away.

### Making and checking a seat

- **Fit**: `node --no-maglev --import tsx scripts/seat-model.ts --fit KEY --force` fits the family's boxes to every
  facing's silhouette, the cushion at the manifest's `seat` height, and places the sitting points. `--show KEY` prints
  the parts, sitting points, per-view overrides and problems; `--part`, `--sit` and `--set` edit it (under the file's
  lock); `--sheet KEY --views` draws `art/review/models/KEY.png` (boxes, silhouette fit, depth, and every look seated
  at play scale and 4×).
- **Check** (the gate): `scripts/seat-layers.ts --check` runs `seatProblems` on every seat kind in every facing: the
  model's silhouette fits the drawing (IoU ≥ 0.8), every cushion has a sitting point, on its cushion from the front,
  the legs stay above the floor and come off the cushion's front, and from behind a seat with a back hides something.
  `scripts/seat-layers.ts` without `--check` draws each view with its over layer tinted and each cushion's hip, knees
  and feet marked (`art/review/seat-layers/`).
- **Look at it the way it's played**: `scripts/seat-shots.ts` sits someone on every cushion of every seat kind in all
  four facings through the real WorldView (`art/review/seat-shots/`); `lab.roomShot` (via `scripts/lab-call.ts`) fills
  a real room's seats and crops each. Review at play scale and 4×, the back views as closely as the front ones. A
  green check isn't proof it looks right.
- **New seats** come through the Design Lab (`docs/design-lab.md`): auto-fit, the same check, the sandbox, review,
  publish.

## Depth by proxy: people around every piece (proposal and prototype)

**Today.** WorldView sorts the pieces of a room once, topologically, by their footprint boxes (`depth.ts`): of two
pieces that overlap on screen, the one whose box lies wholly behind the other's is drawn first. Each person is then
slotted after the last overlapping piece whose box is behind the tile they stand on, and drawn whole; a seat's
sitter is drawn after it with its model's overlay. Two things that overlap on screen can therefore only be
*wholly* in front of or behind each other, which is wrong wherever a person and a piece interleave in depth. Seen in
the café (`art/review/proxy-depth/`): the pastry jar on the bar drawn over the head of someone standing in front of
the bar; someone behind the bar drawn over the pastry dome on it; the old "walking up to chairs puts you behind the
furniture"; a person passing close beside a tall piece or between a table's legs.

**Proposed.** Give every standing piece a 3D proxy and settle person against piece per pixel, with the same depth
the seats use (on a pixel, the height at which its view ray meets a surface; higher is nearer):

1. **A proxy per piece.** A seat's is its model. Everything else starts as a box on its footprint, from its base
   (the floor, or the surface it stands on) up to its model's `height` (read off the drawing for a piece without one:
   the top of a box is drawn 2 px per world px above its back vertex). Pieces a box describes badly get fitted
   boxes with the same fitter, silhouette check and sheets as the seats, with families of their own: a table's top
   slab on legs (feet show under it), a desk with knee space, a counter with its overhang, a lamp's pole and shade.
2. **Pieces among themselves** keep the topological sort: they don't move, and it orders them right.
3. **A person** is drawn after every piece they overlap on screen; then each of those pieces draws back over them its
   pixels whose surface is nearer the camera than theirs (`overlayFor` with a free body: one billboard where they
   are, at their feet or, sitting, at their pelvis). People among themselves stay ordered by x + y. The seat a
   person is in keeps its own, fuller body model (thighs, shins, forearms on armrests).
4. **Cost.** Each piece's depth map is worked out once. Overlays are cached per piece, look, pose and placement: a
   seated or standing person costs a lookup, while a walking one recomputes each step for the few pieces they
   overlap (about 10k cheap pixel tests each). Measured headless (`tests/e2e/_proxy-depth.spec.ts`), a whole frame:
   café 37.6 ms sorted, 40.4 ms by proxy (6 people, 31 pieces); HQ 16.0 ms against 15.8 ms (noise). Cheaper still:
   skip a piece whose proxy lies wholly behind the person (a box test), and in town consider only pieces near people.
5. **Moving over.** (a) Every catalog piece gets a proxy (the box for now; fitted families where the box reads
   wrong, reviewed like the seats); (b) review every room both ways at play scale and 4× with the flag on; (c) turn
   it on by default, keeping the old slotting only for pieces without art. Watch for: overhangs and pieces drawn
   wider than their footprint (the fill rule keeps them few); swaying plants (the overlay takes the sway offset);
   the night glow layer (an overlay doesn't cut the glow the person already cut); wall art and rugs, which have no
   proxy and never need one.

**The prototype** is in WorldView behind a flag, off by default: `?depth=proxy` in the URL, or
`__mw.world.proxyDepth = true` from the console. `boxProxyOf` makes the box proxies (classic 1× sprites are doubled
onto the 2× grid), `buildDrawOrder` slots a person after every piece they overlap, and `drawProxyFront` draws the
overlays. A piece it can't give a proxy is drawn again over a person it stands in front of, as today.
`FILM=1 PLAYTEST_URL=http://localhost:5190 npx playwright test _proxy-depth` (with `PROXY_ROOM=hq` and so on) shoots
a walk round a room's furniture both ways into `art/review/proxy-depth/` and prints the frame cost.
