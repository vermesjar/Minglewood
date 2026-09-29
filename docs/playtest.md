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

## Open — ranked by what Carter would notice first

<!-- OPEN -->

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
- **#4 · The far cushion of every couch and bench seated you on the near one** (SEAT). The client picked the
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
  artifact opened its story card instead of sitting. Spec "#7 the 1,000th Customer Bench can be sat on".

## Still open from the first sweeps

### #8 · Sitting down, getting up and walking up to seats pop — SEAT · seen in the seat-motion runs

The seat agent's `seat-motion.spec.ts` (sit, re-click, shift over, move seats, stand, from the front/behind/side;
a second player watching; both sampled every frame), now run per room: the Quiet Grove and Lantern Hall came
out clean; elsewhere, besides #1/#4/#5, it caught

- **drawn over while walking up:** the couch/seat you're walking up to is drawn over your body for 2–4 frames
  (101 px at café couch cafe-30, 120 px at HQ couch hq-11) — a depth-sort pop as you step next to it;
- **no crouch:** sat down on town bench o1 straight from a walk frame (`walk2 → sit`);
- **pop into the seat for others:** the watcher saw a 12.1 px one-frame jump at the end of the crouch into
  café-terrace chair o14;
- **ghost backrest (town):** sitting facing away on a town bench or the café-terrace chair, the backrest is
  drawn over you as a translucent flat rectangle (your shirt shows through a patch that doesn't follow the
  slats), not as the slats themselves — in the rooms, back-view backrests are opaque and right
  (`seat-town-campfire-bench-s-0.png`, `seat-town-campfire-bench-e-0.png`, `seat-town-garden-bench-0.png`,
  `seat-town-o14-0.png`);
- **the Founders' Throne (HQ):** walked onto it and wasn't seated in two separate runs (`seat-hq-hq-throne-0.png`,
  the figure hidden inside the throne); sits fine in isolation, so it's #5 or a race at that seat — watch it
  once #5 is fixed.

`art/review/playtest/pt/seat-motion-town-*.png`, `art/review/playtest/pt3/seat-motion-*.png`. Fit note: in the
Quiet Grove's green wingback (focus-10) the knees and feet ride over the right armrest
(`standup-focus-seated.png`) — minor. **Spec:** `seat-motion.spec.ts` (`SEAT_MOTION_ROOMS=cafe,hq` to narrow).

### #9 · The café's corner bar stool can't be clicked while chair cafe-25 is taken — LAYOUT · low

Stool cafe-15 (6,2) stands right behind bistro chair cafe-25: with the chair empty, 293 of the stool's 859
pixels already click the chair; with someone on the chair, the sitter covers the rest and clicking where the
stool is opens their card. `art/review/playtest/pt/unclickable-cafe-cafe-15-0.png` (occupied),
`stool-cafe-15-empty.png`. Move the stool one tile or the chair.

### #10 · Dev only: a demo member made just before a dev-server restart can vanish

A new tsx-watch process loads `.data/minglewood.json` before the old one has saved the new member, then
overwrites it; the session cookie then lands on the sign-in page. The harness signs in again when that happens
(`Player.boot`). Not a production issue.

## Coverage

| Playthrough (spec) | What it does | Scope |
|---|---|---|
| Sitting (`seats.spec.ts`) | click each cushion on the cushion; check the tile, facing, re-click; then again from behind/beside | 8 rooms + town (4 parts): 126 seats, 151 cushions |
| Sitting in motion (`seat-motion.spec.ts`, seat agent) | sit, re-click, shift over, move seats, stand, from front/behind/side; a second player watches; every frame judged | per room + town |
| Using things (`interactions.spec.ts`) | click every machine, counter, lamp, bell, board, artifact; vend → carry → Put down; NPC cards; walk at every solid piece | 8 rooms: 90 things, 4 NPCs, 176 solid pieces |
| Carrying (`carry.spec.ts`) | every carryable × stand/walk/sit × 4 facings, pixels the item adds | 7 items, 112 combinations |
| Social (`social.spec.ts`) | click a person → docked card; search → card without moving; wardrobe Soft / Surprise me / Wear it; coffee visible from every side | café |
| Town (`town.spec.ts`) | walk up to every building and double-click it in; try to stand in building fronts, stoops, sides and the lake | 8 buildings; 74 blocking probes (of 258 edge tiles) + lake |
| Regressions (`regressions.spec.ts`) | one spec per bug above (open ones marked `test.fail`) | 9 specs |

Clean: every room's objects did their thing when the walk wasn't refused (HQ, Engineering, Launch Lab, Lantern
Hall, Design Lab: 0 findings); every NPC card opened; nothing let you stand in a building front, stoop or the
lake (Lantern Hall's front included); search opens the card without moving you.

## How long it takes

<!-- TIMING -->


## Seating: what's right

Looked at the sittings at 1:1 and 2–4× (all 8 rooms and the town; 151 cushions on 126 seats, walking over and
from behind): in the rooms the seat standard's fit holds. Bar
stools, bentwood and banquet chairs, office chairs, couches, benches, wingbacks, leather and mustard armchairs
and beanbags all seat the figure on the cushion — no floating, no sinking, the backrest drawn over the back
when you face away (`seat-*.png`). Re-clicking the cushion you're on no longer moves you, the server seats you
on the exact cushion the client asks for (`at`), and Stand up now stands you up (#1, fixed). The Quiet Grove and
Lantern Hall passed every cushion from both sides. What's left is mostly behaviour — #3, #4, #5, #7 — plus the
town's ghost backrest and the small pops in #8.

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
- **"Walking at the Design Lab's low table left me inside furniture"**: the click landed on the armchair drawn
  in front of the table, so the bot went and sat in it (correct Habbo behaviour); the spec checked a moment
  before the sit landed.
- **`TypeError: this.world?.setNotes is not a function`**: a hot update that swapped `game.ts` before
  `WorldView.ts` — only while someone is mid-edit.
- **Two runs at once sharing a bot**: one member in two tabs fights itself (reloads, lands in town). Tag a run
  (`PLAYTEST_TAG=name`) to give it its own bots, watchers and output folder.
