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
| **Seats** | the seat standard's `SEAT_FIELDS` | `seat`, `seatDepth`, `backDepth`, `sitStyle`, `backrest` and `arms` are owned by the seat standard (`src/shared/world/seats.ts`). Seating has `walk: 'seat'` and `use` includes `sit`. A colour variant borrows its family's profile. How people sit in it is the seat's **model**: its 3D proxy in `art/seat-models.json`, shared by all four facings, and a z-buffer draws the seat over a sitter only where it's nearer the camera ([seat models](#seat-models-how-people-sit)). A seat without a model falls back to its per-view **rig** (`art/seat-rigs.json`, `src/shared/world/seatRigs.ts`), then to inferring it. |
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
  - seats have a profile
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

## Seat models: how people sit

Every seat kind has one **model**: a few boxes in 3D (its proxy) and a sitting point per cushion, in
`art/seat-models.json`, shared by all four facings. The same cushion is at the same place in the seat whichever way
it's turned, and whatever of the seat is nearer the camera than a person is drawn over them, pixel by pixel.

- **Format** (`src/shared/world/seatModels.ts`). A local frame: `u` across the seat (0 … W tiles), `v` the depth from
  the seat's **front edge** (0) to its back (D tiles), `z` up in world px (1 world px = 2 drawing px of rise).
  `size` is the catalog footprint `[W, D]`. Each part is a box `{"part", "u": [u0, u1], "v": [v0, v1], "z": [z0, z1]}`
  of kind `seat` (a cushion block; its top z1 is what people sit on), `back`, `arm`, `leg`, `base` (frame, skirt),
  `wrap` (a beanbag's rolled back) or `other`. `sits` is one `[u, v, z]` per cushion: the middle of the underside of
  the pelvis, z the cushion top under it. `reviewed` and `drawings` are set only by the lead reviewer.
- **Placing it.** Facing se: x = w − v, y = u; sw: x = w − u, y = d − v; ne: x = u, y = v; nw: x = v, y = d − u
  (tiles from the footprint's back vertex; w × d the footprint as placed). Then the drawing's usual projection:
  (ax + 32 (x − y), ay + 16 (x + y) − 2 z).
- **Depth.** The view ray through a drawing pixel is x − y = (px − ax) / 32, x + y = (py − ay) / 16 + z / 8: on the
  same pixel, the higher point is the nearer. The depth buffer stores the height at which each pixel's ray meets the
  surface. A seat pixel gets the proxy face its ray meets first (outside every box: the face of its nearest covered
  neighbour, extended). A person's pixel gets its body part's surface (`src/client/engine/sprites/seatModel.ts`):
  torso, head and hair a billboard at the pelvis; thighs the plane of their tops at the cushion (and so, seen from
  behind, the seat of the trousers, which the seat then cuts along one clean line); shins a vertical plane
  parallel to the seat's front at the knees, just in front of it (so shins and feet always hang in front of it across
  their whole width, whatever the figure's
  short thighs say); upper arms billboards beside the torso; forearms, hands and what
  they hold rest just above the armrest on their side (else on the lap). Standing or crouching on the seat's tile, a
  person is one billboard in front of the seat. Globally (ordering whole objects) the camera depth is x + y + z / 24
  tiles.
- **Where it runs.** WorldView puts a sitter on the model's sitting point and draws the z-buffer overlay after them
  in every facing, sitting down and getting up included (`modelSit`, `drawModelFront`); the sheets, the checks and
  the live probe compose with the same code.

### Seat models: how to fit one

Every command is `npx tsx scripts/seat-model.ts …`; a KEY argument takes a comma list. Every write goes through the
file's lock one key at a time, so agents working on different seats never clobber each other (never hand-edit
`art/seat-models.json` while others are at work).

1. **Seed**: `--fit KEY` fits the family's boxes (chair, armchair, couch, stool, bench, beanbag, ottoman, throne) to
   every facing's silhouette, the cushion at the seat profile's `seat` height. `--force` refits from scratch;
   `--refine` fits the current boxes further and keeps the sitting points.
2. **Read it**: `--show KEY` prints the numbered parts, the sitting points and, per facing, the IoU, the tops of backs
   and arms and every problem. `--sheet KEY --views` draws `art/review/models/KEY.png` (and one per facing in
   `art/review/models/views/`): the drawing at 6× with the boxes (seat green, back magenta, arm orange, leg cyan, base
   blue, wrap purple, other yellow; dashed edges are hidden; the number is the part's index) and the sitting points
   S0, S1; the silhouette (red: drawing the proxy misses, blue: proxy over nothing); the depth map (blue far, red
   near; hatched: outside every box); the result at play scale and 4× for the three looks with every cushion taken
   (red: pixels a check flags); and sit-down → seated → stand-up.
3. **Tune**: `--part KEY:3 '{"z": [0, 21.5]}'` changes part 3; `--part KEY:+ '{"part": "arm", "u": […], "v": […],
   "z": […]}'` adds one; `--part KEY:3 null` deletes it; `--sit KEY:0 '[0.5, 0.36, 12.5]'` moves a sitting point;
   `--sit KEY auto` sits each by the standard (below); `--set KEY '{"parts": […], "sits": […], "note": "…"}'`
   replaces fields. Any edit clears `reviewed`.
4. **Check**: `--check KEY` until the only problem left is "(g) not reviewed".
5. **Prove it in the game**: against the no-HMR review server (`npx vite --config vite.review.config.ts`, port 5190),
   `PLAYTEST_URL=http://localhost:5190 PLAYTEST_TAG=models-<you> SEAT_MODEL_KEYS=KEY npx playwright test seat-models
   --workers 1`. A bot walks up to the seat in its lab room (`seatlab-KEY`: the seat in all four facings, development
   only, `src/shared/world/seatLab.ts`), sits down by clicking it in each look, shifts to the other cushion of a
   two-seater, and stands up. `art/review/models-live/KEY-FACING.png` holds each look at play scale and 4× and the
   live sit-down film. Then `--probe KEY` compares every capture with the same composition off the sheet: it must say
   `same` for each.
6. **Judge it like an artist**, on the live shots: the person sits IN the seat, centred on the cushion; backs and near
   arms hide what's behind them and nothing more; forearms rest on armrests and show; from the front the legs come
   forward off the front edge; from behind the head and shoulders show above a back lower than the shoulders. Then
   hand it to the lead reviewer, who reads the sheet and the live shots and runs `--review KEY`.

**The checks** (`--check`, and the gate):

| | fails when | usually means |
| --- | --- | --- |
| (a) | the proxy's silhouette misses a drawing's (IoU < 0.85 against its silhouette with enclosed gaps filled), or a back's or arm's top edge is off the drawing's (fewer than 80% of its columns within 2 px, its two end columns aside) | a box too big, small or misplaced; a round seat needs two crossing boxes, an arched back two stacked ones |
| (b) | a sitting point isn't on its cushion's top (within 0.5 px); with a back, the pelvis isn't 0–0.12 tile in front of the back's front face (people sit with their bottom back against the backrest: the standard puts it SIT_GAP = 0.1 in front); backless, it's more than 0.1 tile off the seat's middle | `--sit KEY auto`; or the back's front face (v0) is off the drawing |
| (c) | a seat pixel is drawn over a person where the seat's surface is behind them (the z-buffer, recast from scratch) | a bug in the compositor: report it, don't tune around it |
| (d) | a seat with arms hides more than 10% of a forearm resting on an armrest | an arm box taller than the drawn arm |
| (e) | seen from behind, with the back lower than the sitter's shoulders, less than 90% of their head and shoulders shows | the sitting point too far back, or the back too tall |
| (f) | any pixel of a seated person ends up see-through | a bug in the compositor |
| (g) | a seat kind anywhere has no model, isn't reviewed, or was redrawn since | fit it; hand it for review |
| (h) | a part other than the cushion under a sitter stands inside their body: the torso (0.34 × 0.2 tile, from the cushion to the shoulders) or the thighs (0.24 tile wide, forward to the knees, a thigh thick), by more than 0.02 tile across and in depth and 0.5 px in height (an armrest by more than 0.06 tile across: its top may run under a forearm) | a box through the lap or the pelvis: lower it under the cushion, move it behind the torso, or split it |
| front | from the front, less than 95% of the head and shoulders shows, less than 60% of the legs, or ANY shin or foot pixel is covered by the seat (the knees are put just in front of every part but the back, so this is the compositor's guard) | arms too tall; a part reaching in front of the shins |

**How people sit (the standard).** Bottom back against the backrest: the pelvis `SIT_GAP` (0.1 tile, a torso's
half-depth) in front of the back's front face, or the middle of a backless seat (`seatModels.ts standardSitV`; `--sit
KEY auto`). Knees just in front of the seat's front (`kneeFace`), so shins and feet hang in front of it; the thighs
lie on the cushion between. On a low seat (upright or lounging, feet at most 4 world px off the floor) the figure's
shins are stretched so the feet reach the floor (`feetDrop`, `stretchFigure`, drawn the same in the game).

**Things to know.** The figure is small for its furniture (a torso is 0.42 tiles across, the legs are short), so the
knees are put at the seat's front edge. Anything above the cushion where the sitter's body is (a box too deep, a back
whose front face is in front of their torso) is drawn over them. Keep a model mirror-symmetric about u = W/2 (the
catalog's seats are `mirror` or `radial`); its size must equal the catalog footprint; a seat without a facing of its
own is drawn the way it's sat in. The pieces: `src/shared/world/seatModels.ts` (format, frames, rays),
`src/client/engine/sprites/seatModel.ts` (depth maps, the compositor, the checks),
`src/client/engine/sprites/seatModelFit.ts` (the fitter), `scripts/seat-model.ts`, `scripts/lib/models.ts` (the file
and its lock), `tests/e2e/seat-models.spec.ts`, `src/shared/world/seatLab.ts`, and WorldView (`modelSit`,
`drawModelFront`).

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
