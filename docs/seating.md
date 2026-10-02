# Automatic seating

The working tree was restored to PR #2 (`165e1d7e7cc38f22079831012be0ed1edeb23f5d`) before this change.
The original PNG artwork is preserved. The previous branch tip is saved as
`backup/seating-before-restore-20260930`.

## Authoring contract

A Design Lab user chooses a seating type and describes its appearance. Presets supply the physical defaults.
The compiler fits a single model against every resolved drawing, places a sitter on each cushion, checks body
clearance and leg geometry, and caches the result with a fingerprint of the drawings and declaration. It runs
in a browser worker for the preview and on the server before publication. No manual points, masks, or view nudges
are required or exposed for seating. A failed drawing cannot be published as a working seat.

| Type | Shapes covered |
| --- | --- |
| Chair | Dining, office, bistro, banquet; optional arms and back |
| Armchair | Upholstered tub, wingback, lounge chair |
| Couch | Sofa, loveseat; one row of 2–4 cushions |
| Bench | Park bench, banquette, upholstered backless bench; 2–4 places |
| Stool | Bar/drafting stool, pedestal, splayed legs, casters; reachable footrests |
| Ottoman | Footstool or pouf used as a seat |
| Beanbag | Soft seat with a raised wrap and low sitting pose |
| Floor cushion | Low, backless meditation pillow |
| Throne | High-backed upright seat |

The catalog has examples of eight families. Floor cushions have an authoring preset and construction template;
there is no existing floor-cushion artwork in PR #2. Recliners, chaises, hammocks, suspended seating, corner
sectionals, and multiple rows require additional poses or topology. A 2×2 declaration is rejected rather than
silently treated as a four-person couch. These limits are explicit; arbitrary generated artwork is not guaranteed
to fit or look good.

## Rendering

The pelvis stays at the same physical point through every rotation. Both thighs, shins, and shoes exist in rear
views as well as front views. A sitter's individual sprite is masked against the original furniture pixels using
the fitted structure and limb heights. The furniture is not repainted over all occupants after each figure.
Entry and exit use the same per-figure treatment, including the crouch and stepping poses. Cushion picking uses the
visible figure. Clicking beside your own sitter preserves your cushion; clicks beyond the neighboring cushion's
centre can still select that cushion.

## Reproducing the audit

```powershell
npm run seats:compile
npm run seats:check
npm run seats:audit -- --url http://localhost:5195
art/.venv/Scripts/python.exe scripts/seat-lab-check.py
$env:PLAYTEST_URL='http://localhost:5195'
$env:PLAYTEST_TAG='seating-review'
node --no-maglev node_modules/@playwright/test/cli.js test seat-models seat-queue --workers 2
node --no-maglev --import tsx scripts/seat-motion-review.ts
```

`seat-audit.ts` records every catalog seat in four directions, with three outfits (short hair, long hair,
bulky coat and hat), each cushion occupied alone and every cushion occupied, at normal and enlarged scale.
For this catalog that is 35 sheets / 840 captures. This finite matrix does not claim to enumerate every wardrobe
combination. The avatar QA suite separately checks the roster and randomized looks across poses and facings.

Evidence from this implementation lives in ignored review output:

- `art/review/seating-audit-verified`: the 35 static sheets, coverage JSON, and HTML index.
- `art/review/seating-audit-stools`: taller captures of the three stools, keeping hats fully in frame.
- `art/review/models-live`: live sitting, cushion shifting, and standing captures for each facing.
- `art/review/seating-motion`: compact film strips retaining each captured transition frame.
- `art/review/designlab-seating/report.json`: eight original families compiled from renamed drawings with no saved rig.
- `art/review/designlab-browser`: the real worker-generated preview and browser error report.

The personal visual review checks contact with the cushion, knees and feet, back/arm overlap, neighboring occupants,
hair and hat visibility, and entry/exit frames. Geometry checks alone are insufficient: the review caught armrests
inside the torso, frames rising through cushions, and a transient shoe showing through soft upholstery. Those are
addressed by general constraints and composition rules rather than per-asset adjustments.

## Verification record (2026-09-30)

- 185 unit tests across 25 files passed, including avatar QA and renamed-asset compilation.
- TypeScript, ESLint, Python compilation, and the production build passed.
- All 23 catalog models passed geometry checks in all four directions.
- Live catalog runs covered every seat, direction, and cushion. The teal bench's click-boundary failure was fixed and its four directions rerun successfully.
- All room seating sweeps passed, including the final engineering run with 26 cushions approached from both sides. The arrival helper now waits for queued paths as well as the moving flag.
- All nine seating queue and observer regressions passed; the new body-facing regression also passed.
- The actual new-draft form saved beanbag, floor-cushion, and four-person couch presets correctly.
- Design Lab compiled renamed original artwork from all eight existing families without a saved model. The real browser worker saved a new model and rendered four occupied previews with no browser errors or rigging inputs.
- I personally inspected all 35 static sheets (840 captures), the three reframed stool sheets, and all 23 four-direction motion sheets. The cafe chair motion was recaptured and inspected after fixing idle turns during entry.

