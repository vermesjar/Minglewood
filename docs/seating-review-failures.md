# Rejected review: red event-hall chair

The user rejected the published chair because the character sat too far forward.
Earlier numerical, visual and motion approval did not establish acceptable sitting
position. Those approval claims are withdrawn; the historical captures remain
evidence of what was tested, not evidence that the chair was good.

## Why the review failed

- Expected overlap pixels were evaluated at the same incorrect sitting position
  as the renderer. Agreement could not reveal that the position itself was wrong.
- Visual reviewers checked clipping, foreground order and motion but missed the
  excessive space between the sitter and the backrest.
- The placement rule reserved .3 tile behind the pelvis, although the original
  avatar's authored posterior radius is about .21 tile. A separate conservative
  thigh limit could pull the sitter farther forward still.
- A silhouette fit could extend the inferred cushion to explain other painted
  parts, then compensate by moving the sitter away from the backrest.

## Required checks

1. Review the whole pose against original furniture artwork before approving
   individual overlap pixels: posterior support, backrest contact, cushion depth,
   knees clearing the front, and plausible proportions.
2. Treat source geometry, overlap correctness, whole-pose quality and motion
   quality as separate checks. Success in one cannot approve another.
3. Inspect every cushion in all four directions with the review outfits, at
   native size and enlarged without smoothing. Inspect actual entry and exit
   films as well as settled composites.
4. Keep independent source labels tied to the exact pose and artwork. Do not
   migrate old labels to a changed pose or regenerate expectations from masks.
5. Preserve explicit uncertainty. Source-authored body depth is a declared
   geometric interpretation, not recovered ground truth about the artist's intent.
6. Record user rejection as superseding earlier visual approval. Preserve the
   rejected evidence and rerun the relevant checks before claiming a fix.

The compiler now checks posterior clearance and leg reach, and fitting cannot
trade away support for a better silhouette score. Both settled and motion visual
review explicitly require comfortable placement. These checks reduce the known
failure modes; they do not replace visual judgment or imply that every catalog
seat is approved.

During the reopened review, a suspected loss of directional surface maps was
reported prematurely. Direct comparison disproved it: the old and new maps were
identical. Verify an exact source/model comparison before presenting a suspected
handoff failure as a diagnosis.

## Preserve working seats

The user rejected catalog-wide rebuilding prompted only by the new placement
heuristic. Existing accepted seats remain regression references. A numerical
warning is a review lead, not proof of a visual defect or authorization to replace
their artwork or rig. Apply the improved compiler to new designs and confirmed
failures; visually establish a defect before changing an accepted seat.

The unapproved `art/review/catalog-placement-compiler-v4` candidates are withdrawn
from publication. Their bulk generation script is disabled. Keep the diagnostic
artifacts for traceability; do not promote them as a catalog migration.

## Motion recording and replay

New motion recordings use the continuous-height postchecker. Rounded feet and
matching pose pixels alone do not establish that a moving character occupies the
same physical height as an independently reviewed settled pose.

Keep film hashes in the recording receipt even if numerical checking fails.
A later recheck must match every film against that original receipt, rejecting
missing, extra or altered films. Hashing the files only when replay starts does
not prove their original capture identity. Historical captures without a film
receipt require a new recording; do not manufacture a receipt retrospectively.

Rechecking changes the analysis, not the recording date or renderer used.
Renderer freshness and whole-motion visual review remain required. A successful
postcheck does not approve the appearance of transitional overlap pixels.

## Deterministic lighting survives browser retries

The orange beanbag motion review caught a whole-canvas color mismatch after the
front-facing films had passed. Its rear-facing films had nighttime tint, while
the original artwork and overlap ownership were unchanged. The capture harness
set its neutral sky only before the facing loop. A page reload in the retry
helper discards that module state; this was reproduced separately with a forced
reload. The original film log does not prove exactly when a reload occurred.

Restore and assert the neutral sky inside each retryable facing callback and
immediately before starting each film. Test that restoration after a forced
reload as well as after explicitly setting nighttime weather. Keep the exact
canvas-color check: disabling it or widening its tolerance would hide this
capture failure. Preserve the failed recording and start a separately bound
recording with the corrected harness.

## Mechanical bounds do not establish rounded upholstery

The isolated green-couch experiment compared a signed-distance producer with an
independent analytical rounded-cuboid solver. Their intersections agreed, and the
fixed sitting contacts passed, but the declared solids still missed source pixels
and assigned some painted cushion and arm interiors to other physical components.
Agreement between solvers establishes the mathematics of a declaration; it does
not establish that the declaration describes the artwork.

Keep support/collision dimensions separate from visual upholstery volumes. Fit
visual volumes only against bare source views and independently identified part
interiors, with tied symmetric parameters and preserved support contacts. Never
optimize geometry against the desired avatar winners. Keep ambiguous seams and
uncovered pixels unresolved until source authorship or regeneration resolves them.
Do not publish a candidate merely because its numerical solvers agree.

## Combining local visual reviews

Combine only completed reviews of the same exact manifest and scope. Retain each
reviewer's original record and hash, require complete context/risk coverage from
both, and include their existing identities in the decision's provenance. A
combined decision must not invent an identity, fill an omitted verdict, or erase
one reviewer's uncertainty. The ordinary publication gate remains authoritative;
a standalone motion replay does not validate the separate settled review record.

`scripts/seat-combine-local-reviews.ts FOLDER REVIEW_A.json REVIEW_B.json` assembles
those existing records, including identities and hashes, and rejects incomplete,
stale, duplicate or uncertain judgments. It refuses to overwrite an existing
decision. It does not perform visual review or bypass the publication verifier.

## Four outfits are not wardrobe coverage

