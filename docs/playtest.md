# Playtest

Automated playthroughs of the real app in headless Chromium (`npm run playtest`, Playwright, specs in
`tests/e2e/`). Each worker plays as its own demo member ("Playtest Bot N") and does what a player does:
clicks on what it sees (a pixel of the sprite that the game's own hit test resolves to that thing), walks,
waits to arrive, and checks the result against the live game state (`window.__mw`). Screenshots at 1:1 play
zoom land in `art/review/playtest/` — a tagged run (`PLAYTEST_TAG=pt`) in `art/review/playtest/pt/`.

Every bug below was reproduced more than once and checked in the screenshots (not just the asserted state).
Each has a spec in `tests/e2e/regressions.spec.ts` that passes while the bug is there (`test.fail`) and turns
red the moment it's fixed — then delete its `fail(OPEN, …)` line and it guards the fix.
`PLAYTEST_SHOW_OPEN=1 npx playwright test regressions` runs them as plain tests, to watch each one fail.

## Ranked bugs

Owner key: **SEAT** = seat agent (seat standard, sitting in WorldView and the sit protocol) · **ENGINE** = main
session (WorldView loop, effects) · **CHAR** = character-life agent (avatar renderer, poses) · **LAYOUT** =
interiors/critic · **HUD** = main session.

### #1 · "Stand up" leaves you sitting in mid-air beside the seat — SEAT (+ server protocol) · every time

**What you see.** Sit anywhere, press **Stand up**: the chair empties, and you're still in the sit pose, now
floating on the floor tile next to it (the step-off tile), with the chair's backrest mask drawn over you. The
Stand up button stays. You stay like that until you walk somewhere.
`art/review/playtest/pt/standup-focus-seated.png` → `standup-focus-after-stand-up.png` (Quiet Grove wingback),
`art/review/playtest/pt/seat-motion-town-stand-up.png` (town café chair).

**Why.** `OrgHub.stand` sends `{ t: 'updated', patch: { sittingOn: undefined, x, y } }`. JSON drops the
`undefined`, so what arrives is `{"x":10,"y":1}` (captured on the wire). `WorldView.patch` and the store merge
the patch and keep `sittingOn`; the seat animation then slides the still-seated figure to the step-off tile (the
seat-motion recorder saw a 17.9 px one-frame jump, `sit → sit`).

**Fix.** Make "not sitting" survive the wire: send `sittingOn: null` (type it `string | null`) and treat null as
standing in `WorldView.patch` / the store; or clear `sittingOn` client-side whenever an `updated` patch moves
you off your seat's cushion. Same root as #3.

**Repro.** Any room → click a free chair → wait until seated → press Stand up.
**Spec.** `regressions.spec.ts` "#1 Stand up stands you up".

### #2 · The world can stop for good (frame loop dies) — ENGINE · most headless boots, fatal when it hits

**What you see.** Everything freezes: nobody walks, the iris into a room never finishes (the UI says café,
the canvas still shows the town), animations stop, until a reload. Happened on most of the first run's boots
(`art/review/playtest/run1/`, `frozen-entering-*.png`).

**Why.** `WorldView.frame` computes `dt = Math.min(0.05, (t - this.last) / 1000)` with `last` from
`performance.now()` at construction, but a rAF timestamp is the time its frame *started* — the first one can be
earlier, so the first step is negative. The effects clock goes below zero, the lake glints index
`this.water[(k * 7919 + i * 104729) % n]` with a negative `k` → `undefined` → `TypeError: undefined is not
iterable` in `Effects.drawUnder`. `frame()` only re-arms `requestAnimationFrame` after a clean update + draw, so
one throw ends the loop. Only the town has water, so it bites on load into town (and then every room entered
from there).

**Fix.** `dt = Math.max(0, …)`; index with `((x % n) + n) % n`; re-arm rAF first (or try/catch the frame) so no
single bad frame can stop the world. The harness works around it (`MONOTONIC_FRAMES` in helpers.ts;
`PLAYTEST_RAW=1` turns the workaround off) — remove that once fixed.

**Spec.** `regressions.spec.ts` "#2 …" (two specs; the rAF clock is pinned 4 s behind so it happens every time).

### #3 · Get up from a seat and you can't sit on it again — SEAT / HUD (client store) · every time

**What you see.** Sit on a chair, walk off, click the same chair: nothing happens (on a couch, it seats you on
the *other* cushion). The **Stand up** button stays on the action bar after you've walked away. Seats that
other people (and the simulated coworkers) got up from still count as taken: clicking them just toasts
"Someone's already sitting there".
`art/review/playtest/regress-3-walked-off-*.png`, and the "from behind" failures across every room in
`art/review/playtest/pt/findings-sit-on-every-seat-*.json`.

**Why.** The store never learns anyone stood up: walking off sends `moved`, which `game.ts` passes only to the
view (`w?.move`), and Stand up's `sittingOn: undefined` is lost on the wire (#1). So `occupants[me].sittingOn`
keeps the seat; `onObjectClick` takes the "already sitting here" branch and returns, `sitOn` filters out
"occupied" cushions from the stale store, and the ActionBar's Stand up follows the store.

**Fix.** Clear `sittingOn` in the store on `moved` (as `WorldView.move` does) and on a null `sittingOn` (#1).

**Spec.** `regressions.spec.ts` "#3 walking off a seat and clicking it again sits you back down" (also checks
the Stand up button is gone).

### #4 · The far cushion of every couch and bench seats you on the near one — SEAT (client cushion pick) · ~50%

**What you see.** Click the back/left cushion of a two-seater (every couch and bench: café green couch, HQ blue
couches and navy benches, Launch Lab couch and bench, Engineering lounge sofa, Design Lab sofa, every town
bench) and you sit on the other cushion. Shifting over on a couch you're on mostly does nothing. This is
"benches only seat one" / "clicking the other side puts me in the wrong place".
`art/review/playtest/pt/seat-hq-hq-13-1.png` (clicked cushion 1, sat on cushion 0),
`seat-cafe-cafe-30-1.png`, `seat-launch-launch-couch-1.png`, `seat-motion-town-shift-over.png`; town bench o1
probe (sit on the near cushion, click the far one, stand, walk off, click the far one again — the same cushion
every time): `probe-bench-o1-0.png`, `probe-bench-o1-1.png`, `probe-bench-o1-1b.png`. On the wire: clicking
cushion (30,33) sends `{"t":"sit","objectId":"o1","at":[30,32]}`.

**Why.** The server now honours the cushion asked for (`at`), but `onObjectClick` picks it as the spot nearest
`world.tileAt(click)` — the click projected onto the *floor*. A cushion is drawn ~10 art px up, its back higher,
so a click on the far cushion projects a tile further back and the nearest spot is often the near cushion.
Measured over every pixel of each seat's sprite that the hit test gives to it: the near cushion is picked right
100% of the time; the far cushion's own pixels pick the far cushion only 36–63% of the time (HQ couches 52% and
63%, café couch 54%, Design sofa 45%, town benches 36–52%).

**Fix.** Pick the cushion in screen space at sitting height (nearest `isoToScreen(spot, z = seat height)` to the
click), or split the sprite's hit mask per cushion.

**Spec.** `regressions.spec.ts` "#4 clicking a cushion of a couch or bench seats you on that cushion".

### #5 · What you carry vanishes when you sit — CHAR · every seated view facing away

**What you see.** Sit down holding a coffee, soda, boba, ice cream, book or plush: facing away (ne/nw) none of
it shows (0 px); facing the camera only 8–13 px show. Standing or walking it's 31–42 px (fine). Part of "it's
not clear I'm holding a coffee" — the name-tag emoji is the only sign while seated.
`art/review/playtest/carry-sheet.png` (every item × pose × facing, pixel counts in red where hidden);
`art/review/playtest/pt/carry-sheet-coffee.png`.

**Why (likely).** The seated frames' hold point is in front of the torso: drawn behind the body when facing
away, and mostly covered by the arms and lap facing the camera.

**Fix.** A seated hold pose that brings the item to the side/lap (visible from behind too, the way it is
standing), or lift it to chest height when seated.

**Spec.** `carry.spec.ts` (all items/poses/facings) and `regressions.spec.ts` "#5 a coffee in hand still shows
when you sit, from every side".

### #6 · Sitting down and getting up pop instead of moving — SEAT · seen in the one clean seat-motion run

The seat agent's `seat-motion.spec.ts` (sit, re-click, shift over, move seats, stand; a second player watching,
both sampled every frame) got one clean run, in town (the rooms were skipped: a simulated coworker was on the
room's couch each time). Besides #1 and #4 it caught:

- **my view:** sat down on bench o1 straight from a walk frame, no crouch (`walk2 → sit` at 31,32);
- **the watcher's view:** a 12.1 px one-frame jump at the end of the crouch into café-terrace chair o14 —
  other people see you pop into the chair;
- **the watcher's view:** saw me standing *inside* bench o1, on its cushion tile (30,32), for 4+ frames.

`art/review/playtest/pt/seat-motion-town-*.png`. **Spec:** `seat-motion.spec.ts` (now runs per room and town;
`SEAT_MOTION_ROOMS=town` for just this). Fit note while looking: seated in the Quiet Grove's green wingback
(focus-10) the knees and feet ride over the right armrest (`standup-focus-seated.png`) — minor.

### #7 · Sometimes a sit doesn't land and you're left standing inside the seat — SEAT · intermittent

Twice in the sweep the walk to a cushion finished on the cushion's tile and no sit followed, leaving the figure
standing inside the furniture: HQ's Founders' Throne (11,1) (`seat-hq-hq-throne-0.png`, the figure hidden
inside the throne) and Launch Lab office chair launch-7 (6,3). A probe sat on the throne normally, so it's
timing-dependent — likely a refused `sit` (the cushion just taken by a simulated coworker, or the arrival check
disagreeing with the server's clock). Whatever the cause, when a sit is refused the client should step you
back off the cushion rather than leave you in it. `seats.spec.ts` flags it as "left standing inside furniture".

### #8 · The café's corner bar stool can't be clicked while chair cafe-25 is taken — LAYOUT · low

Stool cafe-15 (6,2) stands right behind bistro chair cafe-25: with the chair empty, 293 of the stool's 859
pixels already click the chair; with someone on the chair, the sitter covers the rest and clicking where the
stool is opens their card. `art/review/playtest/pt/unclickable-cafe-cafe-15-0.png` (occupied),
`stool-cafe-15-empty.png`. Move the stool one tile or the chair.

### #9 · Dev only: a demo member made just before a dev-server restart can vanish

A new tsx-watch process loads `.data/minglewood.json` before the old one has saved the new member, then
overwrites it; the session cookie then lands on the sign-in page. The harness signs in again when that happens
(`Player.boot`). Not a production issue.

<!-- COVERAGE -->

## Seating: what's right

Looked at every sitting at 1:1 and 2–4× (café, HQ, Launch Lab, Engineering Studio, Lantern Hall, Quiet Grove,
Design Lab, town benches; ~120 cushions, walking over and from behind): the seat standard's fit holds. Bar
stools, bentwood and banquet chairs, office chairs, couches, benches, wingbacks, leather and mustard armchairs
and beanbags all seat the figure on the cushion — no floating, no sinking, the backrest drawn over the back
when you face away (`seat-*.png`). Re-clicking the cushion you're on no longer moves you, and the server now
seats you on the exact cushion the client asks for (`at`). The seating bugs left are behavioural (#1, #3, #4
below), not the fit.

## Not bugs (things the harness got wrong first, so nobody chases them)

- **"Pip isn't clickable", "the Quiet Grove's fountain / oak / lighthouse are unclickable", "the piano / a
  plant used from 54 tiles away", "the arc lamp doesn't switch"** (first run): a hot reload had dropped the bot
  back in town mid-step and the step judged the town. The harness now marks the page and redoes any step the
  page was replaced under (`Player.step`).
- **Put back at the room's door** (`(0, doorY)` in a finding): the dev server restarted (someone edited
  server code) and the realtime reconnect re-entered the room at its door. Steps are now redone when the
  socket reconnects. (In production this is what every deploy does to everyone — worth knowing, not a bug.)
- **"Walking at the Design Lab's low table left me inside furniture"**: the click landed on the armchair drawn
  in front of the table, so the bot went and sat in it (correct Habbo behaviour); the spec checked a moment
  before the sit landed.
- **`TypeError: this.world?.setNotes is not a function`**: a hot update that swapped `game.ts` before
  `WorldView.ts` — only while someone is mid-edit.
- **Two runs at once sharing a bot**: one member in two tabs fights itself (reloads, lands in town). Tag a run
  (`PLAYTEST_TAG=name`) to give it its own bots, watchers and output folder.