The motion review index is `art/review/seating-motion/index.html`. This is a finite catalog audit; floor-cushion generation and the unsupported shapes listed above have no catalog artwork to visually certify yet.

## Follow-up: pelvis and open-back occlusion (2026-09-30)

The preceding visual audit missed clipping subsequently reported in the NW bistro chair and green/yellow chairs.
The lower-body depth calculation confused overlapping projected shins with pelvis pixels. Pelvis ownership is now
explicit and tested against supporting cushions across the catalog. Support pixels also obey body height, and
extrapolated furniture depths stay within their physical part bounds. For open chair backs, distinct cushion
material visible through an opening is classified from the drawing instead of inheriting the coarse backrest box.
Painted rails and source alpha remain intact; no source artwork was changed.

- 188 unit tests across 26 files passed, including three new occlusion regressions.
- TypeScript, ESLint, and production build passed.
- Repeated all 35 static sheets / 840 captures in `art/review/seating-pelvis-final` and personally inspected each sheet.
- Recaptured and personally inspected all four directions of live entry/exit for bistro, cafe, wood, green armchair,
  and mustard armchair; all five live tests passed. Updated films are in `art/review/seating-motion`.
- This review covers the three documented outfits, not every possible wardrobe combination.
- Port 5195 has hot reload disabled: reload the page to load the corrected renderer.

## Follow-up: cushion wells and foreground arms (2026-09-30)

The user's bistro screenshots exposed two remaining causes: the hip contact was too close to a rigid back,
and the coarse backrest box claimed the visible cushion inside a curved back. Compiler version 2 leaves
pelvis clearance ahead of rigid backs; soft wrap-only seats retain their deeper contact. Rear-view horizontal
back caps intersecting a seat top use the supporting surface, while vertical back faces still hide the body.
Depth extrapolation now preserves face identity as well as part identity.

Foreground arms now cover every overlapping body region below their height, including hips and legs.
This is shared by benches, office chairs, armchairs, and newly compiled armed seats; it has no asset-name exceptions.
Source PNGs remain identical to PR #2.

Validation:
- 190 unit tests across 26 files passed; all nine compiler/occlusion tests passed again after the soft-seat adjustment.
- TypeScript, ESLint, and production build passed.
- All 23 regenerated models passed geometry checks.
- Personally reviewed all 35 sheets / 840 captures in `art/review/seating-contact-final`, with the four final beanbag sheets refreshed from `seating-contact-soft-final`.
- Five live tests passed: green couch, mustard armchair, outdoor bench, teal garden bench, and office chair. Personally reviewed their refreshed four-direction motion sequences.
- Reproduced both cafe couch cushions and both mustard chairs using the reported outfit, then personally reviewed all four corrected room screenshots in `art/review/playtest/bistro-pan-verified`.
- Added regressions for visible rear-view pelvis contact and foreground arm coverage across the catalog.

This remains a finite catalog and outfit audit, not certification of arbitrary generated artwork. Reload port 5195 to load the renderer changes.

## Pixel-level in-game verification (work in progress)

The earlier broad catalog checks did not prove pixel correctness. The latest user report remains open.
`tests/e2e/seat-pixels.spec.ts` captures live room actors, including an existing occupant without moving them,
and records the exact masked sprite used by WorldView, original furniture RGBA, avatar RGBA/ownership,
surface ownership/depth, model, pose, outfit, cushion, and a real room screenshot. It checks the intended
cushion and exact equality between diagnostic masking and the live sprite. This is capture integrity only.

Run against a live dev server:

```powershell
$env:PLAYTEST_URL='http://localhost:5195'
$env:PLAYTEST_TAG='pixel-review'
node --no-maglev node_modules/@playwright/test/cli.js test seat-pixels --workers 1 --retries 0
node --no-maglev --import tsx scripts/seat-pixel-review.ts
node --no-maglev --import tsx scripts/seat-pixel-check.ts art/review/playtest/pixel-review/pixels tests/fixtures/seating-expected-pixels.json
```

The portable inspector is `art/review/playtest/pixel-review/pixels/index.html`. Its four synchronized panels
show original art, actual masked sprite, surface assignments, and overlap ownership. Hover exposes exact
pixel coordinates and values; clicks export independently judged winner expectations. The checker has no
update-baseline mode. Missing captures, changed source, missing overlaps, and wrong winners fail.
Annotations cover only the named pixels, never imply whole-seat approval, and must be extended as review proceeds.

