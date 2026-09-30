#!/usr/bin/env sh
# The pre-commit gate for art and character work: every step must pass (exit codes, not grep).
set -e
# The tests and scripts run under node with V8's Maglev JIT off: on Node 24.12 (Windows) it miscompiles something and
# the process dies on a heap check ("IsFreeSpaceOrFillerMap", "ContainsLimit", a segfault) — vitest's start-up and
# furniture-review every time, seat-rig now and then (2026-09-29). The flag isn't allowed in NODE_OPTIONS, hence
# calling node directly (and vitest in threads, which share the flag; forked workers don't). Drop this once node is
# upgraded past the bug.
ts() { node --no-maglev --import tsx "$@"; }
npm run typecheck
npm run lint
node --no-maglev node_modules/vitest/vitest.mjs run --pool=threads
ts scripts/avatar-sweep.ts
# the wall art standard (models.ts wallFit): every wall piece drawn at 2:1, never squeezed, clear of the trim
ts scripts/model-check.ts --category wall-art
# every drawing in the game's 2:1 projection (scripts/lib/projection.ts); PROJECTION_TODO lists those awaiting a redraw
ts scripts/model-check.ts --projection
# every room: overlaps, nothing hiding the walls, no wall piece squeezed into its span (shared with decorate mode)
ts scripts/room-map.ts --quiet
ts scripts/town-stoops.ts
ts scripts/town-seats.ts
# the seat grade: every catalog seat, built from its spec, passes the seat framework's measurements in every facing
# with every review look on every cushion, and its PNGs and manifest entry are its render (docs/seating.md)
ts scripts/seat-grade.ts --check
ts scripts/furniture-review.ts
(cd art && uv run check_facings.py)
echo "gate: all green"
