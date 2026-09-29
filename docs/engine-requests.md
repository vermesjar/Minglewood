# Engine requests from the world / exteriors pass

Status (round 2): all items below are done — ducks on real water, emitter-driven smoke / spray / blink / beam,
the outdoor night pass (tint, lamp pools, window glow), animated water (ripple frames cross-faded in
WorldView.drawWaterMotion), tree sway, 2× town ground (streamed: flat coat → 1× detail → 2× swap, cached per
scene), label placement on each building's own roof, off-screen culling, and the linter tolerances.
Kept for the record:


The town was rebuilt at real scale (76×76, buildings sized around ~40 px people) with generated exterior art
conformed to exact footprints (`art/town_conform.py`) and 2× props (`art/specs/town-props.json`). The data the
engine needs is already published in `public/art/manifest.json`; these hooks make it live. Files named are
owned by the café/engine agent (WorldView.ts, effects.ts, art.ts).

## P1 — bugs visible now

1. **Ducks are on dry land.** `effects.ts` `load()` hardcodes duck circuits at old-map tiles (38,31), (35,40),
   (43,24) — now the plaza and grass. Derive them from the scene instead, e.g. pick 4 lake tiles whose
   shore distance is 2–4 tiles (deterministic via `hash2`), or accept marker positions. Verified shallow-water
   tiles in the new town (`npx tsx scripts/town-probe.ts` lists more): (66,32) and (67,31) off the café pier,
   (66,39) just south of it, (54,58) off the park shore, (64,62) by the lighthouse island.

2. **Chimney smoke is placed from the procedural building geometry**, which no longer matches the art (the
   café's chimney is now at the art's top-right). For objects with art, read `manifest.sprites[key].emitters`
   instead of `o.building.extras`:
   ```ts
   // emitters: [{ kind: 'smoke' | 'spray' | 'blink' | 'beam', x, y }] in SPRITE px (2× density)
   // world pos = object anchor (tile back corner at floor) + (x - sprite.ax, y - sprite.ay) / sprite.scale
   // (mirror x when the art is mirrored for the object's facing)
   ```
   Published: `building.cafe` smoke, `building.focus` smoke, `building.eng` blink (antenna light),
   `building.launch` blink (tower beacon), `fountain` spray (top bowl), `lighthouse` beam (lantern room).
   `blink` = a small red/orange light pulsing ~1 Hz (brighter at night). Keep the procedural fallback for
   buildings without art.

## P2 — outdoor day/night (pairs with the global day/night clock)

3. **Outdoors has no dusk/night pass** (`drawAmbience` only runs for interior shells). At dusk/night dim the
   town (same tints as interiors), then:
   - **Lamp posts light the street**: `lamp-post` has `light: {x: 25, y: 21, r: 70}` (sprite px) — the same
     contract as interior lamps (`artLight`), so the existing pool/glow code can run outdoors.
   - **Windows stay lit**: every building has `glow: "building.<room>.glow.png"` (and `lamp-post` has
     `lamp-post.glow.png`) — a mask of its lit glass, lanterns and bulbs at the sprite's size and anchor. Draw
     it over the dimmed town with `globalCompositeOperation = 'lighter'` (or 'screen') at alpha
     `sky.lamp * 0.9`. `art.ts` must preload `glow` files alongside `file`.
   - The lighthouse `beam` sweeps slowly at night (there is already a lighthouse hook in effects.ts; move its
     origin to the emitter point).

## P3 — density and polish

4. **Outdoor ground at the art density.** `renderOutdoorGround(scene, scale)` now takes a scale and returns
   `GroundLayer.scale`. WorldView draws the ground with `gk = shell?.scale ?? 1` (interiors only). Change to
   `const gk = (this.ground as { scale?: number }).scale ?? 1;` and call `renderOutdoorGround(scene, 2)`.
   Grass, cobbles, plaza rings and lily pads then match the 2× buildings and props instead of reading chunky
   at zoom 2. Cost: one ~4.9k × 2.5k canvas (≈ 48 MB RGBA) for the 76×76 town; if that is too heavy on
   phones, render 2× only when `devicePixelRatio > 1 || innerWidth > 1200`.