Current evidence: 20 sitters captured in three passing capture-integrity tests, using the reported cardigan
outfit. The inspector loads without browser errors. Two independently inspected expectations FAIL:
`cafe-30/ne/0` at (49,20), and `cafe-32/nw/0` at (33,17). These are the couch/chair edge defects still to fix.
The green couch's left arm and full outdoor bench boundaries also remain unapproved. Bistro chairs are a
user-reported good control and must be included before accepting future renderer changes.

The bench investigation found missing arm declarations, which meant the previous arm test skipped them.
The three armed bench declarations and models now include both arms. A dedicated test checks this structural
requirement. Do not interpret geometry success as approval of their pixel boundaries.

Build/publish changes: `npm run build` now requires current drawing/declaration/compiler fingerprints plus
occlusion tests. All three studio publishing commands invoke the shared compiler before publishing seat
artwork. Build validation passed; Python syntax passed; publication integration/failure-path testing remains pending.

Next acceptance work: correct or regenerate problematic artwork with explicit surface boundaries, expand
independent labels over every affected edge, rerun room captures and transitions, and review every catalog
orientation/cushion/outfit. Until then, no claim of pixel-perfect seating or final visual approval is justified.

## Edge/fringe and far-arm correction (2026-09-30)

The first two independent pixel failures were horizontal back-cap assignments just outside fitted cushion bounds.
Their projected misses were less than two drawing pixels. Back-cap classification now recognizes that bounded
cushion fringe at cushion height, without extending vertical back faces. The third failure was a far arm treated
as foreground merely because the chair faced away. Arm ordering now follows the camera-facing side in every
orientation; the far arm stays behind the figure, including its hips and sleeve.

- Seven real-game evidence capture tests passed; 46 sitters captured with the reported outfit, including cafe,
  all four orientations of the two outdoor benches, green couch, mustard chair, bistro chair, and office chair.
- The original two failing pixels and the added far-arm sleeve pixel now pass against fresh captures.
- A fourth independent point preserves foreground overlap of the near cast-iron bench arm.
- Those four expectations and the actual game context are now `seatPixels.test.ts`, required by `npm run build`.
- Ten compiler/occlusion tests passed, TypeScript and ESLint passed; four publication failure-path tests passed.
- The armless navy bench explicitly declares `arms: false`; only the two outdoor benches require arm pairs.
- The fresh inspector is `art/review/playtest/pixel-edge-arm-fixed/pixels/index.html`.

The broader static sweep captured 840 images in `seating-edge-arm-final`. Only the affected models and controls
have been re-reviewed so far; the navy bench's final armless model postdates that sweep. Do not count this as
complete independent per-pixel certification of the catalog. New artwork candidates also remain unpublished.

Fresh green couch and mustard chair turnarounds were generated with the built-in image tool using the originals
as visual references, saved in `art/review/regenerated-seating`. The existing studio slice/pixelize commands
produced sprites, and the shared compiler passed both candidates without manual model offsets. Their compiled
preview sheets have been inspected; actual in-game candidate review and publication are still pending.

## Adversarial pixel audit and surface identity (2026-09-30, in progress)

The earlier four-point success was insufficient. Independent reviewers found connected mustard cushion
wedges, two additional green-couch pants pinholes, and larger opposite-direction mistakes on other seats.
The green-couch pinholes now pass both independent source labels and fresh actual WorldView captures:
rounded pelvis corners expose underlying shin pixels that still occupy the hip volume. Six source-bound,
outfit/pose/placement-bound regression points are retained. This does not approve entire seats.

The current capture process also reconstructs furniture and occupants independently and compares every
opaque device pixel with the final WorldView canvas. It does not call the renderer's blit/order helpers.
Neutral daylight is explicit, so this proves compositing/placement, not every lighting condition. Fault
injection checks detect one-pixel drift, wrong ordering/repaint, and RGB-only changes. Independent semantic
labels remain a separate requirement: a perfectly reproduced wrong mask still fails visual acceptance.

Commands:

- `node --no-maglev --import tsx scripts/seat-pixel-audit.ts --out art/review/pixel-catalog-current`
- `node --no-maglev --import tsx scripts/seat-pixel-review.ts CAPTURE_DIR` creates bounded per-asset pages.
- `node --no-maglev --import tsx scripts/seat-canvas-check.ts CAPTURE_DIR` checks final RGBA evidence.
- `node --no-maglev --import tsx scripts/seat-semantic-check.ts CAPTURE_DIR INDEPENDENT_REVIEW.json`
  rejects incomplete/uncertain overlap labels rather than silently approving them.
