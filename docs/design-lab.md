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
| seat height, sat in as, backrest, arms | the seat standard's profile (`seat`, `sitStyle`, `backrest`, `arms`). Only seating has one. It's what the seat's model is fitted from; how people sit in it is the model (**How people sit** is automatic. Choose a seating type, describe its appearance, and generate its drawings.
The type supplies the pose, cushion height, and construction defaults. There are no sitting-point sliders,
per-facing offsets, traced overlap masks, or anchor nudges for seating.

Supported types are chairs (including office and dining chairs), armchairs, sofas/loveseats, benches/banquettes,
stools, ottomans/poufs, beanbags, floor cushions, and thrones. Sofas and benches support a single row of two,
three, or four cushions. Backrests and armrests are optional on chairs, benches, and stools. These are upright
seating types: reclining poses, chaises, hammocks, corner sectionals, and multi-row seating need their own
future mechanics and must not be represented as an ordinary chair.

After generation, `seatCompiler.ts` fits one physical model to all four resolved views. It enforces cushion size,
outer arm placement, support frames below the cushion, and clearance around the sitter. It retries a failed
fit automatically. A drawing that still fails stays unpublished; redraw the artwork rather than manually rigging it.
The declared `seatKind` determines construction, independently of the catalog key.

The browser runs the compiler in a worker. The preview shows four directions, three outfits, individual cushions
or full occupancy, and normal/enlarged scales. The server compiles or validates the same model on staged pixels
before publishing. Changes to drawings, anchors, type, footprint, or pose invalidate its compilation fingerprint.

Every facing uses the same physical pelvis point. Complete legs are drawn in front and rear views, then each
figure is masked against the furniture separately. Open chair frames reveal the legs behind them; solid backs
and skirts occlude them. Reachable stool footrests support the feet. The same composition drives the preview
and the room renderer, including the step into and out of the seat.

Accepting a drawing remains an appearance choice. It is not manual calibration or a substitute for seating checks.
Before publishing, use the occupied previews and room sandbox to review how the piece looks. Automated fit checks
reject known structural failures; they cannot guarantee the artistic quality of every possible generated image.

Developer verification and the catalog audit are documented in [seating.md](seating.md).

**Try it in game** uses a real room and the draft's sprites without changing the published catalog. Turn the piece
with the buttons or **R**, click the floor to walk, click the piece to use it, and use **Fill seats**, **+ People**,
or **Clear** to change occupancy. Day/night and zoom controls are available. Counter pieces stand on a counter.

**Publish to catalog** becomes available after every drawing is accepted and the checks pass. `studio.py lab-publish`
checks the staged entry again, then copies drawings and updates the manifest under its lock. An existing key can
only be replaced by a draft opened from that piece. **Export draft (.zip)** downloads the draft; **Discard** moves
it to `art/drafts/.trash/`.

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
