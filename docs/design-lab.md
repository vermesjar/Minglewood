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

**Drafts → New furniture.** Give it a name, a catalog key (lowercase words joined by `-`, with a variant after a
dot: `chair-bistro.sage`), a category, how it turns and a footprint. The form covers **the model spec**
(`src/shared/models.ts`, in prose in `docs/furniture.md`). Every field on it is one the model check (`scripts/model-check.ts`)
requires:

| on the form | the model spec |
|---|---|
| name, category, rooms, tags, moods | `name`, `category`, `rooms`, `tags`, `themes` |
| footprint width × depth, height | `footprint` [width, depth] as seen facing sw, `height` (art px). The height is measured again from the drawing |
| how it turns | `rotation`: **radial** (one drawing), **mirror** (se + nw drawn; sw and ne are their mirrors), **full** (four drawings: anything handed), **flat** (wall art). "Looks the same from behind" is `sameFromBehind` |
| stands on | `layer`: the floor (`object`), a counter (`surface`, placed at the counter's z), flat (`floor`, a rug) |
| seat height, sat in as, backrest | the seat standard's profile (`seat`, `sitStyle`, `backrest`). Only seating has one |
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

**Try it in game** is a real room drawn by the game's renderer from the draft's own sprites. The published catalog
is untouched: the lab serves a copy of the manifest with the draft swapped in. You can:

- turn the piece (the buttons, or **R**),
- click the floor to walk and click the piece to use it or sit on it (the nearest free cushion),
- **Fill seats** to put someone on every cushion, **+ People** to add a few people and **Clear** to remove them,
- switch between day and night, and zoom 1–4×.

Counter pieces stand on a counter.

**Publish to catalog** is enabled once every view is accepted and the checks pass. It goes through
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
