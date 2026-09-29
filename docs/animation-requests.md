# Animation requests (interiors)

For the café fork's animation system. Every entry names the sprite key and facing as published in
`public/art/manifest.json`, the region to animate in **sprite px of that drawing** (origin = the PNG's top-left,
before mirroring; mirrored facings mirror x), and the effect. Priority: **P1** = the piece reads as broken or
dead without it; **P2** = life and charm.

Coordinates were read off a grid over each published PNG; ±1 px.

| # | Key (facing) | Room | Region (sprite px) | Effect | Pri |
|---|---|---|---|---|---|
| 1 | `heirloom-aquarium` (sw; ne is its back) | HQ | water: front glass x 6–60, y 26–56; side glass x 60–88, y 16–46 | 3–4 koi (orange, white-orange, black moor) drift slowly left/right in the water, turning at the glass; small bubbles rise from the gravel (x ≈ 30, y 54) and pop at the waterline (y ≈ 26); a faint water-light shimmer | P1 |
| 2 | `fireplace` (sw) | Quiet Grove | fire opening x 14–30, y 48–68, centre (22, 58) | flame flicker (3–4 frames, tips rising); the floor light pool (manifest `light` {37,47,42}) pulses ±10 %; the existing toggle turns the fire on/off; embers glow when off | P1 |
| 3 | `clock-grand` (se; nw is its back) | HQ | pendulum pivot (19, 36), bob (19, 64); face centre (19, 25), r ≈ 6 | pendulum swings ±6° on a 2 s period; minute hand advances with real time | P1 |
| 4 | `arcade-cabinet.pink/cyan/lime/orange/gold` (sw) | Arcade | screen x 14–32, y 34–54 (centre 23, 44); marquee x 12–36, y 20–26 | attract mode: sprites on the screen scroll/blink on a 4-frame loop, each cabinet offset in phase; marquee brightness pulses; the manifest `light` pool breathes | P1 |
| 5 | `jukebox` (sw) | Arcade | neon arch tubes along the outer arch x 2–34, y 4–62; record window centre (22, 30) | neon tubes cycle magenta → cyan → violet slowly; when someone clicks it (new action), a few ♪ particles float up from (22, 4) | P2 |
| 6 | `claw-machine` (sw) | Arcade | claw at (22, 24) under the gantry at y 12; marquee x 6–40, y 4–10 | the claw sways ±1 px; marquee bulbs chase; clicking could run a claw grab (drop, close, rise) | P2 |
| 7 | `server-rack` (sw; ne) | Engineering | LED column on the front face x 8–14, y 20–80 (ne: cable side, LEDs x 40–50, y 30–70) | status LEDs blink green/amber at random intervals | P2 |
| 8 | `desk` (sw) | Engineering | monitor screens: left x 20–40, y 4–34; right x 42–64, y 14–40 | lines of code scroll up one row every ~1.5 s (subtle; only desks with someone seated would be a nice touch) | P2 |
| 9 | `screen.countdown` (wall, 60 × 32) | Launch | ring centre (47, 14), r ≈ 8; trajectory arc (8, 22) → (32, 8) | the ring's segments light up one by one on a loop (countdown); a dot travels along the arc | P2 |
| 10 | `lantern-string` (wall, 95 × 32) | Lantern Hall | seven lanterns centred at x ≈ 5, 16, 25, 36, 46, 56, 67, y ≈ 16 | lanterns sway ±1 px out of phase; glow pulses softly | P2 |
| 11 | `balloons`, `balloons.b`, `balloons.c` (se; nw) | Lantern Hall | the whole bunch above the weight (y < 60) | gentle bob ±1 px, 3 s period, out of phase | P2 |
| 12 | `cake-table` (sw) | Lantern Hall | candles on top of the cake ≈ (14–20, 4–8) | candle flames flicker | P2 |
| 13 | `air-hockey` (sw) | Arcade | LED strips along both long rails (magenta / cyan) | strips pulse; the puck could glide when two people stand at the ends | P2 |
| 14 | `heirloom-dragonlamp` (se) | Quiet Grove | lantern glow centre (42, 40) | a slow candle flicker on the glow and its light pool | P2 |
| 15 | `plant.a`, `plant.b`, `plant.pothos` | every room | leaf tips | a 1 px breeze sway near windows only | P2 |
| 16 | `neon` (procedural, "PLAY") | Arcade | the whole sign | an occasional neon flicker (one letter dips for 2 frames every ~8 s) | P2 |

Notes
- Lights: `fireplace`, the five `arcade-cabinet.*` colours, `jukebox`, `claw-machine`, `lamp-arc` and the reused
  café `lamp` carry manifest `light` points, so they already cast pools. Whether screens/neon should respond to the lamp
  toggle is your call; the arcade reads best with its screens always on.
- The launch bell (`heirloom-bell`) already has a `ring` action; a swing (±15°) plus a brass glint on ring would sell it.
