# Avatar requests (from the café / NPC work)

For the main session (avatar kit owner).

1. **Apron top** (`top.apron`): a café apron — a bib over the chest with a neck strap and waist ties, over a
   plain tee in a second colour (topColor = apron, topAccent = tee). The café's barista NPC, Juno
   (src/shared/world/interiors.ts, `cafe.npcs`), wears `top.overalls` in café green until it exists; switch her
   loadout to `top.apron` when it lands. Front and back views; it should read at 1:1 behind a counter (only the
   upper half shows).
2. **Sit pose, back view:** seen from behind, the seated legs project up and to the right past the torso, so on
   a low backrest (the green couch) a sliver of leg pokes above the back. Keeping the back-view legs within the
   torso's silhouette would fix it for every seat.
3. **A "working" pose** (optional): an NPC at a machine (tamping, pouring) — both hands forward at counter
   height. The barista currently brews in `stand` and hands the cup over in `wave`.