- `node --no-maglev --import tsx scripts/seat-pixel-coverage.ts CAPTURE_DIR EXPECTATIONS.json`
  explicitly counts unlabeled overlap pixels; six passing points do not approve 21,811 overlaps.

Adversarial artifacts in `art/review/pixel-catalog-current/independent-review` include confirmed failures on
rust/green armchairs, cyan/purple beanbag rear shells, and couch back boundaries. Some front chair and bench
back domains have exhaustive independent labels and pass; arms, boundaries, other looks, and transitions
must not inherit those approvals. New generated couch/chair candidates were captured in actual WorldView;
the yellow candidate reproduces the same semantic error and is not ready to publish.

The proxy fitter optimizes silhouettes, which cannot uniquely identify interior surfaces. Widening cushion
boxes or growing same-colored regions repaired some known points but damaged negative controls; those
experiments were rejected. Source-bound per-view surface identity maps are being implemented as the next
pipeline representation. `art/seat_surfaces.py` proposes these from beauty artwork through structured vision
output, without changing artwork. Proposals are explicitly UNREVIEWED, require complete opaque coverage,
and remain separate from independently authored expected masks. No new semantic model or candidate artwork
has yet replaced the public catalog. Do not claim this pipeline or the catalog is finished.

## Independent verification and first local promotion (2026-09-30, continuing)

The mustard armchair is the first semantic model promoted into `art/seat-models.json`.
`verified-mustard-v4/local-live-bundle.json` passed after a normal reload from port 5195,
without a candidate manifest override: 16 settled contexts, 11,894 independently labeled
overlap pixels, and 237,360 opaque final-canvas pixels. Original beauty art is unchanged.
This is a finite static review, not a claim about every avatar, animation, or future asset.
Later renderer edits invalidate its receipt and require fresh capture before re-promotion.

The front cushion fix establishes a physical relation only for settled sitters whose
exact placement/height matches a cushion and whose knees clear its front. Front-facing
backrests remain behind the entire settled body. Foreground arms, rear views, tucked
knees, and transitions have separate negative tests. Semantic rear shells retain their
foreground identity even where an undersized proxy gives them insufficient height.

`seat-verify-bundle.ts` checks all four facings, four review outfits, and every cushion.
It requires an immutable source/figure/placement context, an independent winner for
every overlap, and no uncertain labels. It reconstructs final canvas coverage and RGBA
from original art, original figures, independent winners, and device placements. It
also rejects hidden body pixels outside furniture, invented pixels, clipped captures,
tampered files, stale surface maps, and changed renderer source. Capture-time receipts
prevent attaching a new source revision to old screenshots. Common compiler and
DesignLab publication paths consume this gate.

`art/seat_surface_repair.py` performs source-only close inspection of flagged boundaries:
every opaque pixel in the region receives an explicit part/face proposal, outside labels
and beauty pixels stay unchanged, and the entire independent review must pass again.
The first green-couch refinement repaired its confirmed crest pixels but introduced
inner-cavity errors; it was rejected. Neither a complete annotation nor a clean canvas
comparison alone establishes correct occlusion.

The automatic independent reviewer deliberately receives no current masks, surface
labels, masked figures, or expected canvas. DesignLab now orchestrates capture, source-only
review, and bundle checking. Its initial calibration still disagrees with known independent
mustard judgments, so reliable unattended review remains unfinished. Conflicting and
uncertain judgments block acceptance instead of becoming a false successful generation.

The green couch's questioned rear pixels `(53,22)` and `(54,22)` are descending shin,
not pelvis. Independent inverse projection and ray/capsule intersections place their
frontmost limb surfaces below the cushion; hiding them is correct. The withdrawn visual
diagnosis and corrected review remain in the evidence trail. Actual unresolved couch
errors concern foreground arm crests and ambiguous upholstery boundaries.

Current review update (2026-09-30)

The event-hall `chair.red` is now published with compiler v3 and semantic surfaces.
Its `verified-red-arch-v3/local-live-bundle.json` proves all 7,654 overlapping pixels
in 16 independently reviewed settled contexts and final WorldView canvas pixels on
5195, without candidate overrides. The same expectations are permanent build fixtures
in `tests/fixtures/seating-reviewed-chair.red.json`. Beauty pixels are unchanged.

The original red-chair proxy split one arched back into two independently moving boxes.
The cap drifted forward and down, creating a fictitious obstacle that pushed the sitter
to v=0.31. The fitter now preserves shared back depth, a joined vertical seam, and a
narrower cap above the body, including refinement of a valid saved stack. Compilation
places this chair at v=0.48 without a named-asset adjustment. Compiler v3 invalidates
old drafts. Existing v2 public models retain their original identity and are explicitly
validated as legacy, not silently re-signed or called current.

