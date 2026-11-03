#!/usr/bin/env bash
# Package backend/ for Lambda (Python 3.12 on x86_64): the app, both handlers
# and Linux wheels of requirements-lambda.txt, as infra/build/backend.zip.
# Works on macOS and Linux without Docker. Uses uv if installed, else pip.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/infra/build"
PKG="$OUT/pkg"
REQS="$ROOT/backend/requirements-lambda.txt"

rm -rf "$PKG" "$OUT/backend.zip"
mkdir -p "$PKG"

echo "==> Installing Linux wheels of $(basename "$REQS")"
if command -v uv >/dev/null; then
  uv pip install --quiet --target "$PKG" --python-version 3.12 \
    --python-platform x86_64-manylinux2014 --only-binary :all: -r "$REQS"
else
  python3 -m pip install --quiet --target "$PKG" --python-version 3.12 \
    --platform manylinux2014_x86_64 --implementation cp --only-binary=:all: -r "$REQS"
fi

echo "==> Adding the backend"
cp -R "$ROOT/backend/app" "$ROOT/backend/lambda_handler.py" "$ROOT/backend/traffic_refresh.py" "$PKG/"
find "$PKG" -name __pycache__ -type d -prune -exec rm -rf {} +
# the local .env (with the LTA key) must never ship; Lambda gets its settings from Terraform
rm -f "$PKG/.env" "$PKG/app/.env"

(cd "$PKG" && zip -qr -X "$OUT/backend.zip" .)
echo "==> Built infra/build/backend.zip ($(du -h "$OUT/backend.zip" | cut -f1))"
