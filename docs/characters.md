# Characters: the standard, the pipeline, the gate

Every avatar is **one fixed template with parts layered on as add-ons**, the way classic social-game figure
systems work. Nothing about a part is positioned by hand; everything conforms to the template and is proven
by an automated gate.

## The template (frame)

`src/client/engine/sprites/avatarFrame.ts` — one skeleton per view (`front` = 3/4 facing se, `back` = 3/4
facing ne; sw/nw are mirrors) and pose (`stand`, `walk1`, `walk2`, `sit`, `wave`, `work`). It defines the head
box, the face anchors (eyes, brows, nose, mouth — mid-head, close-set, turned toward the facing), collar,
shoulders, waist, hips, and the arm and leg limbs. Canvas 88×112 art px; feet at (45, 104).

### Body bases

`body: 'body.a' | 'body.b'` picks the frame's torso: **a** straight (squarer shoulders), **b** soft (narrower
shoulders, a defined waist; the arms hang closer). The head, face anchors and legs are shared. Generated tops
are drawn once, on base A, and **mesh-warped** onto other bases (`warpToTorso` in avatarKit.ts): each row of
the garment is remapped from A's torso outline to the target's, so pockets, plackets and prints stay put.
Limbs, legs, shoes and lower garments hang off the frame, so they follow automatically. A new base is a new
torso outline (and arm offsets) in `avatarFrame.ts` plus a catalogue entry; the gate covers it.

## The standard

`src/client/engine/sprites/avatarQa.ts` — zones every part is checked against, per view and pose:

| zone | rule |
| --- | --- |
| scalp | covered by any hairstyle (or a hat that hides hair); behind, the whole back of the skull down to the nape hairline |
| features | eyes and mouth: nothing but eyewear on top |
| head region | no see-through pockets (a waving arm or held item may frame real open air) |
| chest | covered by every top |
| waist | never see-through between top and bottoms |
| feet | shoes, not skin / trouser (hair or a held thing may hide them) |
| — | no detached specks |

The kit records which **layer** painted every pixel (`Pix.owner`, `LAYER` in `avatarKit.ts`), so checks are
exact ("is a scalp pixel still painted by the bare head?"), not colour guesses.

## Layers and rules (avatarKit.ts `drawAvatarV2`)

pet → wheelchair (back) → hair behind the body → far arm → (held item from behind) → legs / lower garment →
shoes → torso → head → neckwear → face → hair → hat → eyewear → accessory → near arm → wheelchair (front) →
held item → cane → pocket sealing → outline → pinhole sealing.

- **Crown hats hide hair above them** (caps, beanies, bucket, cowboy, beret); hair-top accessories don't.
- **Long hair** falls behind the shoulders as its own layer in the front view.
- **Coats** open at the front over trousers; dresses and skirts hide them; hems follow the legs in every pose.
- Held balloons and umbrellas float clear of the head; from behind, held things hide behind the body.
- Enclosed see-through pockets framed by hair/hats are sealed with the part's shadow tone at draw time.
- **Hats that hide the hair** (hijab, turban) wrap the whole back of the head down to the nape, lit like the
  head; a hijab (`coversEars`) hides the ear too.

## Hair from behind (avatarHair.ts `formBackHair`)

Seen from behind — what other players see most, since people sit facing away — every back-view hair map goes
through one form pass, so every style, colour, body, pose and hat gets the same treatment:

- **The mass** is the style's silhouette, cleaned (strays, threads, pinholes) and always covering the back of
  the skull to the nape hairline (`NAPE`): skin shows only at the neck and the ear. Styles whose structure *is*
  their silhouette are constructed from the head box instead (`HAIR_FORM[id].build`): ponytail, pigtails, bun,
  space buns (ties with a tail or a bun), braids and locs (a curtain of ropes), mohawk (the crest kept, the sides
  clipped to a scalp tint).
- **The light**: one volume lit from the upper left, a sheen band across the upper back of the head, the far
  side and the nape in shade. Under a crown hat the hair below the brim is in its shadow.
- **The texture** (`HAIR_FORM[id].texture`): straight locks fan from the crown, light streaks run down their
  crests and shade creases rise from the ends, which part in notches; wavy locks swing, with lit wave crests;
  curls are scattered lit crescents; braids are plaited beads; locs are rounded segments; gathered hair runs to
  its tie; clipped hair (buzz) fades to a scalp tint at the nape.
- **Tones are relative** (`hairTones` in avatarKit.ts): the ramp is built from the player's colour so every step
  reads on pale blonde and on near-black alike. Two-tone highlights land on the ends (a tail, a bun, the lower
  lengths) and keep the hair's shading.

Review the back views with the sheet, every style at play scale and 3×: `art/review/hair-back-after.png`.

## Parts from image generation (art/)

`uv run charkit.py <hair|hat|top|pet> <name> --view front|back --prompt "…"` (or the batches:
`hair_batch.py`, `parts_batch.py`, `regen_batch.py` for hand-written prompts). Each job is a masked
gpt-image edit on the template figure, then:

1. **register** the raw back onto the template body (the model often redraws the figure scaled/shifted);
2. **extract** the part — hats and pets are chroma-keyed (drawn in solid teal / gold), hair by difference
   from the bare template;
3. **conform** it to the standard — hair is fitted to cover the scalp and clear the face; a hat's back view is
   sized to its own front; pets are shrunk to shin height and put on the pet anchor;
4. **tone map** it (`#` base, `h` light, `s` shade, `d` deep, `l` line) so the kit can tint it any colour;
5. **publish** a placed map `{x, y, rows}` into `src/client/engine/sprites/<kind>Lib.json`.

`uv run charkit.py extract [filter]` re-runs steps 1–5 on every raw already generated (no API calls).
`art/facekit.py` does the same for faces (generated faces are kept behind flags; the simple hand faces read
better at 1:1). Templates for generation: `npx tsx scripts/export-refs.ts`.

## The gate — run these before shipping any character change

```
npm run avatars:review   # every character (roster + saved members + 200 random looks) × 4 facings × 6 poses,
                         # plus per-asset galleries in art/review/assets/ and art/review/characters/report.md
npm run avatars:sweep    # pairwise: every value of each colliding slot pair (incl. × body), every facing and pose (~31k frames)
sh scripts/gate.sh       # all of the above plus typecheck and lint, stopping at the first failure
npm test                 # includes the roster + random gate and proofs that each rule fires
```

Close-ups of a finding: `npx tsx scripts/avatar-defects.ts "<name>:<facing>:<pose>" …` → `art/review/defects.png`
(enclosed pockets marked magenta).

## Adding a new item

1. Add it to the catalogue in `src/shared/avatar.ts`.
2. Generate it (front + back) with `charkit.py` / `regen_batch.py`, describing what's actually visible from
   behind for back views (the model otherwise copies front details onto the back).
3. `npm run avatars:review` and `npm run avatars:sweep` must stay clean; look at its row in
   `art/review/assets/<slot>.png` at play scale (1 art px = 1 screen px) before calling it done.
