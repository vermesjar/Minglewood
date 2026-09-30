# The Design Lab

A private page for making game art yourself: describe a piece of furniture or a character part, add reference
images, draw it with the same pipeline the catalog is built with, check it against the standards, try it in a real
room, and publish it. It only exists on your machine.

## Opening it

1. `npm run dev` (it starts the API on :8787 and Vite on :5173).
2. The image key has to be in the **server's** environment: `OPENAI_API_KEY` in `.env` or your shell. The Python
   tools read it. It never reaches the browser.
3. Open **http://localhost:5173/studio.html**.

You won't find it in the app, and it isn't in the production build: `studio.html` isn't a Vite build input. Its API
(`/api/dev/lab/*`) is mounted only when `NODE_ENV !== 'production'`, and it refuses any request that isn't from
this machine on a loopback name. That rules out the LAN, tunnels (cloudflared), anything forwarded, and DNS
rebinding. Every write also needs the lab's own header, which a cross-site form can't send.

## Furniture

**Drafts → New furniture.** Give it a **name**, a catalog key (lowercase words joined by `-`, with a variant
after a dot: `chair-bistro.sage`), a category, how it turns and a footprint. The name is the label in the decorate
palette: a few words ("Steampunk espresso machine"), at most 40 characters. Left blank, it comes from the key, and
you can change it any time in the editor. It never comes from the description. The description goes in the box
under the key and becomes the prompt. The form covers **the model spec**
(`src/shared/models.ts`, in prose in `docs/furniture.md`). Every field on it is one the model check (`scripts/model-check.ts`)
requires:

| on the form | the model spec |
|---|---|
| name, category, rooms, tags, moods | `name`, `category`, `rooms`, `tags`, `themes` |
| footprint width × depth, height | `footprint` [width, depth] as seen facing sw, `height` (art px). The height is measured again from the drawing |
| how it turns | `rotation`: **radial** (one drawing), **mirror** (a front and a back drawn: se + nw, or sw + ne for a long piece, lying along its width like the catalog's long pieces; the other two are their mirrors), **full** (four drawings: anything handed), **flat** (wall art). "Looks the same from behind" is `sameFromBehind` |
| stands on | `layer`: the floor (`object`), a counter (`surface`, placed at the counter's z), flat (`floor`, a rug) |
| seat height, sat in as, backrest, arms | the seat standard's profile (`seat`, `sitStyle`, `backrest`, `arms`). Only seating has one. It's what the seat's model is fitted from; how people sit in it is the model (**How people sit in it**, below) |
| surface height, lights up, action, used from | `surface`, a light point per drawing, `use: {face, actions}` |

**Describe it** in the prompt (what it is, materials, colours, era; the house style block is added for you). Drop
up to six **reference images** for look. The construction guide still sets size and angle. For a *full* piece, the
per-view notes say where handed details go ("the bell on the left end").

**✦ Draw it** shows what you're about to spend first: the likely cost (the mean of real past calls of the same
kind, quality and size), today's spend and what's left of `art/budget.json`. Every generation asks. All the views
it needs are drawn together on one sheet so they're the same piece.

**Every side** shows all four facings on a checkerboard with the footprint (cyan), and its centre (square), exactly
as the game places them. Mirrored sides are labelled, and small pieces are marked *auto-centred* (the game centres
them on their footprint whatever the anchor says). For each drawn view you can:

- **nudge** the anchor a pixel at a time (for pieces that fill their footprint),
- **accept** it (every view must be accepted to publish),
- **Redraw…** with an optional note ("make the backrest taller"). The accepted views go along as references so it
  stays the same piece.

**Checks** runs the same model check the gate runs: every drawing its rotation needs, each facing the right way,
standing on its footprint (the fill rule), and a complete declaration. It also runs the furniture review's per-view
placement, stray pixels and sliced-top tests. A red dot on a view says which one.

**How people sit in it** (seating only) is the seat's **model** (the seat model standard,
`src/shared/world/seatModels.ts`; `art/seat-models.json`): a few 3D boxes (seat, back, arm, leg, base, a wrap, anything
else) and one sitting point per cushion, one model for all four facings. The game draws everyone in a seat from it,
one way (`src/client/engine/sprites/seatLayers.ts`): which of the seat's parts are drawn over the people in it (the
arm on the camera's side; seen from behind, the back), where each sitter's hips go, and how their legs lie on the
cushion. What goes over them stops at their shoulders, so a head always shows. A seat can't be published without a
model that holds and has been passed.

**What you get without touching anything** (the standard every catalog seat was tuned to, 2026-09-30; a new seat
starts there, so a generated seat looks right out of Auto-fit):