The finite rounded pelvis shape plus its one-pixel outline now determines hip support.
An earlier `(52,21)` green-couch expectation mistook a descending shin for the pelvis.
Independent original-avatar ray/capsule evidence places it over two world pixels below
the cushion. `tests/fixtures/seating-pelvis-corner-proof.json` preserves that proof, and
the regression expectation preserves the withdrawn claim in `supersedes`. Adjacent
`(51,21)` remains visible as actual pelvis outline. The mustard full-pixel regression
still passes. A beanbag's near side wrap and far side wrap now have distinct foreground
relations, like armrests; its central rear shell remains separate.

All model writes through `withModels` now use the common evidence gate under the lock.
Legacy `seat-model` edits stage review files by default. `seat-publish-reviewed.ts` can
publish an exactly verified model against unchanged live catalog artwork without
refitting it; it validates source identity and geometry and still requires a complete
current verification bundle. It does not promote a legacy model to a newer compiler.

Sparse source annotation gaps receive one bounded coordinate-specific source-only
repair, never nearest-neighbor semantic guesses. All outside labels and beauty pixels
remain unchanged. Identical repair requests reuse their saved response and do not pay
again. Complete source coverage remains a proposal, not visual approval.


### Shared outline authoring convention

When a foreground back or raised back cushion physically joins an opposite arm,
source pixels may share a one-pixel outline with no recoverable original part
identity. The authoring pipeline intentionally assigns that shared contour to
the foreground back so its outline continues through the junction. This is
semantic art direction, not a claim to reconstruct an unknowable original depth.
The source-only proposal records this convention in its reasoning; independent
review checks the authored result and the actual game canvas before publication.

The rule requires visible physical contact and contour continuity, using other
source facings when needed. It does not apply to isolated far-arm caps/interiors,
detached outlines, supporting seat wells, or arbitrary dark pixels. It never
changes beauty pixels, expands a mask, or introduces an asset-specific renderer
rule. Source ambiguity and previous review adjudications stay in provenance.

A cast shadow inherits the receiving surface, not the rail or arm casting it.
The source-only producer must establish the receiving side from an uninterrupted
raised contour and continuous receiving material across the source views. Darkness
or nearest color alone is insufficient. A mixed boundary shade may be deliberately
authored as receiver shadow when both contour and material continuity support that
reading; the proposal records the affected region, convention, and evidence. Actual
rail pixels and isolated raised contours retain their own geometry. If that evidence
is missing, uncertainty remains blocking. This is an authoring convention, never a
runtime color filter, per-asset offset, or a reason to change independent goldens.

### Motion is a separate required review

Settled pixel approval does not approve entering or leaving the seat. The normal-server
red-chair audit found a brief cushion cut through 31 original pelvis/outline pixels
during entry even though every settled expectation passed. The preserved counterexample
is `art/review/models-live/red-normal-four-look-motion-v2/red-entry-penetration-counterexample.json`.
The first trajectory correction removed that cut but introduced an early seated hover;
the second correction waits for actual cushion arrival before using the seated pose.

`tests/e2e/seat-models.spec.ts` records actual WorldView draws during approach, entry,
every cushion change, and exit. It records all four review outfits, including the cardigan,
and four facings by default. Each changed rendered state keeps its original avatar,
actual masked avatar, source artwork/model, device placements, final-canvas crop, pose
observations, and source receipt. Crops cover the complete avatar/furniture union and
reject viewport clipping. There is no fixed frame-count cap.

Run against a frozen review server with a unique run label and a short unique bot tag:

```powershell
$env:PLAYTEST_URL = 'http://localhost:5195'
$env:PLAYTEST_TAG = 'seatmotion'
$env:SEAT_MODEL_RUN = 'seat-motion-review-unique-label'
$env:SEAT_MODEL_KEYS = 'chair.red,stool.drafting'
$env:SEAT_MODEL_STRICT_LOOKS = '1'
Remove-Item Env:SEAT_CANDIDATE_MODELS -ErrorAction SilentlyContinue
node --no-maglev node_modules/@playwright/test/cli.js test seat-models --workers 2
art/.venv/Scripts/python.exe scripts/seat-motion-check.py art/review/models-live/seat-motion-review-unique-label --require-complete
```

An optional second positional argument to the checker supplies independent settled
expectation files. They apply only when the captured original figure RGBA/owner hashes,
pose, facing, feet, legs and source match exactly. Every cushion must have an exact
reviewed settled frame when expectations are supplied. Reviews are matched by their
context, not a filename convention. Other frames stay explicitly unmatched.
`SEAT_MODEL_FILM_LOOKS=3` permits a quick cardigan-only diagnostic; it cannot pass the
complete 16-context check. Use the full default for approval work.

