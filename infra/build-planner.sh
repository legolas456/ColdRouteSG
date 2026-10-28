#!/usr/bin/env bash
# Package planner/ for Lambda (Node.js 22): the handler, the console code it
# shares and the AWS SDK clients bundled into one file, as
# infra/build/planner.zip. Needs Node 22 with npm, and zip.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/infra/build"

mkdir -p "$OUT"
rm -f "$OUT/planner.zip"

echo "==> Installing the planner's packages"
(cd "$ROOT/planner" && npm ci --no-audit --no-fund --loglevel=error)

echo "==> Bundling the planner"
(cd "$ROOT/planner" && npm run --silent build)

(cd "$ROOT/planner/dist" && zip -q -X "$OUT/planner.zip" index.mjs)
echo "==> Built infra/build/planner.zip ($(du -h "$OUT/planner.zip" | cut -f1))"