- **Where they sit.** From the front: back against the backrest, knees at the cushion's front edge
  (`standardSitV`). From behind, by the **kind of seat** the model reads off itself (`seatKind`, no per-seat
  numbers): a *long* seat (a cushion 1.2 tiles or more across: couches, benches) sits them forward at the middle of
  the cushion; a *padded* one (a back 0.25 tile thick or more: tub chairs, wingbacks, thrones) sinks the pelvis
  into the padding, at the middle of the back's box, so the torso rises out of it; an *open* one (any other back:
  dining, office, banquet chairs, beanbags) sits them on the cushion just in front of the back's face, the rail
  across the lower back; a *backless* one (stools, ottomans) a little behind the cushion's middle (`backSitV`).
  Across: a single seat's sitter in its middle; on a couch or bench the sitters 0.8 tile apart about its middle and
  clear of its arms, never against them (`placeSits`).
- **What draws over them.** Whole parts, by where they stand: the near arm from the front; from behind the back,
  both arms, the seat's flanks toward the camera and any cushion top lying under an arm or the back (chair, not
  cushion) — never the cushion they sit on, and a back only above the cushion's top (a thick box standing in for
  a thin rail must not claim the back of a cane seat). Over them it stops at the shoulders so the head shows,
  unless the back rises past the head anyway (a throne).
- **How their legs lie** (`src/shared/world/sitLegs.ts`, drawn by the avatar kit). From the front: the thighs toward
  the camera to just past the seat's front, the shins down to the floor (or hanging, on a tall seat). From behind:
  the thighs out along the cushion in every seat, so a sitter visibly faces the way the seat does, and nothing below
  the knees (feet shown from behind read as pointing down at the floor); on a chair as tall as a café chair, or
  behind a back that rises past the sitter's head (a throne), the legs are tucked out of sight.
- **Which way it faces.** Every facing's preview says which way its sitters face on screen (↘ ↙ ↗ ↖): the seat must
  face the same way. The generator flips a one-tile seat's front or back drawn facing its mirror's way
  (`studio.py orient_fronts`, `orient_backs`), and the gate checks every seat drawing's backrest against its facing
  (`art/check_facings.py`); a near-symmetric drawing (a tub chair) can only be caught by eye, on the arrows.
- **Where it can stand.** Placed in a room (the layouts, or decorate mode), a seat has a tile of floor in front of
  it: a coffee table goes a tile from a couch; only a chair or a stool is pulled right up to a desk, a table or a
  counter (the seat spacing rule, `src/shared/world/seats.ts`, checked by `scripts/room-map.ts`).

The flow:

1. **Auto-fit.** Set the seat height, "sat in as", backrest and arms in the spec first: the fitter starts from them
   (`src/client/engine/sprites/seatModelFit.ts`, the same fitter as `scripts/seat-model.ts --fit`). It takes the
   family's boxes (chair, armchair, couch, stool, bench, beanbag, ottoman or throne, by the key), puts the cushion at
   the seat height, fits every box until the model's silhouette matches every facing's drawing, and sits each cushion
   by the standard above. **Auto-fit again** starts over: it drops any per-view nudges. Set the seat height to the
   drawn cushion's top: set low, the backrest reaches the sitters' shoulders and they look sunk into the seat (the blue
   couch was 8.7 and sat right at 11).
2. **Check.** Every facing runs the gate's own check (`seatProblems`, what `scripts/seat-layers.ts --check` runs on
   the catalog), on the draft's drawings exactly as the game draws them (mirrored, and a small piece centred on its
   footprint): the model fits the drawing (IoU at least 0.8), every cushion has a sitting point on its cushion, the
   legs stay above the floor and come off the cushion's front, and from behind a seat with a back hides something of
   its sitters. Each facing previews as the game draws it (`composeSeat`): three looks (short hair and a tee; long
   hair; a puffer coat and a cowboy hat), someone on every cushion, at play scale and 4×, its checks under it, and the
   way its sitters face (the seat must face the same way). Read the back views as carefully as the front ones: that's
   where sitters sink into a backrest or lose their legs. To fix
   one, pick it (**edit this view**, or the facing buttons over the editor). The editor shows the drawing with what
   goes over the sitters **tinted red**, the model's boxes (colour by part, hidden edges dashed), each cushion's
   sitting point (a cross), the knees (yellow) and the feet (blue):
   - drag a box's square to move it across the seat, shift-drag to raise or lower its top, or use its sliders
     ("keep it mirror-symmetric" moves its twin with it). **+ box**, **delete** and the part menu add, remove and
     retype boxes;
   - a sitting point's sliders move it in every view; **Sit them back against the backrest** puts them all where the
     standard does (keeping them where they are across); **onto the cushion top** drops one onto its cushion.
