# Roadmap and to-dos

Update this file in the same PR as the work. Tick items off; don't delete them.

## Done

- [x] Preliminary report submitted (28 Sep 2026). See [preliminary-proposal.md](preliminary-proposal.md).
- [x] Python + FastAPI local MVP with public data.gov.sg feeds and OSRM (`backend/`).
- [x] New dispatcher console (PR #1): workspace, three views, KPIs, explanations, timeline, Singapore map, share and account mocks, phone layout, light and dark.
- [x] Project docs (this folder).
- [x] New console deployed by hand to Amplify: https://main.daledp6z7ncmz.amplifyapp.com/ (`make deploy`, see [deployment.md](deployment.md)).
- [x] CI with GitHub Actions: Checks on every PR, and every merge to `main` deploys the frontend to Amplify (see [deployment.md](deployment.md)).
- [x] Live public feeds back in the new console: **Live data / Recorded** switch, the Conditions panel (NEA forecast, HDB carparks, LTA cameras), plans built on live rain and parking, Journey/Weather/Parking/Camera details on the stop card, late-delivery alert. The browser calls data.gov.sg directly; no backend needed.
- [x] Real stops: OneMap address search (any building, street or postal code), real OSRM drive times and road geometry for new stops, **Load sample** / **Clear**, the run kept across reloads, at most 15 stops per run.

## Next, in priority order

### 1. Deploy what we have

- [x] Find out how the old demo was deployed: by hand, no CI and no keys in the repo. Details in [deployment.md](deployment.md).
- [x] One-off manual deploy of the new console from a local machine (`make deploy`).
- [x] CI: GitHub Actions deploys on merge to `main`, using the `coldroute-deployer` key stored as repository secrets.
- [ ] Ask the repo owner (legolas456) to require the Checks before merging into `main`. Only the owner can set branch protection. See [deployment.md](deployment.md#still-open).
- [x] Add the live demo link and a short "real vs mocked" note to the root README.

### 2. Connect the frontend and the backend

- [ ] Call the backend optimise endpoint from the frontend, keeping the shapes in `frontend/src/lib/types.ts`.
- [x] Keep the current in-browser data as the fallback ("Recorded" mode) so the demo never breaks. Recorded is the default; Live is one click away in the top bar, or `?data=live`.
- [x] Show data mode and snapshot time in the top bar.

### 3. Real data

- [x] NEA 2-hour forecast → rain risk per stop and time slot. Each NEA area forecasting rain becomes a rain cell for the forecast's 2-hour period; each stop takes its nearest area.
- [x] HDB carpark availability → parking risk. Used only when an HDB carpark is within 600 m; otherwise the stop keeps its own loading bay. Coordinates are a snapshot (`npm run data:hdb-carparks`), free lots are live.
- [ ] LTA DataMall traffic speed bands (needs a free AccountKey) to replace the traffic-camera proxy.
- [ ] LTA cameras: shown in the Conditions panel and on the stop card, but data.gov.sg serves only 8 cameras today (Woodlands and Tuas checkpoints), so most stops have none nearby.
- [x] OneMap search for addresses. Called from the browser without a token; a new stop gets its nearest NEA area and HDB carpark straight away.
- [x] OSRM at runtime: one table call for the run's drive times as stops are added, one route call per plan for the road geometry. Falls back to an estimate (and says so) if OSRM is down. The sample run still uses the bundled snapshot.
- [ ] Depot picker: the depot is fixed to Jurong Cold Store.
- [ ] Mark a stop delivered and re-plan the rest from there (the old console's "Set current location here").

### 4. Optimiser

- [ ] Today: exhaustive search up to 8 stops, 2-opt from the input order above that. Seed 2-opt with earliest-deadline or nearest-neighbour (as in the proposal) and check results at 10 and 15 stops.
- [ ] Unit tests on fixed scenarios: rain, parking crunch, tight pharma window.
- [ ] Explanations generated from cost differences, checked against the position change.

### 5. AWS (the cloud part of the course)

- [ ] API Gateway + Lambda for the backend (`backend/lambda_handler.py` is a start).
- [ ] DynamoDB for runs, versions and results.
- [ ] S3 for recorded condition snapshots and experiment exports.
- [ ] EventBridge to refresh conditions on a schedule.
- [ ] Cognito sign-in to replace the mock account.
- [ ] CloudWatch metrics: latency, errors, cost per optimisation.
- [ ] If AWS Educate blocks a service, use the alternative listed in the proposal and note it.

### 6. Evaluation

- [ ] Scenario experiments: ColdRoute vs shortest route on late deliveries, lateness, exposure, drive time.
- [ ] Performance: optimisation time for 5, 10 and 15 stops; API p50/p95; error rate.
- [ ] Cost per optimisation and a monthly projection.
- [ ] Usability study with 8–12 users: tasks T1–T5 and SUS.

### 7. Final deliverables

- [ ] Final report.
- [ ] Slides.
- [ ] Demo video (follow the script in [product-design.md](product-design.md#demo)).

## Later, if there's time

What-if panel, runs list, system page, driver app, tracking page, live playback. See [product-design.md](product-design.md#ideas-we-may-still-build).

## Open questions

- Which AWS account type do we deploy to, and which services does it allow?
- Final deadline and demo format (live or recorded)?
- Who owns each section above?
