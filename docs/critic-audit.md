# Critic audit — rooms and town at play scale

Method: every room (café, HQ, Engineering, Launch, Lantern Hall, Quiet Grove, Arcade, Design Loft) rendered
at zoom 2 and zoom 3, day and night, with people (`art/review/crit-<room>-<day|night>-<2|3>x.png`); every
room again with **every seat occupied** at zoom 3 (`crit-seated-<room>-3x.png`); the town at zoom 2 across a
grid of 14 camera positions by day plus dusk and night (`crit-town-<x>-<y>-<phase>.png`). Crops at 1:1–5×
are `crit-crop-*`, `crit-seat-*`. Before/after pairs are `crit-before-*` / `crit-after-*`.

## Ranked defects

| # | Where | Defect | Status |
|---|-------|--------|--------|
| 1 | Seating, 5 rooms | **Sitters crowding sitters.** 11 seats put their sitter in the same screen column as, and just in front of, someone facing the camera, whose face and body vanished under the nearer sitter's head: the HQ lounge armchair behind the sofa's far cushion; the third chair on the near side of the café and Lantern Hall bistro tables; the Engineering meeting-nook armchair and lounge beanbag; the Quiet Grove fireside L and reading circle; the arcade high table's third stool (`crit-seat-cafe-tables.png`, `crit-seat-focus-circle.png`, `crit-seat-hq-armchair.png`). | **Fixed**, and **guarded**: `scripts/room-map.ts` now fails on any occupied seat whose sitter covers a camera-facing sitter behind it (it's in the gate). |
| 2 | Café | **Register back view read as a side view** (crank on the customer face). The café's register now faces the barista, so customers see its back. | **Fixed**: regenerated from the front as reference (`art/specs/fix-backs.json`): flat brass back with scrollwork and a maker's plate, the "amount" flag on top, plain side (`crit-after-cafe-3x.png`). |
| 3 | Everywhere | **Fiddle-leaf fig (plant.b) sliced flat at the top**: the slicer cut it on the sheet's row line. Used in 7 rooms. | **Fixed**: re-cut from the full sheet component, republished. **Guarded**: `furniture-review.ts` now flags any drawing whose top rows run flat instead of narrowing to a cap; the whole manifest was scanned, and the fig was the only one. |
| 4 | Town | **Founders' Oak sliced vertically** through its crown (same slicer fault, on the landmarks sheet). | **Fixed**: re-cut from its full component, re-fitted with `town_fit.py` (`crit-before-oak.png` → `crit-after-oak.png`). |
| 5 | Lantern Hall | **The stage was the one vector piece in a pixel world**: smooth anti-aliased polygons, a plain slab with no trim. | **Fixed**: drawn pixel by pixel at shell density: honey boards with staggered joints, a bright lip with footlights, a pleated plum velvet skirt with a brass rail, a shaded end panel, a contact line (`crit-before-stage.png` → `crit-after-stage.png`). |
| 6 | Town | **Cloud shadows drifted off the map** onto the sky around the island as grey blobs (`crit-town-10-70-day.png`). | **Fixed**: shadows are clipped to the ground diamond (`crit-after-town-10-70.png`). |
| 7 | Studio pipeline (seats) | Back views of seats could come out leaning like their fronts (the model draws the wrong diagonal), leaving chairs sideways to their desks. | **Guarded**: `studio.py build` now compares each one-tile seat's back-view lean with its front's and flips it before publishing (same test as `check_facings.py`). |
| 7a | Town, every building | **You could stand inside building fronts** ("I can stand on the box out of the front [of Lantern Hall] that looks like a pillar"): the art's column plinths, planters, stair side blocks and the Engineering stoop bike reach over walkable tiles in front of the doors. | **Fixed**: 35 stoop tiles across 7 buildings are blocked (invisible flat blockers, `STOOP_BLOCKS` in `northstarTown.ts`); door tiles and the tile each door opens onto stay free, long walks still pass. **Guarded**: `scripts/town-stoops.ts` (in the gate) measures each building's drawing over the tiles in front of its two visible faces and fails if a covered tile is walkable. |
| 7b | Eng, Launch, Arcade | **Beanbags faced the wrong way** when their sitter faced away: one front drawing (hump behind the sitter) served every facing. | **Fixed**: back views generated for all four colours (hump toward the camera), published as facings {se, nw} (`crit-after-bb-launch.png`, `crit-after-bb-eng.png`). **Guarded**: `check_facings.py` now fails any single-drawing seat with a back or hump (chairs, armchairs, couches, benches, thrones, beanbags) or whose seat outline isn't symmetric. |
| 8 | Town | **Empty meadow** north-east of the café (the corner between the cherry grove and the forest, `crit-town-57-19-day.png`, `crit-town-70-10-day.png`) and an empty lawn west of Launch Lab (`crit-town-19-57-day.png`): big plain grass with one lone birch. Reads unfinished next to the dressed plaza. | Open — see "Next". |
| 9 | Town | The café terrace paving meets the shore in **right-angle steps** (`crit-town-57-38-day.png`, around the pier root). | Open — ground.ts shore/paving blend. |
| 10 | Town | The island is a thin slab: a 1-band brown cliff on a flat cream void at the map corners. | Open — a deeper earth/rock skirt would sell it. |
| 11 | Rooms, night | The night tint is a flat blue multiply that greys every colour equally; rooms read dim but flat except inside lamp pools (`crit-eng-night-2x.png`). | Open — engine (WorldView ambience): a warmer, less desaturating night (keep hues, drop value), and let windows cast cool moonlight patches. |
| 12 | Town, day | Buildings' window glow is baked into the art, so windows read lit at noon (HQ especially). | Open — low priority; would need a day variant of the facades. |

Seated-in-context audit, everything else: no depth or position errors found. Chair backs, armrests, table
tops, desk monitors, counter fronts and sofa backs all draw in front of / behind their sitters correctly in
all eight rooms at zoom 3; rows of backs (Lantern Hall audience, desk pods) overlap as real rows do. Seat
facings were also checked in data: every chair and stool beside a table or desk faces it (the only
exceptions are wingbacks beside a side table, which is intended).

## Notes for the main session (outside my files)

- **Night ambience** (#11): `WorldView.drawAmbience` multiplies the whole room by one colour at 0.7. Consider a
  value-only darkening (HSL lightness) plus a small blue shift, so the room's palette survives at night.
- **Status dots**: every person in town has a small blue dot floating over their head at all times; at town zoom
  it reads as noise (HUD).

## Next

1. Dress the empty town meadows (#8): an orchard or community garden, a meandering path with benches, wildflower
   patches, a picnic lawn. Reuse existing props; generate a garden bed / orchard tree if needed.
2. Shore blend (#9) and a deeper island skirt (#10) in `ground.ts`.