The additional ordinary-room orange beanbag check found an invisible sitter in
Engineering after the four standard review outfits had passed. The original skirt
pixels were painted in the legs layer but extended beyond the anatomical capsules;
the authored-depth lookup threw during the actual draw. The screenshot and failed
film are retained under `art/review/published-beanbags-real-rooms/beanbag.orange-eng`.
The broader original-body audit also exposed rain-boot, skate and mobility-equipment
coverage gaps. This is avatar source coverage, not a defect in the beanbag artwork.

Audit original opacity independently of furniture. Use the catalog to enumerate
garment, footwear and body combinations; also include single-item silhouettes and
the exact leg parameters produced by candidate seats. Every opaque source pixel
needs a justified body, cloth or equipment surface. A depth assigned solely to
avoid an exception is not a surface model. Preserve original RGBA and painting
ownership, and independently evaluate the declared geometry before checking its
composition with seats.

`scripts/avatar-seat-coverage.ts OUTPUT.json [--full] [--captures FILE.json]` records
source hashes, finite-depth failures and their original coordinates. The default
matrix crosses long garments plus tee/hoodie with all bottoms, footwear and bodies,
and tests every other catalog item alone. `--full` crosses every catalog top too;
repeat `--captures` to add exact recorded leg configurations. Neither mode exhausts
palette/accessory interactions, arbitrary future clothing or continuous motion.
Source changes during a run invalidate its certification. Finite depth coverage
is a prerequisite, not pixel-order or visual approval. Reproduce the failing actual
room after the correction and refresh affected seating evidence.

Wheelchair users follow an existing separate route: their wheelchair remains their
own seat and WorldView bypasses furniture/body depth composition. The audit records
those looks as excluded, with the routing source bound in its receipt. Missing
unused wheelchair depth is not a reproduced seating exception. A cane remains
relevant during standing/crouching transitions and must retain its authored depth.

### Ordinary-room errors and movement inspection

The ordinary-room recorder now writes a `capture-receipt.json` beside each film.
It hashes the renderer and recorder before and after capture, the exact evidence,
model, source art, and every screenshot. Browser errors, caught WorldView frame
failures, inconsistent poses, or changing sources fail the check after retaining
the evidence. These receipts document integration observations; they do not replace
the independent pixel expectations or the common publication gate.

Studio's movement viewer reads the original PNGs from hash-checked film artifacts.
Direction and outfit controls select one recording; the frame slider and keyboard
step through every saved state, with nearest-neighbor magnification and exact
screen-pixel coordinates/RGBA. Failed or stale recordings remain inspectable and
retain their failed/stale review status. Viewing a film never grants approval.
The component smoke command `scripts/seat-motion-viewer-smoke.ts MANIFEST OUTPUT`
checks displayed canvas RGBA against original PNG bytes across front/rear views,
outfits, and first/last frames; its isolated fixture is not a seat-quality review.

### Garment correction acceptance scope

Keep three separate records when correcting original avatar depth:

1. Catalog coverage records whether every opaque source pixel has finite, justified
   geometry. The final v15 run exercised 2,833 looks across 101,952 contexts without
   missing depth. It does not establish correct furniture overlap for all clothing.
2. Standard seat evidence retains independent settled expectations and two fresh
   whole-film visual reviews. The four unchanged beanbags were reviewed across 64
   films and 3,390 recorded states after the garment correction; the common
   then-current publication gate passed for each exact model. The subsequent
   catalog wardrobe prerequisite requires a separately bound receipt before a new
   publication; earlier gate receipts do not satisfy that new requirement. Read-only eligibility is not a new
   publication or remote deployment.
3. Supplemental diagnostics reproduce difficult silhouettes: the original failing
   skirt/hoodie look, long skirt/rain boots, dress/skates and coat/cane/skates. Both
   reviewers inspected all 662 recorded states on the published orange beanbag.
   This covers those four outfits and that seat, not every wardrobe combination.
   The authored seated pose omits the cane and restores it when standing; record
   that behavior explicitly rather than describing it as continuous animation.

Evidence lives under `art/review/verified-beanbags-authored-k-garment-final`,
`art/review/avatar-seat-coverage-garment-final.json`, and
`art/review/supplemental-wardrobe-root-review.json`. The same ordinary-room fixture
that originally failed must also pass with the actual room's lighting and neighbors.
An occluded contact cannot be approved from a screenshot that does not show it.
Do not carry these approvals to later source changes merely because the artwork
looks unchanged: recheck the recorded source identities and publication gate.

### A broad contact-sheet review missed six bench pixels

The published metal-and-wood bench had one wooden-slat pixel incorrectly assigned
to a foreground iron-arm box: SW (68,55), mirrored SE (35,55), near cushion 1,
outfits 0, 2 and 3. Both broad film reviews missed it. A separate original-source
part comparison caught all six cases. Preserve those prior reviews and append a
superseding failure; do not erase the miss or call the old visual pass exhaustive.

Source identity must precede proxy depth selection. An intersecting arm box does
not make a wood pixel iron. A source-bound semantic-map candidate corrects the six
front pixels without moving the body, redrawing art or shrinking the arm. Rear
wood is not automatically seat pan: the gold strip behind the near iron post
continues the upper back rail. Resolve such regions against the original views
and construction, not against whichever mask looks preferable.

The bench also retains an older compiler/body policy. Attaching a semantic map
alone does not activate modern rear support-body depth. Do not falsify its compiler
version to opt into a newer renderer. A reviewed migration must bind explicit
mechanics, original source, pixel expectations and fresh movement evidence.

The case and superseding root finding are preserved in
`art/review/bench-final-independent` and
`art/review/bench-published-final-adversarial/root-front-pixel-failure.json`.