The byte checker proves exterior-avatar integrity and exact final-canvas placement at
the documented 2x zoom / deviceScaleFactor 1. It rejects incomplete required context
coverage, substituted outfits, changed capture-time renderer receipts, clipped pixels,
unexpected body changes and observed within-draw pose disagreement. It does **not**
approve ambiguous furniture overlaps, artistic quality, or an unreviewed trajectory.
Inspect every film and enlarged contact frames independently, especially contact before
lift, early seated hovering, pose-switch jumps, exit overshoot, and raised neighboring
supports. Preserve failed runs rather than overwriting them. A changed renderer requires
fresh captures; this motion audit does not replace the settled publication bundle.

### Blue couch: reviewed source-bound contour intent

The compiler-v3 blue couch is published locally with its original PR2 artwork. All
32 settled contexts (four facings, four outfits, two cushions) pass 24,024 independent
overlap decisions and final-canvas recomposition, including a fresh normal-server
capture without candidate overrides. The repeatable fixture is
`tests/fixtures/seating-reviewed-couch.blue.json`; evidence is in
`art/review/verified-blue-v3/normal-live-bundle.json`.

Six source pixels at the shared rear back/far-arm outline have explicitly authored
foreground-back intent. Three reviewers compared blinded complete alternatives;
the original source does not uniquely determine their depth. The decision and
pre-reveal records remain in `art/review/blue-boundary-blind-v1`. This is an asset
authoring decision, not an asset-name conditional in the renderer or a claim that
the rejected alternative was physically impossible. Motion remains a separate audit.

`scripts/seat-pixel-audit.ts` now requests a footprint-aware evidence canvas large
enough for the original avatar canvases as well as the furniture. The thumbnail
viewport clipped rear-view sprite padding; complete publication evidence rejects
that capture even when its visible silhouette appears intact.

The full blue motion run exposed a real clock race inside one actual draw: its leg
and sprite calls returned `sit-lounge`, while height and masking calls returned
`crouch`. `art/review/models-live/blue-published-four-look-motion-v3/actual-draw-pose-race.json`
preserves the failing frame and adjacent enlarged images. WorldView now holds one
monotonic animation instant across update and draw (also standalone/nested draws),
with `finally` cleanup. Its server-offset wall clock remains separate. The advancing-clock
regression is `src/client/engine/WorldViewClock.test.ts`; passing settled pixels alone
would not catch this failure.

## Required evidence protocol for Design Studio seats

The review unit is an immutable candidate plus a finite context matrix. A result must
say exactly which art, model, body, renderer, directions, cushions, outfits, and motion
paths it covers. "Tests passed" or a pleasing thumbnail is not a seating approval.

1. **Stage a candidate.** Keep beauty artwork and semantic source proposals separate.
   Save original provider responses, compiler identity, model geometry, physical part
   assignments, source hashes, and explicit ambiguities. Generate all physical views;
   do not hide a bad view behind a mirrored preview or a per-view sitter offset.
2. **Freeze capture inputs.** Record the source/model/surface/compiler identities and
   renderer files before and after capture. The figure context includes pose, facing,
   exact placement, feet, legs, hip height, original RGBA/owner fingerprints, and canvas
   device placement. A mismatch, clipped crop, missing map, or changed receipt blocks
   approval. Never attach today's revision to yesterday's screenshots.
3. **Capture the actual game draw.** Settled evidence comes from WorldView, with all
   four facings, all cushions, and all four review outfits. Include multiple occupants
   where their ordering can interact. Keep original unmasked figures, actual masked
   figures, source art, raw arrays, and final canvas; previews alone are insufficient.
4. **Write independent expectations.** Review original source art in all facings and
   original unmasked anatomy first. The independent reviewer must not receive the
   current occlusion mask, surface proposal, masked output, or renderer-built expected
   canvas as its answer key. Name the source surface and physical ordering rationale
   for every overlapping pixel. Preserve unknowns explicitly; an unknown blocks that
   context instead of being filled from the current renderer. Use original joint/ray
   geometry when pelvis, thigh, and descending shin are visually confusable.
5. **Compare every pixel.** The bundle checker recomputes overlap coverage and final
   canvas composition from original art, original figure, independent winners, and
   recorded placements. Require zero missing labels, zero uncertain labels, zero
   wrong winners, and exact RGBA/coverage. It also checks that furniture has not erased
   the body outside its silhouette. A self-comparison of two renderer-derived images
   cannot establish correctness.
6. **Challenge the result.** A separate adversarial reviewer inspects native and enlarged
   actual composites and tries opposite-direction counterexamples: cushion versus arm,
   far arm versus near back, rear shell versus inner well, pelvis versus shin, and front
   versus rear views. Keep the first failing frames and exact source coordinates.
   Geometry fixes need negative controls from other seat families and all previously
   approved immutable expectations. A fix never silently rewrites its own goldens.
