# Engine requests from the world / exteriors pass

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

5. **Water shimmer.** The lake is a static ground layer. A few slow-moving glint particles on water tiles (or a
   2-frame shimmer overlay for water pixels) would make it breathe.

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
