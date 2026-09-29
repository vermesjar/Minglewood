# Manifest requests (from the café / furniture work)

Things the art manifest (public/art/manifest.json, written by art/studio.py) should carry. The client works
around each at runtime today; fixing them at the source keeps the data honest.

- `couch.blue`: add `"seat": 12` (same cushion height as couch.green). Runtime: artSeat borrows a sibling's.
- Small pieces are centred on their footprint at runtime (src/client/engine/sprites/footing.ts). Their
  generated anchors put the piece's front edge on the tile centre, so they sat 2–4 world px too far back.
  When re-publishing, anchor small pieces by their base centre (scripts/furniture-review.ts reports each
  one's offset as a note).
