# ColdRoute SG

ColdRoute SG plans delivery runs for **temperature-sensitive goods in Singapore**. It orders a van's stops to balance driving time, booked delivery slots, rain at each stop, parking and how long the cargo stays on board, using live public data: the NEA rain forecast, HDB and LTA carpark availability, and LTA road speeds. The frontend is **React + TypeScript + Vite + Tailwind CSS + MapLibre**, a single-screen dispatcher console. See [`frontend/README.md`](frontend/README.md); UI conventions are in [`frontend/AGENTS.md`](frontend/AGENTS.md). The backend is **Python + FastAPI**, run on AWS Lambda, and the whole AWS stack is Terraform in [`infra/`](infra/README.md).

Project background, the preliminary proposal, product design, brand and to-dos are in [`docs/`](docs/README.md).
New to the team? Start with [`docs/contributing.md`](docs/contributing.md): which demo to use, what's real or mocked, local setup and a safe first PR.

**Live demo:** https://main.d1f8mppryelp5v.amplifyapp.com/ (the dispatcher console on AWS Amplify, deployed with the rest of the AWS stack by `terraform apply`, see [`infra/README.md`](infra/README.md)). Road geometry comes from OSRM in the browser and from Amazon Location Service for cloud plans. **Live data** (the *Plan with* switch in the Conditions panel, opened from the top bar) plans with the live NEA forecast and HDB carpark availability from data.gov.sg; the default **Recorded** mode replays a rainy sample morning. Stops come from a real OneMap address search, with OSRM drive times and roads. Live traffic comes from LTA road speeds when the traffic service is running (see [Live traffic](#live-traffic-lta-traffic-speed-bands)); otherwise drive times assume free-flowing traffic and the app says so. Sign-in uses Cognito accounts that an admin creates, and every plan a signed-in user makes is saved to their route history in DynamoDB. Signed in on Live data, the run is planned on AWS Lambda with drive times from Amazon Location Service; otherwise the same optimiser runs in the browser.

The app does **not require any API key or registration** to run locally. Live road speeds are optional and need a free LTA DataMall AccountKey on the backend.

## Quick start

