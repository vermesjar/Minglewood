# Ambient life: everything that should move, and what it does

Carter's standing rule: **anything we build is animated appropriately, each piece with its own animation** (the
espresso machine steams, the koi swim, the fountain pours). This page audits every placed piece in the town and in
every room that implies motion, with its status. Keep it current: a new piece that implies motion lands with its
animation and a row here.

Status: **animates** (was already alive), **added** (given its own animation in this pass), **still** (checked:
nothing in the drawing should move, or it moves only when used).

## Where life comes from

| Source | What it drives |
| --- | --- |
| `src/client/engine/animations.ts` · `BY_FILE` | Idle life per drawing file, in the drawing's own pixels (mirrored with it): `steam`, `smoke`, `flames`, `fish`, `bubbles`, `shimmer`, `glow` (`dusk`: a building's lantern, full on the night glow layer), `blink`, `chase`, `marquee`, `strip`, `screen`, `code`, `candles`, `pendulum`, `clockface`, `bob`, `regionSway`, `bandSway`, `flag`, `nod`, `popcorn`, `ring`. A moved part's uncovered edge is filled from just beside it, so nothing tears. |
| `animations.ts` · `WALL_SPECS` | Pieces painted into the walls: `countdown`, `lanterns`, `neon`, `clock`, `blink` (left-wall pieces are mirrored like their art). |
| `animations.ts` · `MOMENT_SPOTS`, `src/shared/world/uses.ts` | Click moments: a coin in the fountain, the rocket lifting off, the globe spinning, the claw. Not idle life. |
| `src/client/engine/waterworks.ts` · `WATERWORKS` | Water that moves on its own drawing: the painted water lifted off and repainted every frame from the drawing's own colours (streams, foam, rings, ripples, lily pads, glints, lamplight after dark). |
| `src/client/engine/effects.ts` | Manifest `emitters` (chimney smoke, beacons, the lighthouse beam), the lake's ducks and glints, cloud shadows. |
| `src/client/engine/townLife.ts` | Birds, pigeons, butterflies, falling leaves and petals, fireflies. |
| `src/client/engine/WorldView.ts` | Trees sway (`swayOf`), heirlooms glint (`drawGlints`), the lake ripples (`drawWaterMotion`), window views show the weather (`drawWindowViews`), lamps light the dark (`lampLights`, `drawAmbience`, the glow layer). |

Checks: `src/client/engine/animations.test.ts` (in `npm test`) fails if an animated drawing is missing or any point,
box or quad of a spec falls off its drawing. `scripts/model-check.ts` checks that every drawing that animates belongs
to a model declared `animated` in `public/art/manifest.json`, and that an animated model animates in every drawing
except its `still` ones.

## The Founders' Fountain

`fountain.png` (192×184, drawn at 2×), town plaza (34,34), 3×3. `WATERWORKS['fountain.png']`.

- **Streams.** The two sheets spilling from the top bowl, the two lions' spouts and the two jets rising from the lower
  basin are lifted off the drawing. Each column carries its own light and dark dashes over pulses shared across the
  stream, running down the sheets and spouts and up the jets (20–30 drawing px/s). A jet's height breathes by a
  pixel or two, and it spills drops back down beside it that ring the water where they land.
- **Where water lands.** Foam churns in an ellipse under every stream, drops splash up out of it, and rings spread
  from it every ~0.7 s, clipped to open water and passing under the lily pads.
- **Pools.** Ripple crests, each with a darker trough, travel outward from the pedestal across all three basins.
- **Lily pads.** The nine pad clusters are found automatically, lifted off whole and bob a pixel on their own slow
  swells (3–5 s), now and then drifting a pixel. The water under them is filled in from round about.
- **Finial.** Water wells up at the orb's foot, in small drops and churn. The old particle spray (`effects.ts`) is
  retired for drawings with moving water.
- **Light.** By day, white four-point glints wink on the water (scaled by sunlight). After dark the water catches the
  lamplight, using the same lamp list that cuts the pools out of the night (`WorldView.lampLights`). A lamp beyond the
  water lays a warm glitter path of lit crests towards the viewer (the plaza lamp behind the fountain lights its right
  side), gold glints wink where the lamps reach, and all of it is on the glow layer, so people in front hide it.
- **The coin.** Clicking still tosses a coin (`wish`). It now lands in open water in front of the pedestal, among the
  coins already painted on the bottom. The splash, rings and drops are crisp pixels of the water's own colours.