5. **Animated water (sparkle + ripple).** The lake's ground layer now has per-pixel depth (4 dithered tones
   following the distance to shore), a foam line, wet sand, lily pads and static ripple/sparkle highlights.
   To make it move: every ~0.25 s, redraw ~2 % of water pixels as highlights along the same ripple function
   shifted by time, or cheaper — keep two pre-rendered sparkle masks (ground.ts can export them; ask) and
   cross-fade them on a slow sine. Water pixels are those whose terrain class is `w`/`W` after smoothing
   (`renderOutdoorGround` can return a `water` mask canvas if you want it — say so in this file).

## Linter notes (scripts/furniture-review.ts)

7. **Diamond-filling pieces read as narrow.** `flowerbed.*` (fit to their tile diamond, base centred exactly
   on the footprint) are flagged "narrow base off the footprint centre by (-0.5, 10.3)": their lowest rows are
   the diamond's front vertex, which is narrow by construction. Suggest: skip the narrow-base check when the
   base (lower 30 %) is ≥ 70 % of the footprint width.
8. **Building stoops.** `building.*` show 5–20 px of steps / planters / a parked bike past the front or side
   corner. Deliberate: a stoop stands on the apron tile in front of the door, which the town already keeps
   clear (a 1-tile ring around every building is unbuildable). Suggest a 24 px apron tolerance for
   `building.*`. (The Quiet Grove, which spilled 44 px with its fern skirt, was re-conformed to a 7×8
   footprint that includes the skirt and now passes.)

6. **Trees sway (optional).** A 1–2 px horizontal skew of the top half of `tree/*` sprites on a slow sine with a
   per-object phase gives the forest life. Only if it stays crisp (whole-pixel offsets).

## NPC behaviours (from the interiors pass)

The interiors now have three more NPCs besides the café's Juno, all using only what `npcs.ts` supports today
(idle drifting between spots): **Margot** (HQ receptionist, staff lane (6–8, 1) behind the reception desk),
**Pip** (Arcade attendant, lane (0, 8–9) behind the prize counter) and **Wren** (Quiet Grove librarian, lane
(1–3, 1) in front of the left-hand stacks). These would make them feel like people who work there rather than
people standing there, in priority order:

1. **Greet (P1: receptionist, attendant).** When a player enters the room or comes within ~2 tiles of the NPC's
   home spot, the NPC turns to face them and waves (`doing: 'serve'` already maps to the `wave` pose) for
   ~1.2 s, with an optional speech bubble. Suggested data: `NpcDef.greeting?: string[]` (one picked at random,
   e.g. Margot: "Welcome to Northstar!" / "Looking for someone? I can point you there.", Pip: "Tickets? Prizes are
   this way!"). Rate-limit per player (once per visit). Wren should *not* greet: she's the quiet one.
2. **Per-spot idle activity (P2: librarian, receptionist).** Let a spot say what the NPC does there:
   `spots[].doing?: 'work'` (reusing the existing `work` pose), so Wren's shelf spot (3, 1) facing `ne` reads as
   shelving books, and Margot's spot (6, 1) as typing at the monitor. Today they just stand.
3. **Seated NPCs (P2).** `spots[].sit?: objectId` so an NPC can sit on a chair at a spot (the `sit` pose,
   seat height from `artSeat`). Margot's office chair `hq-desk-chair` at (8, 1) is placed for this (it has no
   `sit` action so guests can't take it); she could spend some idle turns seated there.
4. **Counter service for the arcade (P3).** `serves` needs a vend object. A prize counter that hands out a
   prize would need a carryable prize: a `held.plush` (small plush toy, tinted by `heldColor`) added to the
   avatar kit and `CARRYABLE`, then the counter gets `actions: [{ kind: 'vend', item: 'plush', label: 'Trade in
   tickets' }]` and Pip gets `serves: 'prize-counter'`. Same pattern would work for `popcorn-cart` (`held.popcorn`)
   and the snack `vending-machine` (`held.soda`). I have *not* added these actions, since the items don't exist yet.

## Done (engine / café agent)

All of P1–P3 is live (WorldView.ts, effects.ts, art.ts, animations.ts). How to use each:

1. **Ducks** are derived from the scene: open water 2–4 tiles from shore (BFS distance), picked with
   `hash2` so every client sees the same ducks, ≥ 6 tiles apart, loop radius kept inside the water; the first
   has a companion. No markers needed. **Water glints** twinkle over the scene's own `w`/`W` tiles (count
   scales with the lake, ≤ 60) — and switch themselves off when the ground layer brings its own animated
   `water` frames (your `drawWaterMotion`), so the lake never gets two sets of sparkles.