7. **Review motion separately.** Record actual draw calls throughout approach, entry,
   contact, settled sitting, every cushion change, and exit in every facing/outfit.
   Include varied heights/styles and side approaches when the change affects trajectory.
   Capture every observed changed state without a frame cap. Run the exterior/canvas
   byte and exact-context checker, then personally inspect every film and enlarged
   contact transitions. The checker cannot infer every transition's semantic winner;
   gaps in sampling or unresolved overlaps must be stated. A settled pass is not a
   motion pass, and motion byte fidelity is not artistic approval.
8. **Publish and verify the ordinary path.** Promote only through the common evidence
   gate. Reload the normal server without candidate overrides and repeat the static
   bundle check; capture motion against the same served candidate when applicable.
   Keep the review matrix, source-bound expectations, adversarial findings, failed
   attempts, and acceptance receipts together. Code/art changes require fresh evidence.

Ordinary-room checks must retain the real neighbors, lighting and draw order. A
plant or table can hide the very contact edge being checked: record that region as
not visible and inspect another existing placement as well. Do not remove a
neighbor to make the ordinary-room screenshot pass, or count a hidden limb as
visually verified. Keep the isolated full-coverage review and the ordinary-room
integration check as separate evidence.

An independently disproved expectation may be superseded only with explicit evidence,
reason, old winner, and replacement winner retained in the trail; the green-couch
rounded-pelvis corner proof is an example. An ambiguous shared source outline may be
resolved as **new authoring intent**, using the documented physically joined contour
convention or blinded complete A/B compositions reviewed at native and enlarged scale.
Record the choice before revealing the implementation. Do not relabel that choice as
recovered original artist intent, and do not broaden it to unrelated arm interiors or
supporting cushions. If neither alternative is convincing, regenerate and review anew.

### Implemented and pending Studio behavior

Implemented: automatic geometry compilation and occupied previews, source-only semantic
proposals, server orchestration of actual settled capture and independent review,
bounded source-only repairs, immutable evidence bundles, and a common publication gate.
The CLI tools above provide full motion recording and adversarial byte checking. The
recorded red-chair entry failure, blue-couch actual-draw clock race, and pelvis-corner
counterproof are regression examples the process must retain.

Studio now reads the common bundle verifier rather than trusting an accepted draft
flag. It shows captured/reviewed outfit coverage for every direction and cushion,
recorded pixel failures, unresolved pixels, source-receipt status, and precise evidence
links. Its pixel viewer displays the saved game canvas at integer zoom with screen
coordinates and RGBA inspection; it does not redraw furniture or smooth the pixels.
Current drawing bytes, view placement, furniture declaration, complete model mechanics,
and separate semantic-map digests must match. Missing historical bindings remain
blocked. Unsupported or incomplete evidence never earns a green result.

Every newly published seat with generated surfaces also needs the separate visual
quality gate, including rigid chairs, couches, stools and benches using version 1
surfaces. Curved version 2 surfaces do not receive a special exemption or carry the
only visual requirement. Complete numerical coverage remains visible in Studio while
missing or rejected visual evidence blocks acceptance. Existing catalog art is not
rewritten merely because the publication requirement becomes stricter.

Pending: reliable unattended semantic review across all seat families; automatic
motion frame scrubbing in that UI; and independent full-context approval
of the remaining catalog. Settled pixel evidence alone is not a motion or artistic
quality approval. A literal user must not be asked to repair pixel masks, body offsets,
or physical part assignments to make a generated seat work.

### Actual motion review inside Studio

The draft adapter in `scripts/lib/seat-motion-candidate.ts` routes only its test
browser to exact staged manifest entries, models and PNG bytes. It uses an isolated
`seatlab-KEY~WxD~RUN` room with real server seating. Draft publication is unnecessary.
The existing fixed review room currently accepts bounded footprints from 1 to 4 on
each axis; larger furniture is rejected pending a scalable room layout.

`art/seat_motion_review.py` records real clicks, occupancy and WorldView draws with
`tests/e2e/seat-models.spec.ts`, then runs `scripts/seat-motion-check.py` against the
immutable settled expectations. All four directions and four outfits must include
approach, contact, every cushion and exit. Source, model, sprite, recorder, checker
and renderer bytes are bound; changed evidence invalidates cached success. These
checks verify exterior bytes and settled overlap expectations, not the appearance
of transition overlaps.

