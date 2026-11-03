#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

# the backend's packages live in the virtualenv that `make setup` creates
PY="$ROOT/backend/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "backend/.venv is missing: run 'make setup' first." >&2
  exit 1
fi

echo "Starting ColdRoute SG backend on http://localhost:8000 ..."
(
  cd "$ROOT/backend"
  "$PY" -m uvicorn app.main:app --reload --port 8000
) &
BACKEND_PID=$!

trap 'kill $BACKEND_PID 2>/dev/null || true' EXIT

echo "Starting frontend on http://localhost:5173 ..."
cd "$ROOT/frontend"
npm run dev