2. **Emitters**: `manifest.sprites[key].emitters` are read per drawing (`Sprite.emitters`, mirrored with the
   art) and placed at `static.dx + x / scale, static.dy + y / scale`. `smoke` → chimney smoke, `spray` →
   fountain spray, `blink` → a red beacon pulsing ~1 Hz with a halo at night, `beam` → the lighthouse lamp.
   A drawing **with art and no emitters gives off nothing** (the procedural chimney fallback only runs for
   buildings still drawn in code), so add an emitter to any building that should smoke.
3. **Outdoor dusk/night**: the same tints as interiors (`drawAmbience` now runs outdoors). Street lamps use
   the `light` contract and only light up from dusk (`NIGHTNESS`: night 1, dusk 0.6, dawn 0.3, day 0); the pool
   radius scales with `light.r` (≥ 78 px). **Glow masks** (`glow` in the manifest, preloaded by art.ts,
   `Sprite.glow`, mirrored with the art) are composited occlusion-correctly: collected in depth order on their
   own layer (everything drawn in front erases what it covers — a tree or a person in front of a lit window
   hides it), then added with `lighter` at night 0.9 / dusk 0.6 / dawn 0.25. The haze around the town follows
   the phase too. The **lighthouse** beam sweeps once every 9 s at night from the `beam` point (brighter when
   it swings toward the viewer); by day the lamp just winks.
4. **Ground at 2×**: `renderOutdoorGround(scene, 2)` when `devicePixelRatio > 1 || innerWidth > 1200`, else 1;
   WorldView draws it with `this.ground.scale`.
5. See 1 (glints).
6. **Trees sway**: `tree/*` crowns lean by whole sprite pixels (top third ±2, middle ±1, trunk still) on a
   slow per-object sine, mostly at rest. Off with reduced motion. Potted `plant`s within two tiles of a window
   stir too (animations.ts `bandSway`).
7–8. **Linter**: both suggestions applied — diamond-filling pieces (base ≥ 70 % of the footprint over its lower
   30 %) skip the narrow-base check; `building.*` get a 24 px apron tolerance. Town pieces are checked in their
   authored orientation only, and "needs every rotation" only applies to keys placed in rooms. Keys with `/`
   are written as `tree__birch.a.png`. The whole manifest now passes (`npx tsx --tsconfig tsconfig.json
   scripts/furniture-review.ts`).

### NPC behaviours — done

1. **Greet**: `NpcDef.greeting?: string[]` (Margot and Pip have lines; Wren has none). A live player entering
   the room gets one hello per visit (~0.9 s after arriving); walking up to within ~2 tiles of the NPC gets
   another only after 45 s; an NPC says hello at most every 6 s however busy the door. Standing NPCs turn
   toward the person and wave (`doing: 'greet'` → wave pose) for 1.6 s with a speech bubble (`NpcState.say`,
   sent once, never replayed to newcomers); seated ones just speak. Then they return to what they were doing.
2. **Per-spot work**: `spots[].doing: 'work'` → the `work` pose while idle there (Margot types at (6,1), Wren
   shelves at (3,1), Pip tidies the counter at (0,9)). Work and seat spots hold them longer (14 s+).
