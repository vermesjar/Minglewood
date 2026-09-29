# Playtest

Automated playthroughs of the real app in headless Chromium (`npm run playtest`, Playwright, specs in
`tests/e2e/`). Each worker plays as its own demo member ("Playtest Bot N") and does what a player does:
clicks on what it sees (a pixel of the sprite that the game's own hit test resolves to that thing), walks,
waits to arrive, and checks the result against the live game state (`window.__mw`). Screenshots at 1:1 play
zoom land in `art/review/playtest/`, a tagged run's in `art/review/playtest/<tag>/` (`PLAYTEST_TAG=pt5` →
`pt5/`). `PLAYTEST_URL=http://localhost:5190` plays the no-HMR review server.

Every bug below was reproduced more than once (or says it wasn't) and checked in the screenshots, not just the
asserted state. Bugs that reproduce on demand get a spec in `tests/e2e/regressions.spec.ts`: marked `test.fail`
while open (it passes while the bug is there and turns red once it's fixed — then delete the `fail(OPEN, …)`
line), a plain test once fixed, guarding the fix. `PLAYTEST_SHOW_OPEN=1 npx playwright test regressions` runs the
open ones as plain tests, to watch each fail. All 10 current specs pass on :5190: #1–#7 guard their fixes, #11 is
a guard for an intermittent bug.

## Open — ranked by what Carter would notice first

From the fresh sweep on the no-HMR server (`PLAYTEST_URL=http://localhost:5190 PLAYTEST_TAG=pt5`, 4 workers, all
rooms and the town), each checked in the 1:1 screenshots. Paths are under `art/review/playtest/pt5/` unless given in full.

### #11 · Clicking the cushion you're sitting on slides you to the other cushion — SEAT · intermittent, under load

What Carter meant by "if you're sitting and you click to sit again it throws you around". Seated on the far
cushion of a two-seater, a click on your own cushion slid you across to the other one: 13 times in the sweep,
on HQ's blue couch (hq-13), the Engineering meeting sofa, the Design Lab sofa, and the town's plaque bench,
garden bench and campfire benches S and E (from the front and from behind). On a Design Lab stool (design-12) the
same re-click stood the bot up. Before → after: `seat-town-campfire-bench-s-1.png` →
`reclick-town-campfire-bench-s-1.png`; `reclick-hq-hq-13-1.png`, `reclick-design-design-sofa-1.png`,
`seat-design-design-12-0-behind.png` → `reclick-design-design-12-0-behind.png`.
It happened after shifting over from the other cushion, with four players on the server; alone (5 tries: HQ, Design
Lab, town campfire benches; standing start and after a shift-over) the re-click stayed put. So it's likely the
re-click landing while the shift-over is still settling (or before the store has the new cushion):
`cushionAt(…, onThisSeat)` then judges against the old cushion. **Spec:** `regressions.spec.ts` "#11 clicking
your own cushion on a couch or bench never moves you" (a guard; it doesn't reproduce alone yet).

### #12 · The far cushion still seats you on the near one on two couches — SEAT · every time on those two

The screen-space cushion pick (#4) fixed every town bench and most couches, but walking over to the far cushion
of the **café's green couch** (cafe-30) and the **Design Lab's sofa** still sat the bot on the near one, from the
front and from behind (`seat-cafe-cafe-30-1.png`, `seat-design-design-sofa-1.png`). Same couch sprite as the
Engineering lounge sofa, which works — the two that fail face ne and se, the one that works faces sw. **Spec:**
"#4 …" tries the first free two-seaters (HQ's, which are right); point it at cafe-30 to guard this.

### #13 · Other players see you jump a whole cushion when you shift over — SEAT · every shift on a lounge couch

In the seat-motion runs a second player watched: shifting over on the Design Lab sofa and the Engineering meeting
sofa, the watcher saw the figure jump 29.7 px and 21.4 px in one frame (`sit-lounge → sit-lounge`) — a teleport
to the next cushion; on your own screen it slides. Also: walking up to the Launch Lab couch, the couch was drawn
over your body for 1–2 frames (121 px in your view, 98 px in the watcher's) — a depth-sort pop as you step next
to it. **Spec:** `seat-motion.spec.ts`.

### #14 · Some chairs ignore the click — no walk, no "can't get there" — SEAT · specific chairs

- Lantern Hall banquet chair **events-8**: seat-motion couldn't sit on it from the front, behind or side;
  **events-23** (walking over) and **events-12** (from behind) didn't seat the bot either
  (`seat-events-events-23-0.png`: standing in the aisle between the rows);
- desk chairs from behind the desk: **eng-11** (from 6,1), **launch-8** (from 5,8) — the bot stays where it is
  (`seat-eng-eng-11-0-behind.png`);
- seated in Launch Lab desk chair **launch-7**, clicking **launch-8** across the desk sent nothing at all (2 of 2:
  the sweep, `seat-launch-launch-8-0.png`, and a probe on the wire) — from a standing start the same click walks
  and sits.

Whatever the cause (no path found from where you are, or the click dropped), a seat click that can't be done
should say so; silently doing nothing reads as broken.

### #15 · Once, left standing inside a workbench stool — SEAT · seen once

Walking at the Launch Lab's parts rack (after the step before had sat the bot on workbench stool launch-stool-2),
the bot ended up standing on the stool's tile (3,2), not seated, the server agreeing (`inside-launch-launch-parts.png`).
Sitting on and standing up from that stool works in isolation (steps off to 3,3). Likely a refused sit that
`offUnconfirmedSeat` didn't walk off. Watch for it.

### #9 · The café's corner bar stool can't be clicked while chair cafe-25 is taken — LAYOUT · low

Stool cafe-15 (6,2) stands right behind bistro chair cafe-25: with the chair empty, 293 of the stool's 859
pixels already click the chair; with someone on the chair, the sitter covers the rest and clicking where the
stool is opens their card. `art/review/playtest/pt/unclickable-cafe-cafe-15-0.png` (occupied),
`stool-cafe-15-empty.png`. Move the stool one tile or the chair.

### #16 · The Design Lab's snake plant can't be clicked — LAYOUT · low

design-snake (0,1) is completely hidden behind the bookshelf by the door: nothing on screen resolves to it, so its
"Water the plant" can't be reached (`unclickable-design-design-snake.png`). Move it or drop its action.

### #10 · Dev only: a demo member made just before a dev-server restart can vanish

A new tsx-watch process loads `.data/minglewood.json` before the old one has saved the new member, then
overwrites it; the session cookie then lands on the sign-in page. The harness signs in again when that happens
(`Player.boot`). Not a production issue.

## Fixed during this session (each verified on the no-HMR server, :5190, and guarded by a spec)

Owner key: **SEAT** = seat agent · **ENGINE** = main session (WorldView loop, effects) · **CHAR** = character-life
agent · **LAYOUT** = interiors/critic · **HUD** = main session. Specs are in `tests/e2e/regressions.spec.ts`;
all of them now pass as plain tests (no `fail` marker) and guard the fix.

- **#1 · "Stand up" left you sitting in mid-air beside the seat** (SEAT/protocol). The server's
  `{ sittingOn: undefined, x, y }` arrived as `{"x":10,"y":1}` — JSON drops `undefined` — so view and store
  kept `sittingOn` and the figure slid, still seated, onto the floor tile beside the chair
  (`art/review/playtest/pt/standup-focus-seated.png` → `standup-focus-after-stand-up.png`). Fix: patches carry
  cleared fields as `null` (`toWirePatch`/`fromWirePatch`). Spec "#1 Stand up stands you up".
- **#2 · The world could stop for good** (ENGINE). A first rAF stamp earlier than `WorldView.last` gave a
  negative frame step → negative effects clock → the lake glints indexed `water[negative % n]` → a throw in
  `Effects.drawUnder`, and `frame()` only re-armed rAF after a clean frame, so one throw froze everything (the
  iris never finished; `art/review/playtest/run1/frozen-entering-*.png`). Specs "#2 …" (two; they pin the rAF
  clock 4 s behind). The harness workaround is gone.
- **#3 · Get up from a seat and you couldn't sit on it again; Stand up stayed on the bar** (SEAT/HUD). The
  store never cleared `sittingOn` on `moved`, so clicks took the "already sitting here" branch and other
  people's vacated seats counted as taken. Spec "#3 walking off a seat and clicking it again sits you back down".
- **#4 · The far cushion of every couch and bench seated you on the near one** (SEAT) — *fixed for every bench and
  most couches; still wrong on the two green chesterfields, see #12*. The client picked the
  cushion nearest the click projected onto the *floor*; for the far cushion only 36–63% of its own pixels
  picked it (town benches 36–52%). Every two-seater in the game had it, all 16 town benches included ("benches
  only seat one"; `art/review/playtest/pt/seat-hq-hq-13-1.png`, `probe-bench-o1-*.png`; on the wire, clicking
  cushion (30,33) sent `"at":[30,32]`). Fix: `cushionAt` in screen space. Spec "#4 …".
- **#5 · Walks were refused when a message was ~0.3 s late — you snapped back, couldn't sit, got nothing**
  (protocol). `OrgHub.move` extrapolated the path to "now" from the client's stamp and allowed 1.6 tiles
  (~0.38 s at 4.2 tiles/s), while the client's clock offset came from one `welcome` and ignored transit time
  (measured −314/−383 ms on the same machine under load): walks stamped 300 ms+ before the server handled them
  were refused (150 ms accepted). In the busy sweep HQ seated 0 of 10 cushions and the café 1 of 12; the arcade
  machines and the Grove bookshelf handed nothing over. Worse before the resync fix: the refusal's
  `path: undefined` was lost too, so your screen kept walking and you "arrived" inside the seat while everyone
  else saw you at the door. Fix: the server judges a walk where it began at its own stamp (unit test in
  `orgHub.test.ts`), and the resync's cleared path arrives. Specs "#5 a refused walk puts you back…" and "#5 a
  walk that reaches the server 450 ms after it was stamped is still accepted".
- **#6 · What you carried vanished when you sat** (CHAR). Seated facing away 0 px of the coffee/soda/book showed,
  facing the camera 8–13 px. Now held at the chest (front) or by the shoulder (back): 0 of 112 item × pose ×
  facing combinations hidden (`art/review/playtest/pt5/carry-sheet.png`; before: `art/review/playtest/carry-sheet.png`).
  Specs `carry.spec.ts`, "#6 …".
- **#7 · The 1,000th Customer Bench couldn't be sat on** (SEAT/INTERACTIONS). A seat that's also a memory
  artifact opened its story card instead of sitting; now you sit and the story shows alongside. Spec "#7 the
  1,000th Customer Bench can be sat on".
- **Ghost backrest on town benches** (SEAT). Seated facing away on a town bench or terrace chair, the backrest was
  a translucent flat patch over you; now the slats draw solid (`seat-town-campfire-bench-s-0.png`,
  `seat-town-o14-0.png`; before: `art/review/playtest/pt/seat-town-campfire-bench-s-0.png`).

## Coverage

| Playthrough (spec) | What it does | Scope |
|---|---|---|
| Sitting (`seats.spec.ts`) | click each cushion on the cushion; check the tile, facing, re-click; then again from behind/beside | 8 rooms + town (4 parts): 126 seats, 151 cushions |
| Sitting in motion (`seat-motion.spec.ts`, seat agent) | sit, re-click, shift over, move seats, stand, from front/behind/side; a second player watches; every frame judged | per room + town |
| Using things (`interactions.spec.ts`) | click every machine, counter, lamp, bell, board, artifact; vend → carry → Put down; NPC cards; walk at every solid piece | 8 rooms: 90 things, 4 NPCs, 176 solid pieces |
| Carrying (`carry.spec.ts`) | every carryable × stand/walk/sit × 4 facings, pixels the item adds | 7 items, 112 combinations |
| Social (`social.spec.ts`) | click a person → docked card; search → card without moving; wardrobe Soft / Surprise me / Wear it; coffee visible from every side | café |
| Town (`town.spec.ts`) | walk up to every building and double-click it in; try to stand in building fronts, stoops, sides and the lake | 8 buildings; 74 blocking probes (of 258 edge tiles) + lake |
| Regressions (`regressions.spec.ts`) | one spec per bug; the fixed ones now guard their fix | 10 specs |

Clean in the fresh sweep: every machine, counter, lamp, bell, board and artifact in all 8 rooms did its thing, and
everything you're handed shows in your hand and puts down (0 findings in 6 rooms; one hidden plant, one stool
case); every NPC card opened; all 8 buildings walked up to and entered by double-click; none of the 74 blocking
probes let you stand in a building front, stoop or the lake; search opens the card without moving you; the
wardrobe's Soft body / Surprise me / Wear it changes you.

## How long it takes

On the no-HMR server (:5190), 4 workers, one machine: **the whole suite takes 56 minutes** (57 tests, 3,379 s),
including the seat agent's `seat-film` and `seat-motion`. The long pole is the per-cushion seat sweep: the Design Lab
16 min, the arcade 12 min, HQ/Engineering/Launch Lab ~7 min each, each town part 5–9 min; the room "use
everything" runs take 5–8 min each. Regressions + carry take **3 minutes** (178 s, 11 tests,
3 workers). One of the #2 specs failed once in 8 runs under that load (artifacts lost; 7 re-runs clean) —
watch it.

**Gate:** not the full suite — too slow, and it needs a running server. For `scripts/gate.sh`, run
`npx playwright test regressions carry` against :5190 (~3 min); run the full sweep nightly or before a release
(`PLAYTEST_URL=http://localhost:5190 PLAYTEST_TAG=nightly npm run playtest`). Runs against :5173 get hot-reloaded
by anyone saving a file; the harness redoes steps a reload lands on, but :5190 is the reliable target.

## Seating: what's right

The fresh sweep sat on every cushion in the game, walking over and again from behind: **124 of 151 cushions sat
walking over (24 skipped: a simulated coworker was on them), 7 failures** — down from 30+ per room in the first
sweeps. The Quiet Grove, the town benches (all 32 cushions) and the Design Lab's chairs were clean, and so was the
cushion you ask for on every bench. In the 1:1 and 4× shots the fit holds everywhere: no floating, no sinking,
backrests drawn solid over a seated back (town benches included, now), what you carry visible seated from every
side. Stand up steps you off onto the floor, walking off a seat and back onto it works, and seat-motion saw clean
sit/shift/stand runs (no jumps, crouch every time) in the café, HQ, the Quiet Grove and the arcade. What's left is
#11–#15 above.

## Not bugs (things the harness got wrong first, so nobody chases them)

- **"Pip isn't clickable", "the Quiet Grove's fountain / oak / lighthouse are unclickable", "the piano / a
  plant used from 54 tiles away", "the arc lamp doesn't switch"** (first run): a hot reload had dropped the bot
  back in town mid-step and the step judged the town. The harness now marks the page and redoes any step the
  page was replaced under (`Player.step`).
- **Put back at the room's door** (`(0, doorY)` in a first-sweep finding): the dev server restarted (someone
  edited server code) and the realtime reconnect re-entered the room at its door. Steps are now redone when the
  socket reconnects. (In production every deploy does this to everyone — worth knowing.) Since the #1/#5
  resync fix, a finding at the door usually means #5: the walk was refused and you snapped back.
- **Town: "re-clicking my own seat moved me" on every town seat, "no clickable pixel", "couldn't walk to the
  door"** (first sweep): the town camera follows you, so a click point taken before you sat was somewhere else
  afterwards; far seats and doors were off screen; and a door tile is under its building's sprite (a click
  there selects the building). The specs now take fresh points, walk towards things first, and go in by
  double-clicking the building from in front of its door.
