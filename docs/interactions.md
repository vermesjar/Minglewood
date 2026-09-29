# Interactions: what clicking a thing does

Everything in a room should answer a click with a small moment of its own. This file audits every object in every
room and in town: what clicking it does today, and what was left alone on purpose.

## How it works

- **Assigned by what the thing is.** `src/shared/world/uses.ts` maps a drawing (`sprite`, or `sprite.variant`) to
  its interaction. There are three tables:
  - `USE_BY_SPRITE`: moments (the jukebox, the claw, the podium).
  - `VEND_BY_SPRITE`: things you take away (a book, a soda, a cup of water, an apple).
  - `NOTE_SPRITES`: boards people pin notes to (whiteboards). This is the one kind a wall piece can have.

  `giveUses(scene)` runs once per scene in `allScenes()`. Every copy of a piece behaves the same wherever it
  stands. Hand-placed actions win, and an existing `info` or `artifact` action is kept for the info stand.
- **Reachable or nothing.** After assigning, `giveUses` takes the interaction away from any piece that can't be
  walked up to from the scene's spawn. An interaction you can never reach is worse than none. `uses.test.ts` fails
  if any piece that should do something lost it this way, so a layout change that walls a piece in is caught.
- **Walk up, face it, act.** On the client, `game.ts` `onObjectClick` goes through `useObject`. It walks to the
  approach tile (`interact.ts` `approach`, which uses the object's working face when it has one), turns to face
  the object, and sends `{ t: 'use' | 'carry' | 'note', objectId }`.
- **The server decides.** `OrgHub` checks that you're standing at the thing (`standingAt`). It rate-limits one
  person (`USE_PERSON_GAP_MS`, a double click) and each object (`USE_COOLDOWN_MS` per kind, so a claw finishes
  its drop first). It turns you to face the thing and picks the outcome in `src/server/realtime/uses.ts`:
  - the song, the score and the city;
  - whether the claw wins;
  - how many balls drop on the break and whether the cue ball follows;
  - whether the hockey shot goes in, banks in or is blocked.

  Then it broadcasts a `moment` (with that `detail`) to everyone in the room, plus a chat line from you when
  there's something to say. **Quiet rooms stay quiet**: the Quiet Grove plays the moment but posts no line.
  Throttled clicks are silently ignored.
- **Everyone sees the same thing.** `WorldView.playObject` → `ObjectAnimations.trigger` plays the moment on the
  object in `animations.ts`, with table games in `tabletop.ts` and particles through `effects.ts`. What happens is
  what the server decided: the balls that drop, the goal, the prize in the claw. The person who used it holds the
  `work` pose for about a second, unless they're sitting.
- **Every rotation.** Effects never use fixed screen positions. They're placed in the drawing's own pixels
  (`MOMENT_SPOTS`, `TABLES`, which mirror with the drawing) or from its opaque bounds. So they land right whichever
  way the piece is turned. `uses.test.ts` turns every usable kind all four ways in an empty room and checks that
  it's approached from its front. The table games were filmed in all four rotations
  (`interact-pool-table-{se,ne,nw}.png`, `interact-air-hockey-{se,ne,nw}.png`).
- **Built for play scale.** Every strip was checked at zoom 2, the scale people play at. Anything 1–2 px that
  didn't read there was made bigger or bolder: outlined notes, a watering can, a boot bar, balls the size of the
  painted ones.

## What each thing does

### Moments (`use`)

| Thing | Where | Click | What everyone sees | Said |
| --- | --- | --- | --- | --- |
| Jukebox | Arcade | Put a song on | Big outlined notes pour off it for 8 s and its neon pumps to the beat | 🎵 Put on “Lakeside Lo-Fi” (made-up titles) |
| Arcade cabinets (×5) | Arcade | Play a round | The screen flashes, little invaders march, the score rises over the cabinet | 🏆 New high score: 12,340! or 🕹️ Scored 4,210 (best 12,340, Ada). Each cabinet keeps its best score while the server is up. |
| Pool table | Arcade | Break | See **Pool** below | 🎱 One down on the break / Three down — clean break! / Scratched… classic |
| Air hockey | Arcade | Take a shot | See **Air hockey** below | 🏒 Goal! / Off the wall and in! / Blocked! |
| Claw machine | Arcade | Try your luck | The marquee lights race, the claw drops, grabs and rises. On a win (about 1 in 4, decided up front) a little bear comes up in the claw, sparkles at the chute, and lands in your hands. | 🧸 Got one! / 🦾 So close… |
| Heirloom piano | Lantern Hall | Play a few bars | A run of big notes rises along the lid, left to right | none |
| Heirloom aquarium | HQ lobby | Feed the fish | Flakes land with rings on the water and drift down; the fish come up for them (6 s) | none |
| Globe stand / heirloom globe | Quiet Grove, Design Loft | Spin the globe | Its continents race round (meridians sweeping across the ball, motion arcs either side) and slow to a stop. A red pin drops and the city rises over it. | 🌍 Spun the globe — Kyoto! (not in the Quiet Grove) |
| Potted plants (×19) | Every room but the lobby | Water the plant | A teal watering can tips over the leaves and pours, the leaves shiver, green glints as it perks up | none |
| Fountain | Town square | Toss a coin | A gold coin flips through the air into the basin: a splash, rings spreading, the wish glinting up | 🪙 Made a wish |
| Grandfather clock | HQ lobby | Wind the clock | It strikes three: a ring spreads from its face for each stroke | none |
| Server rack | Engineering Studio | Turn it off and on again | The whole rack goes dark, a boot bar over it fills amber while the lights come up amber, then it goes green with an OK and the lights come back one by one | 🖥️ Turned it off and on again |
| Rocket model | Launch Lab | Count down | The rocket lifts off its pad on a flickering flame, smoke billowing out, and settles back | none |
| Podium | Lantern Hall | Raise a toast | A spotlight on the podium, confetti twice, and everyone standing nearby raises a glass (a cheer and a 🥂, a beat apart) | 🥂 To the team! / 🥂 To Northstar! (the company's name) |

The gold champion cabinet and the rocket model keep their artifact story. The piano, aquarium and heirloom globe
keep their info card. Clicking does the moment, and the info stand still shows the story.

#### Pool

The painted rack and cue ball are taken off the drawing (`tabletop.ts`). The rack is covered with felt filled in
from the clean felt around it, and the cue ball is lifted off as a piece that can move.

1. The cue ball streaks into the rack.
2. Fifteen balls fan out across the felt. They're drawn at the art's own ball size: a 5 px disc with a dark rim,
   a highlight and a shadow, solids and stripes, the 8 in the middle.
3. The balls bounce off the cushions and roll to a stop.
4. As many balls as the server said drop into pockets of their own, and on a scratch the cue ball follows one in.

After 20 s the table racks itself again: the balls fade as the painted rack fades back in.

#### Air hockey

The puck and both mallets are lifted off the drawing.

1. The near mallet strikes and the puck flies with a streak behind it.
2. The far mallet lunges. On a block it meets the puck with a spark and the puck bounces back. On a bank shot the
   puck comes off a side rail.
3. On a goal the far end lights up pink and **GOAL!** rises over it.

After 3 s the table puts itself back.

### Things you take away (`vend`, carried with `src/shared/carry.ts`)

| Thing | Where | Click | Carry |
| --- | --- | --- | --- |
| Bookshelves (×9) | Engineering Studio (3), Quiet Grove (6) | Borrow a book | 📖 Book |
| Fridge | Engineering Studio | Grab a soda | 🥤 Soda |
| Water cooler | Engineering Studio | Get a cup of water (the jug glugs) | 💧 Water (new: a clear cup of blue water in hand) |
| Fruit bowl | Engineering Studio | Grab an apple | 🍎 Apple (new: a red apple with a leaf in hand) |
| Espresso machine | Café, Eng, Launch | (already existed) | ☕ Coffee, with the brew moment |
| Vending machine | Arcade | (already existed) | 🥤 Soda |
| Popcorn cart / prize counter | Arcade | (already existed) | 🍿 Popcorn / 🧸 Plush |

### Notes on the boards (`note`)

The Engineering whiteboard (on the wall) and the pairing board (on its stand) take notes.

- **Reading and pinning.** Click a board and its notes open at once, while you walk up to it. The card
  (`NotesBoard.tsx`) shows each note in its author's sticky colour with their face and when they left it, plus a
  line to pin one. The board's info text stays at the top.
- **What the room sees.** Every note shows on the board itself as a sticky note in its author's colour
  (`noteColor`). A new one pops on as it's pinned.
- **The rules, kept by the server** (`OrgHub.note` / `unnote`):
  - You have to be standing at the board to pin a note.
  - A note is one line of at most 80 characters. Control and direction-changing characters and `< >` are
    stripped (`cleanNote`).
  - Each person can pin one note every 20 s.
  - A board holds 6 notes; the oldest comes down to make room.
  - Only the person who left a note, or an admin, can take it down.
- **Storage.** Notes are kept in the store (`OrgData.notes`, saved with the org) and come with the room when
  someone walks in (`scene.notes`).

### Already interactive before this pass (unchanged)

- **Sit:** every chair, stool, couch, armchair, bench and beanbag. These belong to the seats work.
- **Toggle:** lamps, the arc lamp, floor lanterns, the fireplace, the dragon lamp and the walnut side-table lamps.
- **Ring:** the Launch Lab bell.
- **Enter / exit:** buildings and doors.
- **Info / artifact:** the noticeboard, signpost, bulletin, elevator, dashboard, kanban, moodboard, pin-up, quiet
  sign, trophies, frames, time capsule, trophy case, lighthouse, rocket statue, big oak and plaque bench.

## Layout fixes so everything can be reached

These were walled in, so they had no interaction. They moved within their rooms' composition, and `room-map`
still reports nothing hiding the walls:

- **Engineering kitchenette:** the water cooler stood in front of the fridge. It moved to the end of the counter
  run, under the window (0,3), facing the room. The fridge (soda), cooler (water) and fruit bowl (apple) can all
  be used now.
- **Quiet Grove stacks:**
  - Wren the librarian's aisle moved one step back from the shelves (y 1 → 2), so people can reach the shelves
    behind her. She still shelves returns, facing the stacks.
  - The shelving now runs from the corner to the window, plus the one beyond it. The shelf that stood behind the
    fireside wingback is gone from there.
  - The ivy moved beside the window, with the returns pile under the window.
  - The fern moved from behind the wingback to beside it, still by the fire.

## Left alone on purpose

Each of these was looked at. A click moment would be noise, or the thing needs more than a moment.

- **Scenery and structure:** rugs, counters, desks, tables (low, round, long, side, high, cocktail, umbrella),
  the stage, the reception desk, stanchions, plinths, planters, blockers, reeds, trees, bushes, flowerbeds,
  wildflowers, garden beds, stumps, birdbaths, lamp posts, garden lanterns, blankets and picnics. You walk past
  them. A click shows nothing, which is right.
- **Things other work already owns:** the café counter, register, pastry case, cake stand, grinder and jar belong
  to the barista NPC and coffee flow.
- **Candidates for a next pass:**
  - Easels, the pin-up and the kanban as note boards (add them to `NOTE_SPRITES` and give their drawings a `board`
    quad in `MOMENT_SPOTS`).
  - Cake table and buffet: *grab a slice*, a carry item.
  - Balloons: bob when clicked.
  - Boats: they sit in water and would need a dock approach.
  - Mailbox: *post a letter*, perhaps a kudos into the Slack integration.
  - Fire ring: *light it*, a toggle plus embers.
  - Speakers: turn the music up. This waits on sound.

## Adding an interaction

1. Add the kind to `USE_KINDS` in `src/shared/world/scene.ts` and map the drawing in `USE_BY_SPRITE`
   (`src/shared/world/uses.ts`).
2. Give it a cooldown in `USE_COOLDOWN_MS`. If it says something or has an outcome, add it to `outcomeOf`
   (`src/server/realtime/uses.ts`) and pass the outcome in `detail` so every screen plays the same thing.
3. Draw the moment in `animations.ts`:
   - `startUse` for what flies out.
   - `drawUse`, `drawSprite` or `offset` for what the object itself does.
   - `MOMENT_SPOTS` for where on the drawing it happens (drawing px, unmirrored).
   - Or `tabletop.ts` for a game played on a surface.
4. Film it at play scale in the furniture lab:
   `window.flab.film(scene, id, { zoom: 2, before: (v) => v.playObject(id, kind, undefined, detail), name: 'interact-<sprite>' })`.
   Look at every frame. If something doesn't read at zoom 2, make it bigger.
5. `uses.test.ts` picks the new kind up in the four-rotation and reachability tests automatically.

**Placed decorations:** when room building places a piece, pass it through `withUseActions(o)` so a
user-placed jukebox plays just like the arcade's.

Film strips: `art/review/interact-*.png`.
