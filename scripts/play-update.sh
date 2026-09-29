#!/usr/bin/env sh
# Move the stable play build (../Minglewood-play, served on :5180 / API :8790) to the latest commit on
# world-polish. Only run this after `sh scripts/gate.sh` is green and the work is committed: the play build
# is what Carter plays, so it must never carry half-finished edits.
set -e
PLAY="$(cd "$(dirname "$0")/../.." && pwd)/Minglewood-play"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
before=$(git -C "$PLAY" rev-parse HEAD)
git -C "$PLAY" checkout -q --detach "$(git -C "$REPO" rev-parse world-polish)"
after=$(git -C "$PLAY" rev-parse HEAD)
if ! git -C "$PLAY" diff --quiet "$before" "$after" -- package-lock.json; then (cd "$PLAY" && npm ci --no-audit --no-fund); fi
echo "play build: $(git -C "$PLAY" log --oneline -1)"
echo "restart the play API server (it doesn't watch files): API_PORT=8790 npx tsx src/server/index.ts in $PLAY"
