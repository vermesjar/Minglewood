#!/usr/bin/env sh
# The pre-commit gate for art and character work: every step must pass (exit codes, not grep).
set -e
npm run typecheck
npm run lint
npm test
npm run avatars:sweep
echo "gate: all green"