- Every change is a whole drawing pixel in the drawing's own palette. The water repaints at up to 30 fps (about
  0.35 ms). With reduced motion the fountain is drawn as painted.

Proof: `art/review/fountain-before.png` and `art/review/fountain-after.png` (10 frames, 0.1 s apart, day and night,
zoom 2 and 4).

## Town

| Piece | Implies | Status | Where |
| --- | --- | --- | --- |
| Founders' Fountain | water | **added** | `WATERWORKS['fountain.png']`, see above |
| The lake | water | animates | `WorldView.drawWaterMotion` (ripple frames), ducks and glints (`effects.ts`) |
| Sea and shore | surf | animates | `surroundings.ts` (foam, stars) |
| Trees (all 891) | wind | animates | `WorldView.swayOf`; leaves and petals fall (`townLife.ts`) |
| Reeds ×10 | wind | **added** | `bandSway` on the top 40 % (cattails and iris stir, the stems in the mud stay) |
| Rowboats (red, yellow) | bobbing | **added** | `bob` 1 px, 3.4 s and 3.9 s |
| Bird baths ×2 | water, a bird | **added** | `WATERWORKS['birdbath.png']`: ripples, a drip ring now and then; the bird dips to drink (`nod`) |
| Café umbrellas (red, teal) | wind | **added** | `regionSway`: the canopy lifts a pixel over its pole |
| Scarecrow | a crow | **added** | `nod`: the crow hops off the arm now and then (lifted in five clear strips) |
| Lamp posts ×16 | light | animates | lamp model (`lampLights`), hum; night glow drawings |
| Garden lanterns ×7 | flame | animates | `glow` + fire breathing (`FIRE_LIGHTS`) |
| Fire ring | fire | animates | `flames` |
| Lighthouse | beam, weathervane | animates + **added** | beam and lamp (`effects.ts`); the vane turns a pixel (`regionSway`) |
| Bandstand (gazebo) | string bulbs | **added** | `blink`: its seven bulbs twinkle |
| HQ | flag, clock, lantern | **added** | `flag` (the cloth in two boxes round the pole's collar), `clockface` (the world's time, pixel hands), portico lantern `glow` (dusk) |
| Pixel Pier Arcade | marquee, neon | **added** | `marquee` round the arch and down its sides (47 bulbs) and along the canopy (22), neon `glow` ×2, parapet tubes `strip` ×2, pennant `flag`, wall lanterns (dusk) |
| Lantern Hall | 17 paper lanterns, banners | **added** | a `glow` per lantern, each on its own beat, full from dusk. Banners: still (they hang flat against the columns; a sway would tear the wall) |
| Tidewater Café | chimney, eave lanterns, sign | animates + **added** | smoke (manifest emitter); its 9 glass lanterns and 2 sconces `glow` (dusk). Hanging sign: still (the awning overlaps its board) |
| Quiet Grove | chimney, lanterns | animates + **added** | smoke (manifest emitter); porch and door lanterns `glow` (dusk). Rocking chair: still (drawn over the log wall) |
| Design Loft | chimney | **added** | `smoke` from the pot's mouth (the drawing marks no emitter) |
| Engineering | antenna | animates | beacon (manifest `blink`) |
| Launch Lab | tower, dish | animates | tower beacon (manifest `blink`). Dish: still (its rim overlaps the rail and roof box) |
| Balloons (events) | bobbing | animates | `bob` |
| Flower beds, wildflowers, garden beds, flower cart | life | animates | butterflies about them (`townLife.ts`); the flowers themselves still |
| Pigeons, birds, fireflies, cloud shadows | | animates | `townLife.ts`, `effects.ts` |
| Noticeboard | papers | still | every paper is pinned inside the frame, none loose |
| Armillary sphere | rings | still | cast metal, nothing turns |
| Benches, picnic tables, blankets, stumps, signpost, mailbox, bike rack, cairn, rocket statue | | still | nothing implies motion |

## HQ

| Piece | Implies | Status | Where |
| --- | --- | --- | --- |
| Koi aquarium | water, fish | animates | `shimmer`, `fish`, `bubbles`; `feed` moment |
| Grandfather clock | pendulum, time | animates | `pendulum`, `clockface` (now whole-pixel hands) |
| Heirloom trophy, gold, throne | shine | animates | `WorldView.drawGlints` |
| Time capsule | porthole | **added** | `glow` behind the porthole (both drawings) |
| Elevator (left wall) | call button | **added** | `WALL_SPECS.elevator`: the call button glows on and off |
| Window, lamp | weather, light | animates | window view; lamp hum |
| Logo wall | | still | a gold star under steady picture lights |