`art/seat_motion_visual.py` prepares native and enlarged pages containing **every
recorded changed state**, without endpoint sampling. Its manifest binds the exact
films, numerical bundle and checker result. The common publication verifier
independently checks each extracted frame and page against the recorded canvas,
observed phase/cushion coverage, exact model and renderer, and separate whole-film
approval. Approval requires two distinct independent local reviewers or one bounded
vision request containing the exact hashed review pages. Missing, rejected or
unresolved transition appearance blocks publication and Studio acceptance even when
all numerical checks pass. Named reviewer records document the reviewers' claims;
cryptographic hashes establish evidence identity, not independent reasoning.

The settled visual gate similarly reconstructs every composite and required
contact/topology flag from original anatomy and independent labels, including each
marked crop. It explicitly reviews comfortable seating depth, cushion/backrest
proportions and body scale. The user's rejection of a numerically passing red chair
as sitting too far forward is a required negative example: absence of clipping is
not sufficient aesthetic approval. Historical rejected artifacts remain preserved.

The Studio status separates movement invariants and transition appearance, links
both manifests/decisions, and can accept only verified success. Its movement
scrubber displays the original hash-checked game PNGs, with direction/outfit
selection, every recorded frame, nearest-neighbor zoom and screen-coordinate RGBA
inspection. Failed or stale recordings remain inspectable without becoming approved.
The canvas smoke test compares displayed pixels with the original PNGs; an isolated
Express-route check also verifies that the API returns original PNG bytes unchanged.
These viewer checks establish faithful inspection, not candidate visual acceptance.
New-draft end-to-end generation remains a separate validation obligation.

### Authored curved surfaces and original avatar provenance

A generated curved seat can carry an explicit authored solid and source correspondence
instead of pretending that a rectangular proxy recovers every visible fold. Its depth
and the avatar's depth are authoring decisions that require visual review. Agreement
between an independent numerical reference and the renderer proves implementation
consistency; it does not, by itself, prove a beautiful or physically convincing result.
Preserve the rejected reference versions and the exact visual counterexamples that
motivated changes before freezing the accepted reference for actual game captures.

Preserve the avatar's original raster construction when assigning depth. The original
rounded pelvis has exact exclusive bounds and rounded corners; its bounding rectangle
must not claim descending shin pixels. A source outline attaches to its actual painted
neighbors. Tiny pockets deliberately filled by `sealPinholes` carry explicit `sealed`
provenance, mirrored with the pixels, and receive a local harmonic extension of their
enclosing boundary depth. This does not change RGBA or ownership, fill runtime mask
holes, or propagate depth through arbitrary outline chains. Real open gaps stay open.
The pink beanbag review caught both detached outline strokes and two such sealed
pockets; exact provenance also disproved the initial assumption that a third ankle
pixel was a pocket. Keep that correction trail instead of forcing all pixels visible.
For the remaining enclosed ankle stroke, the adversarial reviewers rejected a
physically plausible but visibly isolated upholstery pixel. The resulting authoring
rule applies only to original outline pixels surrounded on all four sides by original
opaque avatar pixels: interpolate their connected internal seam from its original
enclosing depth boundary. That change preserved exterior outline and painted-body
depths, verified against a pre-change digest. This rule is defined before any furniture is
considered; it cannot inspect or repair a rendered mask. A runtime-derived prototype
is labeled as a candidate, then checked against a separately implemented source-body
reference before becoming expected pixels for new captures.

The next exact visual review rejected a different painted-shoe hole at pink SE
(44,33), despite the v10 numerical reference passing. A shoe must enclose its own
ankle. The source kit now records `shoeLimb` (1 near, 2 far) for the actual shoe
painter; the authored shoe surface includes that corresponding lower-shin capsule.
It never selects the nearest projected leg or borrows from a crossing opposite leg.
Source RGBA and ownership remain unchanged. An unrelated-body depth digest remains
bound to the older source export; it explicitly excludes revised shoe paint and its
adjacent original stroke instead of silently replacing the entire golden hash.

The same review traced an apparent hair pixel between shoes to `sealHairPockets`:
that legacy function also paints small body-only gaps with a hair owner. Exact
`bodyPocket` provenance records only actual fills whose enclosing border has no
hair or hat. These and original `sealed` pockets solve their connected source
boundary together (component limit 20; larger components stay unresolved). Genuine
hair-framed pockets keep hair depth. `sourceMetadataVersion: 2` and full-length
metadata arrays are mandatory for new independent body references; missing metadata
must not be guessed from colors or owners. The v11 body change remains subject to
fresh numerical, complete visual, and motion review before publication.

Continuous depth comparisons also need exact cache identities. Two hip heights less
than a hundredth apart can cross an actual surface boundary; rounding the cache key
can return the previous mask even when the correct winner changed. The warmed-cache
regression in `seatAuthored.test.ts` checks this with a real source/body depth crossing.