- **"The profile card isn't docked bottom-right"**: it is — bottom-right of the play area, beside the room
  panel (`art/review/playtest/pt2/card-person.png`); the check was too strict.
- **Wardrobe test timing out**: the wardrobe's sections became tabs (`role="tab"`); the spec follows.
- **"The search card has no Go to button"**: Grace was in the same room as the bot, and the Join/Go to button
  only shows for someone elsewhere. The spec now searches from the Quiet Grove.
- **Probes on :5190 that "did nothing"**: the welcome card covers the canvas for a member without the
  `mw.welcomed.<id>` flag for that origin (a sign-in made on :5173). A run's bots get the flag for the server they sign in on;
  a probe reusing a :5173 sign-in on :5190 needs it copied over.
- **"Walking at the Design Lab's low table left me inside furniture"**: the click landed on the armchair drawn
  in front of the table, so the bot went and sat in it (correct Habbo behaviour); the spec checked a moment
  before the sit landed.
- **`TypeError: this.world?.setNotes is not a function`**: a hot update that swapped `game.ts` before
  `WorldView.ts` — only while someone is mid-edit.
- **Two runs at once sharing a bot**: one member in two tabs fights itself (reloads, lands in town). Tag a run
  (`PLAYTEST_TAG=name`) to give it its own bots, watchers and output folder.
