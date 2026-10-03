#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Starting ColdRoute SG backend on http://localhost:8000 ..."
(
  cd "$ROOT/backend"
  python -m uvicorn app.main:app --reload --port 8000
) &
BACKEND_PID=$!

trap 'kill $BACKEND_PID 2>/dev/null || true' EXIT

echo "Starting frontend on http://localhost:5173 ..."
cd "$ROOT/frontend"
npm run dev
