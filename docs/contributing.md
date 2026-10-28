# Joining ColdRoute SG

ColdRoute SG is the CS5224 Cloud Computing Group 36 prototype for planning temperature-sensitive deliveries in Singapore. Its current scope is one depot, one van and up to 15 stops. It compares a shortest-drive route with a route that also considers delivery windows, rain, parking and modelled cold-chain exposure.

## Which website should I use?

Use **[the current dispatcher console](https://main.daledp6z7ncmz.amplifyapp.com/)**. It is built from `frontend/` on `main`, and GitHub Actions uploads new frontend builds to AWS Amplify.

The [older site with `production` in its address](https://production.d3afn54umnn6ms.amplifyapp.com/) is the pre-redesign demo. Its branch name does not make it the current release. Do not judge the current code against that UI. Deployment history and ownership are in [deployment.md](deployment.md).

## What is real, and what is still a prototype?

The frontend searches Singapore addresses through OneMap and gets road times and geometry through OSRM. Live mode reads NEA weather, HDB parking availability and LTA camera images through data.gov.sg. Recorded mode uses a curated sample morning and bundled road data, making the demo repeatable.

The optimiser currently runs **in the browser**: exhaustive search through eight stops; above that, an exact shortest route and a local search (2-opt, Or-opt and swap moves) for the ColdRoute plan. The FastAPI backend has separate optimisation and data endpoints but is not connected to this redesigned UI yet. The depot can be any Singapore address found through OneMap; **Load sample** restores Jurong Cold Store.

Traffic comes from LTA road speeds when the traffic service runs (backend with an LTA key, console with `VITE_TRAFFIC_URL`); otherwise drive times assume free-flowing traffic, and the app says so. Camera images do not calculate speed. Exposure is a modelled risk indicator, not a temperature measurement. Sign-in is real when the console is built with the Cognito settings from `infra/` (otherwise only the demo account, which never leaves the browser); dispatch is still a demonstration, not a message sent to a driver. A share link is not a production access-control system.

## Set up a fresh working copy

You need repository access, Git, Node **22** (matching `frontend/.nvmrc`), npm, Python **3.11** (matching CI), and `make` on macOS/Linux. Prefer those versions rather than the newest Python or an old Node 20 release: pinned Python packages may lack wheels on a new interpreter, and Vite needs Node >=20.19 or a compatible Node 22 release.

```bash
git clone https://github.com/legolas456/ColdRouteSG.git
cd ColdRouteSG
git switch -c test/my-first-contribution

# If you use nvm:
nvm install "$(cat frontend/.nvmrc)"
nvm use "$(cat frontend/.nvmrc)"

# Point PY at your installed Python 3.11 if it is not the default.
make setup PY=python3.11
make test
make build
```

`make setup` installs Python packages inside `backend/.venv` and frontend packages inside `frontend/node_modules`. It creates ignored local environment files from examples without overwriting existing ones. You do **not** need AWS credentials or a paid API to develop locally.

Run `make frontend` for the console at http://localhost:5173. It works without the backend. For backend work, use a second terminal with `make backend`; the API documentation is at http://localhost:8000/docs and health check at http://localhost:8000/api/health. Stop a development server with Ctrl+C in its terminal.

On Windows without `make`, use the manual backend/frontend instructions in the root [README](../README.md); run `npm test` and `npm run build` from `frontend/`, and `.venv\Scripts\python -m pytest -q` from `backend/`.

## Understand the demo in five minutes

1. Open the current console or your local frontend, leaving **Recorded** mode selected.
2. Inspect a stop's time window, unloading minutes and cargo. The input order is not the delivery order.
3. Select **Pharma** and click **Optimise route**. Read the late-delivery, exposure and driving-time comparison.
4. Switch to **Compare**, click a stop, and inspect its timeline and explanation.
5. Open the top-bar data pill. Switch to **Live data** and set departure to **Now** when investigating today's forecast. A two-hour forecast does not establish weather outside its validity period.

Treat recorded results as a worked example, not measured proof of savings. See [roadmap.md](roadmap.md) for the evaluation work still needed.

## Where should I contribute?

**Tests and evaluation** are a useful first ownership area. The frontend tests cover scoring, tight pharma windows, rain overlaps, a parking crunch, cargo sensitivity, the recorded sample, and ten/fifteen-stop integrity. Extend them when a bug is fixed. Measure ColdRoute against the shortest route on fixed scenarios; record assumptions and results without claiming real-world savings.

For **UI work**, read [`frontend/AGENTS.md`](../frontend/AGENTS.md) before changing components. Use the existing design tokens and controls. Test light/dark, desktop panel widths and phone layout, and include screenshots for visible changes.

For **backend/cloud work**, first agree with the team on the response contract, chosen AWS account and ownership. The frontend's `types.ts` and the backend's models do not automatically match. Connecting them, adding real accounts and persisting runs are larger tasks, not one-line configuration changes.

Check open pull requests before starting a feature. At the time this guide was added, [PR #10](https://github.com/legolas456/ColdRouteSG/pull/10) proposed live-condition corrections and UX changes, but requested team sign-off before implementation. Do not implement those product decisions without coordination.

## Use a branch, then a pull request

A **branch** keeps your change separate from the live code. A **commit** records a local checkpoint. **Push** uploads that branch to GitHub. A **pull request (PR)** lets the team review it. **Merge** puts it into `main` and may update the live site.

```bash
# Start from an up-to-date main before new work.
git switch main
git pull --ff-only origin main
git switch -c test/clear-description

# After editing:
make test
make build
git diff --check
git status

# Stage only your intended files, then commit and push your branch.
git add <specific-files>
git commit -m "Add a clear description of the change"
git fetch origin
git rebase origin/main  # only if main advanced; stop and ask for help on conflicts
# Re-run tests if rebasing changed the code.
git push -u origin HEAD
# Open a PR on GitHub, or use gh pr create --draft.
```

Never commit directly to `main`, merge someone else's proposal, or run `make deploy` as a setup step. A frontend change merged to `main` triggers the shared AWS deployment; a draft PR does not. Ask the team for review and wait for Checks. Repository branch protection is an owner/admin task, not a collaborator setup step.

Never commit `.env`, AWS keys, `.venv`, `node_modules`, personal local paths or customer-sensitive data. Before pushing, inspect `git diff --cached` and `git status`. Keep the roadmap and relevant docs current in the same PR.

## Test commands

- `make test`: backend pytest, frontend unit tests, then TypeScript check.
- `make test-frontend`: frontend unit tests only.
- From `frontend/`, `npm test`: run both suites once (`tests/*.test.mjs` with node:test, then `src/**/__tests__` with Vitest); `npm run test:watch`: rerun the Vitest tests while editing.
- `make build`: TypeScript check and the production bundle, required before a PR.

The tests call no live APIs. Synthetic tests mock road times; the recorded regression uses the bundled OSRM matrix. They protect expected behaviour, not production correctness, authenticated sharing, real thermal safety, or global optimality above eight stops. Avoid flaky machine-speed assertions; use a separate evaluation to report timings.

## What to tell the team

> I have the current console running locally and understand which parts are real versus mocked. I can own frontend optimiser tests and scenario evaluation. I will coordinate around the live-conditions proposal rather than duplicate it. Can we confirm the final deadline, task owners and report/demo requirements?

You do not need to understand the entire stack before helping. Own a small, testable piece and make its assumptions clear.