From the repo root (macOS / Linux, needs Python 3.11 or 3.12, Node 22 and `make`; CI uses Python 3.11 and the Lambdas run 3.12; the frontend's Node tests need Node 22):

| Command | What it does |
| --- | --- |
| `make setup` | Creates `backend/.venv`, installs backend and frontend dependencies, creates local env files |
| `make dev` | Backend on http://localhost:8000 and frontend on http://localhost:5173 together |
| `make frontend` / `make backend` | Just one of them (the console works without the backend) |
| `make test` | Backend `pytest`, frontend optimiser unit tests and TypeScript check |
| `make build` / `make preview` | Production build into `frontend/dist`, and serve it on http://localhost:4173 |
| `make deploy` | Deploy by hand (CI normally does this on merge). Needs the `coldroute` AWS profile, see [`docs/deployment.md`](docs/deployment.md) |

`make help` lists them all. Local env files (`backend/.env`, `.env.deploy.local`) are created from the `*.example` files and ignored by git. AWS keys never go in the repo. On Windows without `make`, use the manual steps below or `run_local.bat`.

## What is included

- Delivery planner with a selectable depot (OneMap search; **Load sample** restores Jurong Cold Store) and up to 15 editable stops
- Cargo type per stop (Pharma, Frozen, Chilled)
- Booked delivery slot (time window) and service duration per stop
- Three optimisation profiles: Pharma, Balanced and Fastest
- Comparison with the shortest-drive route, and a CSV export of the plan
- Invite-only sign-in (Cognito), saved runs per user and an admin view of the team's activity
- 2-hour Singapore weather forecast from data.gov.sg
- HDB live carpark availability from data.gov.sg
- HDB carpark locations from the data.gov.sg datastore
- LTA traffic-camera images from data.gov.sg
- Public OSRM route matrix and route geometry
- CARTO basemap tiles (Positron and Dark Matter) for the map
- OneMap address search for stops and the depot
- Route sequencing on five normalised terms: drive time, lateness, rain, parking and cold-chain exposure, with drive times scaled by live LTA road speeds when available; in the browser, or on AWS Lambda (`planner/`) for a signed-in user on Live data
- Live road speeds from LTA DataMall Traffic Speed Bands, summarised by the backend (`GET /api/traffic/grid`)
- FastAPI Swagger docs at `/docs`
- Built-in fallback data so the app remains demo-able when an external public endpoint is temporarily unavailable

## Live traffic (LTA Traffic Speed Bands)

LTA DataMall publishes a speed band (1 to 8, in 10 km/h steps) for every stretch of expressway and arterial road every 5 minutes. The API is free but needs an AccountKey ([request one](https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html); terms: Singapore Open Data Licence). Each key has a call quota that LTA does not publish. On 29 Oct 2026 ours was refused (HTTP 500, `QuotaViolation`) after about 3,000 calls within an hour and worked again 25 minutes later, so it is about 3,000 calls an hour; a full reading is 288 calls, so the scheduled refresh reads every 10 minutes and nothing else should read LTA. The key must stay on a server, so:

1. **Backend** (`backend/app/services/traffic.py`) reads every page of `v4/TrafficSpeedBands`: about 144,000 stretches in 288 pages of 500, 16 pages at a time, retrying a page that fails for a moment; 3–6 s on 27 Oct 2026. For each cell of 0.01° (about 1.1 km) it divides its roads' free-flow speed by their speed now, both averaged by road length: the cell's delay factor, from 1 to 3. It serves the grid at `GET /api/traffic/grid`, cached for 5 minutes and stamped with LTA's own `lastUpdatedTime`; on AWS the API serves the grid the scheduled refresh publishes to S3 instead (item 5), so only the refresh holds the key. With no key it answers 503 and says why.
2. **Which roads, and what counts as free flow**: expressways, major arterials, arterials, slip roads and short tunnels, about 43,000 stretches. A stretch's free flow is its own speed on empty roads: the lower quartile (the second slowest) of five readings taken from 02:50 to 04:20 on 29 Oct 2026, kept in `backend/app/data/speed_baseline.json`. One speed per road category does not work: at 02:50 a quarter of arterial and slip-road length still read 1.5 times slower than its category's speed (junctions and bends, not traffic), which added 31% to the empty-road sample run. Night readings flicker between bands, so a cell compares average speeds, in which the flicker cancels: on held-out night readings 0.4% of slowdown remains (4% against the median night speed, at the cost of daytime slowdowns reading about 5% smaller). A stretch the baseline does not know uses its category's speed (75, 55, 45, 55 and 45 km/h, the 85th-percentile band speeds of two daytime readings on 27 Oct). Minor arterials and small roads are left out: their bands were the same at both daytime readings, with a third of small roads under 10 km/h, so they show stop-start between junctions (already in OSRM's times), not traffic.
3. **Console** (`frontend/src/lib/traffic.ts`) reads the grid in Live mode when `VITE_TRAFFIC_URL` is set. Each leg's OSRM drive time is multiplied by the mean factor at points every 0.5 km along the straight line between its ends (each point looks at the 3 × 3 cells around it; with under 1 km of monitored road nearby, the slowdown is scaled down). The shortest route and the ColdRoute plan both use these times. A stop shows "+N min traffic" when traffic adds 3 minutes or more to its approach. The map draws the plan's road in rose where the roads around it run 1.2 times their free-flow time or slower, and the Conditions panel's slow share counts the same. Against each road's own night speed, a weekday peak is about 1.1 to 1.3 times slower around most roads: on the readings of 29 and 30 Oct 2026, 1.2 times marked 14% of the sample route at the morning and evening peaks, 2% at midday and none at night, while 1.5 times would have marked nothing.
4. **When it applies**: one reading stands for the whole run, so it is used only if it is under 20 minutes old and the run leaves within 60 minutes of it. Otherwise the plan uses the typical traffic of the departure's weekday or weekend slot (item 6), or free-flowing drive times when that slot has none yet, and the Conditions panel says which. Recorded mode never uses live traffic.
5. **Scheduled refresh** (`backend/traffic_refresh.py`): a Lambda that EventBridge runs every 10 minutes to publish the grid to S3, so no request waits on LTA. It also keeps every reading in `traffic/history/` (one band digit per stretch, about 13 KB gzipped, filed under LTA's own time), the raw material for typical traffic at any time of the week. A used-up quota is reported as such and not retried. See [docs/deployment.md](docs/deployment.md#live-traffic-service).
6. **Typical traffic** (`backend/app/services/typical.py`, `backend/traffic_profile.py`): a Lambda that EventBridge runs each night at 02:30 groups the last four weeks of kept readings by weekday or weekend and 15-minute slot of Singapore time, and publishes one grid per slot to `traffic/typical/`: each cell's median factor, from at least 3 readings, so one odd day does not set it. `GET /api/traffic/typical?at=<departure>` serves the slot a departure falls in, or says why there is none yet (404). Public holidays count as weekdays for now.

Limits to state in the report: free flow comes from five readings on one night, not a longer history, and errs low, so slowdowns read slightly small; a leg follows the straight line between stops, not its road, when it is scored; traffic is taken at departure, not predicted for later legs; minor and small roads count as free-flowing. Camera images are context only.

To run it locally, put `LTA_ACCOUNT_KEY=...` in `backend/.env` (git-ignored), start the backend, and run the frontend with `VITE_TRAFFIC_URL=http://localhost:8000/api/traffic/grid npm run dev`. `python -m app.services.traffic --out grid.json` (from `backend/`) saves a snapshot; add `--raw night1.json` to keep the raw records, and `python -m app.services.traffic --baseline night*.json --out app/data/speed_baseline.json` rebuilds the night baseline from readings taken between 2 and 5 am.

## Public endpoints used

No credentials are supplied by the project.

| Purpose | Endpoint |
|---|---|
| 2-hour weather forecast | `https://api.data.gov.sg/v1/environment/2-hour-weather-forecast` |
| HDB carpark availability | `https://api.data.gov.sg/v1/transport/carpark-availability` |
| URA and mall carpark availability | LTA DataMall `CarParkAvailabilityv2` (AccountKey; read by the scheduled refresh, served at `/api/parking/carparks`) |
| LTA traffic camera images | `https://api.data.gov.sg/v1/transport/traffic-images` |
| HDB carpark information | `https://data.gov.sg/api/action/datastore_search?resource_id=d_23f946fa557947f93a8043bbef41dd09` |
| Address search | `https://www.onemap.gov.sg/api/common/elastic/search` |
| Route matrix / routing (browser) | `https://router.project-osrm.org` |
| Route matrix / routing (cloud planner) | Amazon Location Service (`CalculateRouteMatrix`, `CalculateRoutes`), with the stack's own AWS role |
| Map tiles | `https://basemaps.cartocdn.com/gl/{positron,dark-matter}-gl-style/style.json` |
| Live road speeds (backend only, needs `LTA_ACCOUNT_KEY`) | `https://datamall2.mytransport.sg/ltaodataservice/v4/TrafficSpeedBands` |

`data.gov.sg` allows public API use without a key; creating a key is optional for higher rate limits. The public OSRM server is appropriate for a low-volume student prototype, not production use.

## Project structure

```text
ColdRouteSG/
├─ README.md
├─ Makefile                setup, dev, test, build, deploy
├─ run_local.sh / run_local.bat
├─ .github/workflows/      checks.yml: frontend, planner, backend and Terraform checks on every PR
├─ frontend/               the dispatcher console (see frontend/README.md)
│  ├─ src/App.tsx
│  ├─ src/components/      Shell, StopsEditor, ResultsPanel, MapView, StopCard, Timeline,
│  │                       ConditionsPanel, SavedRuns, Account, SharePopover, ...
│  ├─ src/lib/             optimizer, objective, profiles, explain, live, traffic, roads,
│  │                       planner (cloud), auth, history, api, ...
│  ├─ src/data/            sample run, OSRM snapshot, HDB carparks, NEA areas, Singapore mask
│  ├─ src/lib/__tests__/   Vitest unit tests
│  ├─ tests/               Node tests
│  └─ scripts/             refresh the bundled data
├─ planner/                the console's optimiser on AWS Lambda for POST /api/plan (see planner/README.md)
├─ backend/                FastAPI on Lambda: public data, traffic, carparks, saved runs, admin
│  ├─ app/routers/         data, traffic, parking, routes, admin
│  ├─ app/services/        traffic, typical, parking, dynamodb, auth, cognito_users, public_apis, ...
│  ├─ traffic_refresh.py   scheduled LTA road-speed and carpark refresh (Lambda)
│  ├─ traffic_profile.py   nightly typical-traffic build (Lambda)
│  └─ tests/               pytest
├─ infra/                  Terraform for the whole AWS stack (see infra/README.md)
└─ docs/                   project brief, product design, deployment, contributing, roadmap
```

# Run locally

## Prerequisites

- Python 3.11
- Node.js 22
- npm

## 1. Backend

### Windows PowerShell / Command Prompt

```bash
cd ColdRouteSG\backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

### macOS / Linux

```bash
cd ColdRouteSG/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

Backend URLs:

- API: `http://localhost:8000`
- Swagger: `http://localhost:8000/docs`
- Health: `http://localhost:8000/api/health`

## 2. Frontend

Open a second terminal:

```bash
cd ColdRouteSG/frontend
npm install
npm run dev
```

Open:

`http://localhost:5173`

The console runs on its own. It uses OneMap search, OSRM (a bundled snapshot for the sample run, live calls for new stops), live data.gov.sg feeds read straight from the browser (or the recorded sample morning) and an in-browser optimiser, so the backend is optional for the demo. Without `VITE_API_BASE_URL` and the `VITE_COGNITO_*` settings there is only the demo account and nothing is saved; with them (set by `infra/`, see [`infra/README.md`](infra/README.md)), sign-in is real, plans go to the route history, and a signed-in user's Live plans are made by the cloud planner. Try `?state=results` (open on the plan), `?data=live` (live feeds) or `?theme=dark`.

## 3. Optional convenience launchers

After installing the backend and frontend dependencies once:

### Windows

Double-click or run:

```text
run_local.bat
```

### macOS / Linux

```bash
./run_local.sh
```

# API endpoints

Everything is behind one API Gateway. Signed-in routes need a Cognito token; `admin` routes also need the `admin` group. The full list with request and response schemas is at `/docs` on a local backend.

| Route | Who | What |
|---|---|---|
| `GET /api/health` | public | Health check |
| `GET /api/data/...` | public | Weather, HDB carparks, traffic cameras, location search |
| `GET /api/traffic/grid`, `GET /api/traffic/typical` | public | Live and typical LTA road-speed grids |
| `GET /api/parking/carparks` | public | URA and mall carpark availability from LTA |
| `POST /api/plan` | signed in | Cloud planner (Lambda in `planner/`, not FastAPI) |
| `POST/GET/DELETE /api/routes/history...` | signed in | Saved runs, only the user's own |
| `GET /api/admin/...` | admin | Team activity and each dispatcher's runs |
| `POST /api/routes/optimize` | signed in | v1 backend optimiser, kept for reference; the console does not use it |


## Health

```http
GET /api/health
```

## Current weather

```http
GET /api/data/weather
```

Returns the latest 2-hour forecast, coordinates for forecast areas, and a simple weather-risk score.

## Parking network summary

```http
GET /api/data/parking
```

## Nearest HDB carpark

```http
GET /api/data/parking/nearby?lat=1.2937&lng=103.7831
```

The backend joins HDB carpark location information to the live carpark-availability feed. HDB locations use SVY21 coordinates and are converted to WGS84 using `pyproj`.

## Traffic cameras

```http
GET /api/data/traffic-cameras?limit=8
```

## Nearby traffic cameras

```http
GET /api/data/traffic-cameras/nearby?lat=1.2937&lng=103.7831&limit=4
```

## Live road speeds

```http
GET /api/traffic/grid
```

The LTA road-speed grid the console applies to drive times (see [Live traffic](#live-traffic-lta-traffic-speed-bands)): `fetchedAt`, `origin`, `cellDeg`, `stretches`, `slowShare` and `cells` as `[i, j, factor, road km]`. 503 with a reason when no key is configured or LTA does not respond.

## Optimise a route (v1 backend optimiser)

```http
POST /api/routes/optimize
Content-Type: application/json
```

Example:

```json
{
  "depot": { "lat": 1.3344, "lng": 103.7437 },
  "depot_name": "Jurong Cold Storage Depot",
  "departure_time": "08:30",
  "stops": [
    {
      "id": "NUH",
      "name": "National University Hospital",
      "lat": 1.2937,
      "lng": 103.7831,
      "service_minutes": 12,
      "cold_chain_priority": 1.0,
      "traffic_risk": 0.55,
      "window_end": "10:00"
    }
  ],
  "weights": {
    "travel": 1.0,
    "weather": 0.7,
    "parking": 0.7,
    "traffic": 0.8,
    "cold_chain": 1.0,
    "lateness": 1.2
  }
}
```

# Optimisation logic

The console's optimiser is `frontend/src/lib/optimizer.ts`. The same code runs in the browser and in the cloud planner (`planner/`). A plan's cost is a weighted sum of five terms, each divided by a fixed per-stop scale so the weights are comparable (`frontend/src/lib/objective.ts`):

| Term | What it counts |
|---|---|
| Drive | Minutes of driving |
| Lateness | Minutes past each stop's booked slot |
| Rain | Unloading that overlaps forecast rain over the stop's area (heavy rain counts double) |
| Parking | Each stop's parking risk times its unloading time |
| Cold chain | Each stop's time on board, weighted by cargo (Pharma 1.0, Frozen 0.8, Chilled 0.6) |

The weights come from the profile the dispatcher picks (`frontend/src/lib/profiles.ts`): Pharma, Balanced or Fastest. Fastest is drive time only.

- **Up to 8 stops:** every order is tried, so the plan is exact.
- **9–15 stops:** local search (moving 1–3 stops, 2-opt reversals and swaps) from four starting orders: the shortest-drive route, the entered order, earliest deadline first and nearest neighbour. Because the shortest-drive route is one of the starts, the plan never scores worse than it.
- **The shortest-drive route** shown for comparison is exact for up to 15 stops (Held–Karp).

`frontend/eval/` measures route quality on 60 fixed scenarios against the shortest route, earliest deadline first and a planner that only meets booked slots (`npm run eval`, see its README).

## v1 backend optimiser

The first prototype's optimiser is still in the backend (`backend/app/services/optimization.py`, `POST /api/routes/optimize`). The console does not use it. It builds the route greedily: for each candidate next delivery it adds up a composite cost of roughly this form:

```text
score =
  travel_weight     × travel_minutes
+ weather_weight    × weather_risk
+ parking_weight    × parking_risk
+ traffic_weight    × traffic_risk
+ cold_chain_weight × time-sensitive cold-chain exposure
+ lateness_weight   × projected_lateness
```

### Weather risk

Forecast text is mapped to an ordinal risk score. For example, thundery/heavy-rain conditions receive a larger penalty than cloudy/fair conditions.

### Parking risk

For each delivery, the backend finds the nearest HDB carpark and combines:

- occupancy level; and
- distance from the delivery point.

A nearly full or distant carpark receives a larger delivery penalty.

### Cold-chain risk

A cold-chain-priority stop receives a larger penalty the longer it remains undelivered. This encourages highly temperature-sensitive deliveries to move earlier when other constraints are similar.

### Lateness

If the projected arrival is later than the stop's specified time-window end, a lateness penalty is added.

# Fallback behaviour

The backend defaults to:

```text
ALLOW_MOCK_FALLBACK=true
```

If an external public API is unreachable, the backend returns demo data for that component and marks the result as `mock` or `mixed`. This is useful for classroom demos and local development.

To fail instead of falling back:

1. copy `backend/.env.example` to `backend/.env`;
2. set:

```text
ALLOW_MOCK_FALLBACK=false
```

# Testing

From the repo root, `make test` runs backend pytest, the frontend tests (node:test in `frontend/tests/` and Vitest in `frontend/src/**/__tests__/`) and TypeScript checks. `make test-frontend` runs only frontend tests; from `frontend/`, use `npm test` or `npm run test:watch`. The frontend tests use fixed scenarios and bundled roads, never live APIs. See [`docs/contributing.md`](docs/contributing.md#test-commands) for coverage and limits.

The cloud planner's tests are separate (`make test` doesn't run them): from `planner/`, `npm test` and `npm run typecheck`. GitHub Actions runs the frontend, planner, backend and Terraform checks on every pull request. The route-quality evaluation (`frontend/eval/`, `npm run eval`, about 30 s) is not part of the tests.

For backend tests alone, from `backend/`:

```bash
pytest
```

# AWS status

[`infra/`](infra/README.md) creates the whole stack with Terraform:

| Part | On AWS |
|---|---|
| Console (React/Vite) | Amplify Hosting (see [`docs/deployment.md`](docs/deployment.md)) |
| Sign-in | Cognito user pool, invite-only; the `admin` group also sees the team's activity |
| API | API Gateway HTTP API, which checks the Cognito token, in front of FastAPI on Lambda (Mangum) and the planner |
| Cloud planner | Lambda (Node.js 22, `planner/`) behind the signed-in `POST /api/plan`: the console's own optimiser, with drive times from Amazon Location Service cached per pair in DynamoDB |
| Saved runs | DynamoDB route history, keyed by the signed-in user |
| Live traffic | EventBridge runs a Lambda that publishes the LTA road-speed grid to S3 |
| Logs and metrics | CloudWatch, with a dashboard |

An earlier copy of this backend, deployed by hand in a teammate's AWS account before `infra/` existed, is retired; the console does not use it. `backend/lambda_handler.py` is the entry point of the current API Lambda.

# Design note

The local MVP deliberately separates **external data acquisition** from **delivery optimisation**. The external services provide context, while ColdRoute SG owns the route-scoring logic and user interface. This makes it easier to explain what technical value the project itself contributes.