3. **Per-view nudges.** Generated drawings aren't exact 3D, so a view sometimes needs its sitters a little elsewhere.
   Dragging a sitting point on the editor nudges it **in that view only** (the model's `views`: that facing's own
   [u, v] per cushion; its crosses turn orange). **Clear this view's nudge** puts that view back on the model's
   points. A view whose over layer was traced by eye (the model's `over`, made with the catalog tools) says so, and
   **Use the parts for what goes over them** drops the tracing.
4. **Sandbox.** **Try it in game** (below) draws the draft with this model through the game's own renderer: sit down,
   sit and stand up on every cushion, in every facing, with the room full. It rebuilds each time the draft saves.
5. **Review.** Once every facing holds, the reviewer reads every facing at play scale and 4× and in the sandbox, and
   presses **Pass it (reviewer)**. Any change to the model takes the pass away, and so does any new drawing, redraw or
   anchor nudge: the model is checked again on the new drawings and passed again.
6. **Publish.** For a seat, **Publish** stays disabled until the model holds in every facing and is passed. The
   server checks it again on the staged drawings (`scripts/lab-model.ts`), and once the piece is published writes it
   into `art/seat-models.json` with the day it was passed and its drawings' fingerprints, so a lab seat passes the
   gate.

The model is saved with the draft. **Library → Open** opens any catalog seat with its model (and its pass: the
drawings are the catalog's).

**Try it in game** is a real room drawn by the game's renderer from the draft's own sprites. The published catalog
is untouched: the lab serves a copy of the manifest with the draft swapped in. You can:

- turn the piece (the buttons, or **R**),
- click the floor to walk and click the piece to use it or sit on it (the nearest free cushion),
- **Fill seats** to put someone on every cushion, **+ People** to add a few people and **Clear** to remove them,
- switch between day and night, and zoom 1–4×.

Counter pieces stand on a counter.

**Publish to catalog** is enabled once every view is accepted, the checks pass and, for a seat, its model holds in
every facing and is passed. It goes through
`studio.py lab-publish`: the model check runs again on the staged entry, and then, under the manifest lock, the
drawings are copied to `public/art/sprites` and the entry is written to `public/art/manifest.json`. After that it's in
the decorate palette. The lab won't overwrite a key that's already in the catalog unless the draft was opened from
that piece.

**Export draft (.zip)** downloads the whole draft folder. **Discard** moves it to `art/drafts/.trash/`.

## Character parts

**Drafts → New character part**: hair, a hat, a top or a pet. They're drawn by `art/charkit.py` onto the standard
figure, front and back (a pet has only a front), and cut to the kit's tone map so the player's colour choice
recolours them. The prompt is shape and style only.

**Turnaround** is the real avatar kit (`drawAvatarV2`, the renderer the game uses), with the draft injected into
the part library in memory:

- all four facings, full body and close up,
- both bodies, every skin tone and a palette of colours,
- every pose (stand, walk, the sits, crouch, wave, work and the life poses) from any facing.

**Checks** runs the character standard (`avatarQa.lintAvatar`) on both bodies × four facings × every pose (bald
spots, covered features, holes, stray pixels) and outlines each failing frame in red.

**Publish to part library** writes the part into `src/client/engine/sprites/<kind>Lib.json` through
`charkit.py extract`. Writing the library reloads the dev page, but the draft keeps what it needs. To put the
part in the wardrobe, paste the line the lab shows under **Checks** (for example
`I('headwear', 'sun-hat', 'Sun hat'),`) into `AVATAR_ITEMS` in `src/shared/avatar.ts`. A draft can publish
again over its own part, but never over someone else's.

## Library

Every published piece, in all four rotations, with its name, category and rotation, and what the model check and the
furniture review say about it. You can search by name, key or category, filter by rotation, or show only the pieces
with problems. **Open as draft** copies a piece's drawings into a new draft (take 0, accepted), so you can iterate
on it and publish over it. The **Character parts** tab shows every hair, hat, top and pet in the libraries.

## Spend

The meter in the header shows today's spend and the total against the cap in `art/budget.json`. Every call is
logged in `art/out/usage.jsonl`. Typical costs: a furniture sheet at medium ≈ $0.02–0.06, a character part view at
high ≈ $0.05.

## Where things live

| | |
|---|---|
| `src/client/studio.html`, `src/client/studio/*` | the page (React) |
| `src/server/routes/devLab.ts` | the API, the localhost guard and the draft store (mounted in `app.ts` outside production only) |
| `art/designlab.py` | runs the generate, check and publish steps. Furniture goes through `studio.py`'s JSON commands, parts through `charkit.py` |
| `art/drafts/<id>/` | drafts: `draft.json`, `refs/`, `takes/<n>/`, `stage/`, `history.jsonl` (see its README) |
