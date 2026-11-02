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
- [x] Easier editing: times and unloading minutes are picked from lists (typing still works, **Custom…** for odd durations), and every `Segmented` switch is drawn as outlined buttons so the options read as clickable.
- [x] LTA cameras open in the app instead of downloading: clicking a thumbnail (Conditions panel or stop card) shows the full image with the camera's number, place, capture time and distance to the nearest stop. data.gov.sg serves the images as `application/octet-stream`, so a plain link only downloaded them.

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
- [x] LTA DataMall traffic speed bands replace the guessed traffic risk. The backend reads every stretch with `LTA_ACCOUNT_KEY` and serves a ~1 km grid of delay factors (`/api/traffic/grid`); Live mode scales each leg's drive time by it when the run leaves within an hour of the reading. Free flow is each stretch's own lower-quartile speed over five night readings (29 Oct 2026), and each cell compares road-weighted speeds so reading noise cancels: 0.4% slowdown remains on empty roads, against 31% with one speed per road category. Minor and small roads are left out (see the root README). Still to do: deploy the traffic service, re-measure the daytime effect, and rebuild the baseline from more nights.
- [ ] LTA cameras: shown in the Conditions panel and on the stop card, and enlarged in the app, but data.gov.sg serves only 8 cameras today (Woodlands and Tuas checkpoints, and Sentosa Gateway), so most stops have none nearby.
- [x] OneMap search for addresses. Called from the browser without a token; a new stop gets its nearest NEA area and HDB carpark straight away.
- [x] OSRM at runtime: one table call for the run's drive times as stops are added, one route call per plan for the road geometry. Falls back to an estimate (and says so) if OSRM is down. The sample run still uses the bundled snapshot.
- [x] Depot picker: choose a Singapore depot through OneMap search, keep it across reloads, and plan from its own OSRM road matrix; **Load sample** restores Jurong Cold Store.
- [ ] Mark a stop delivered and re-plan the rest from there (the old console's "Set current location here").

### 4. Optimiser

- [x] Search above 8 stops: the shortest route is exact (Held–Karp), and the ColdRoute plan uses 2-opt, Or-opt and swap moves from the shortest-route, entered, earliest-deadline and nearest-neighbour orders. Against exhaustive search on 80 random 9-stop runs (Balanced and Pharma) it found the optimum in 78 (worst 3.4% above, never more late stops) and on all 10 random 10-stop runs; 2-opt from the entered order found 29 of the 80 (worst 47%). About 50 ms for 15 stops on a dev machine. Real-data scenario evaluation is still separate work.
- [x] Unit tests on fixed scenarios: rain, parking crunch, tight pharma window, checked against the normalised objective. Vitest also covers window waits, rain interval boundaries, light vs heavy rain, cargo sensitivity, weight validation, empty/single runs, 8-stop exhaustive search, 10/15-stop integrity and the recorded sample; the node:test suite covers the objective scales, profiles, depot picker and CSV export. `make test` and GitHub Checks run both. Performance and optimality evaluation are still separate work.
- [ ] Explanations generated from cost differences, checked against the position change.

### 5. AWS (the cloud part of the course)

- [ ] API Gateway + Lambda for the backend (`backend/lambda_handler.py` is a start).
- [ ] DynamoDB for runs, versions and results.
- [ ] S3 for recorded condition snapshots and experiment exports.
- [ ] EventBridge to refresh conditions on a schedule. `backend/traffic_refresh.py` is ready for the road-speed grid (EventBridge → Lambda → S3, see [deployment.md](deployment.md#live-traffic-service)), not deployed yet.
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