## Tidewater Café

| Piece | Implies | Status | Where |
| --- | --- | --- | --- |
| Espresso machine | steam | animates | `steam`, `brew` |
| House steampunk machine | steam | animates | `steam`, `brew` (now declared `animated` in the manifest) |
| Plant by the window | breeze | animates | `bandSway` near windows (`nearWindow`) |
| Windows, lamp | weather, light | animates | |
| Grinder, register, pastry case, back bar, menu board | | still | nothing implies motion |

## Engineering

| Piece | Implies | Status | Where |
| --- | --- | --- | --- |
| Desks (monitors facing us) | screens | animates | `code` |
| Desks seen from behind | | still | only the monitors' backs |
| Server rack | LEDs | animates | `blink`; `reboot` moment |
| Espresso machine | steam | animates | `steam` |
| Build dashboard (left wall) | live status | **added** | `WALL_SPECS.dashboard`: its status lights blink (the two grey ones come on) |
| Water cooler | water | **added** | `bubbles`: a bubble rises through the jug every few seconds (all four drawings) |
| Windows, lamps, plant by the window | | animates | |
| Pennants (platform, mobile) | | still | felt banners indoors, no draught |

## Launch Lab

| Piece | Implies | Status | Where |
| --- | --- | --- | --- |
| Countdown screen (wall) | countdown | animates | `WALL_SPECS['screen.countdown']` |
| Mission clock (wall) | time | **added** | `WALL_SPECS['clock-wall']`: the world's time |
| Star map (left wall) | stars | **added** | `WALL_SPECS['star-map']`: 14 stars twinkle slowly |
| Model rocket | liftoff | animates + **added** | liftoff on click; its porthole glows and its decal's stars twinkle, riding it when it lifts |
| Launch bell | ringing | animates | `ring` on click; glints |
| Workbench | 3D printer, soldering iron | **added** | the printer head works back and forth (`regionSway`), the iron smokes a little (`steam`) |
| Espresso machine, window, lamp | | animates | |

## Lantern Hall

| Piece | Implies | Status | Where |
| --- | --- | --- | --- |
| Floor lanterns ×5 | flame | animates | `regionSway` + `glow` |
| Lantern strings (wall) | light | animates | `WALL_SPECS['lantern-string']` |
| Cake table, balloons (event decoration) | candles, bobbing | animates | `candles`, `bob` |
| Cocktail tables ×4 | candle | **added** | `candles`: the flame in each hurricane glass flickers |
| Grand piano | music | animates | `piano` moment; glints |
| Podium | | animates | `toast` moment |
| Speakers ×2 | sound | still | cloth grilles, no cone painted; no music plays there |
| Banner (wall bunting) | | still | indoor swag, no draught |
| Windows | | animates | |

## Quiet Grove

| Piece | Implies | Status | Where |
| --- | --- | --- | --- |
| Fireplace | fire | animates | `flames` (toggle) |
| Jade dragon lamp | flame | animates | `glow`, fire breathing, glints |
| Walnut side tables ×3 | tea | **added** | `steam` from the teacup (their lamps: lamp model) |
| Ivy by the window | breeze | animates | `bandSway` near windows |
| Wooden desks | screens | animates | `code` |
| Globe | | animates | `spin` moment |
| Window, lamp | | animates | |

## Pixel Pier Arcade

| Piece | Implies | Status | Where |
| --- | --- | --- | --- |
| Arcade cabinets ×5 | screens, marquees | animates | `screen`, `blink`, `glow`; `arcade` moment |
| "PLAY" neon | neon | animates | `WALL_SPECS.neon` |
| Jukebox, claw machine, air hockey, vending machine, popcorn cart | | animates | their `BY_FILE` entries and moments |
| Prize counter | ticket display, lit edges | **added** | `screen` on the display, `strip` along the lit glass edges (from behind: its neon rails) |
| High table (neon) | neon rim | **added** | `strip` light running round the rim (both drawings) |
| Pool table | | animates | game on click (`tabletop.ts`) |
| Neon stools | | still | |

## Design Loft

| Piece | Implies | Status | Where |
| --- | --- | --- | --- |
| Light desks | screens | animates | `code` |
| Snake plant by the window | breeze | animates | `bandSway` near windows |
| Heirloom globe | | animates | glints; `spin` moment |
| Windows, arc lamp | | animates | |
| Fiddle-leaf fig | breeze | still | a tile short of the window rule |
