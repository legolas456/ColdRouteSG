# ColdRoute SG: common commands. Run `make help` from the repo root.
# Windows without make: see the commands in README.md, or use run_local.bat.

PY      ?= python3
VENV    := backend/.venv
VPY     := $(VENV)/bin/python
NPM     := npm --prefix frontend

.DEFAULT_GOAL := help
.PHONY: help setup env dev frontend backend test test-backend typecheck build preview deploy deploy-only

help: ## List commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  make %-13s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: env ## Install backend (venv) and frontend dependencies
	test -x $(VPY) || $(PY) -m venv $(VENV)
	$(VPY) -m pip install -q --upgrade pip
	$(VPY) -m pip install -q -r backend/requirements.txt
	$(NPM) ci --no-audit --no-fund

env: ## Create local env files from the examples (never overwrites)
	@test -f backend/.env || { cp backend/.env.example backend/.env && echo "created backend/.env"; }
	@test -f .env.deploy.local || { cp .env.deploy.example .env.deploy.local && echo "created .env.deploy.local"; }

dev: ## Run backend (:8000) and frontend (:5173) together
	@trap 'kill 0' EXIT; \
	(cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000) & \
	$(NPM) run dev

frontend: ## Frontend only, http://localhost:5173
	$(NPM) run dev

backend: ## Backend only, http://localhost:8000/docs
	cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000

test: test-backend typecheck ## Backend tests + frontend type check

test-backend: ## Backend pytest
	cd backend && .venv/bin/python -m pytest -q

typecheck: ## Frontend TypeScript check
	$(NPM) run typecheck

build: ## Production build of the frontend into frontend/dist
	$(NPM) run build

preview: build ## Serve the production build locally, http://localhost:4173
	$(NPM) run preview

deploy: ## Build and upload the frontend to AWS Amplify (needs the AWS profile, see docs/deployment.md)
	./scripts/deploy-frontend.sh

deploy-only: ## Upload the existing frontend/dist without rebuilding
	SKIP_BUILD=1 ./scripts/deploy-frontend.sh