3. **Seated NPCs**: `spots[].sit: objectId` → they sit on it (sit pose, seat height, depth like a guest).
   Margot spends some idle turns in `hq-desk-chair`.
4. **Counter service**: carryables `plush`, `popcorn`, `soda` added to `CARRYABLE`; the prize counter
   (`vend: plush`, served by Pip: he steps to the counter, works, hands it over), the popcorn cart (`popcorn`) and
   the vending machine (`soda`) are self-serve (a 0.7 s moment at the machine — the cart throws up a flurry of
   kernels — then it's yours). The kit draws `held.plush`, `held.popcorn`, `held.soda`.

## Design Lab requests (from the Design Lab, `docs/design-lab.md`)

The lab publishes furniture only through studio.py's JSON commands (`lab-generate`, `check`, `lab-publish`) and
character parts through `charkit.py`. These would make it complete:

1. **studio.py `lab-generate`: turn the footprint per facing.** It draws every view on `spec.footprint` as given.
   A long piece (width ≠ depth) covers `[depth, width]` facing se/nw (models.ts `footprintFacing`), so its se and
   nw guides are the wrong way round. For now the lab works around it: it passes a long mirror piece's footprint
   turned (both of its views are se/nw), and it draws a long `full` piece's four sides one call at a time, which
   costs four calls and gives less consistent sides. Asked for: per view, `w, d = footprintFacing(spec, facing)`,
   so every view is drawn on one sheet.
2. **studio.py `lab-generate`: return the take's raw sheet path** (`sheet.png`, `prompt.txt`), so the lab can
   show the model's raw output next to the pixelized view.
3. **Light points per drawing.** When a lamp is drawn, the lab puts its light a third of the way down each
   drawing's silhouette. A `light` hint from the construction guide (where the shade is), returned per view by
   `lab-generate`, would be exact.
4. **charkit.py: a JSON entry point** like studio's (`part-generate --out DIR`, `part-extract`). Today the lab
   runs `charkit.py <kind> <name> --no-publish --regen` and then reads `out/charkit/<job>.json`. It also renames
   the raw and meta files to publish under the final name before running `extract`.
5. **Wardrobe entries for new parts** (owner of `src/shared/avatar.ts`). A published part lands in
   `<kind>Lib.json`, but it only appears in the wardrobe once `AVATAR_ITEMS` lists it. The lab shows the line to
   paste. Ideally `AVATAR_ITEMS` would pick up library entries that have a `label` automatically, or read a
   small `parts.json` the lab can write.
6. **Seat profiles for lab seats.** A new seat publishes `seat`, `sitStyle` and `backrest` from the form.
   `scripts/seat-fit.ts --fit <key>`, run on the staged drawing, would measure `seatDepth` and `backDepth`
   the way it does for catalog seats. The lab would call it before publishing.

**Design Lab follow-up:** the lab now passes the true footprint and relies on 1. A long mirror piece is still drawn
sw + ne, the catalog's convention, from a 'full' sheet with only those two kept. **6 is done in the lab:** the
Seat panel calibrates from one click, `scripts/lab-seat.ts` re-fits it on the staged drawings before a publish,
and `scripts/seat-fit.ts` reads `art/seat-calibration.json`, which the lab writes. Seen while testing, for the
seat standard's owner: a cushion point clicked far too high (on the backrest) still passes the back views
(ne/nw "sit right" while the fronts float), so the back check doesn't catch a sitter hovering above the seat
behind a tall backrest.

**Done (1–3, the rotation/model-spec pass):** `lab-generate` draws each view on `footprintFacing(spec, facing)`
(all views on one sheet), returns `raw: {sheet, prompt, guide}` and each view's `raw`, and gives a lamp
(category `lighting`, or a spec with a `light`) a `light` per drawing where that drawing glows (its lit shade or
lantern), on the entry's `facings`. `studio.publish_sprite` also records a long piece's footprint as
`[width, depth]` whichever facing it was drawn from.
