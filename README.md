# ColdRoute SG — Local MVP

ColdRoute SG is a local-first prototype for **cold-chain delivery optimisation in Singapore** using public weather, parking and traffic-camera data. The frontend is **React + TypeScript + Vite + Tailwind CSS + MapLibre**, a single-screen dispatcher console. See [`frontend/README.md`](frontend/README.md); UI conventions are in [`frontend/AGENTS.md`](frontend/AGENTS.md). The backend is **Python + FastAPI**.

Project background, the preliminary proposal, product design, brand and to-dos are in [`docs/`](docs/README.md).
New to the team? Start with [`docs/contributing.md`](docs/contributing.md): which demo to use, what's real or mocked, local setup and a safe first PR.

**Live demo:** https://main.daledp6z7ncmz.amplifyapp.com/ (the dispatcher console on AWS Amplify; GitHub Actions redeploys it on every merge to `main`, see [`docs/deployment.md`](docs/deployment.md)). The road geometry is real OSRM data. **Live data** (top bar) plans with the live NEA forecast and HDB carpark availability from data.gov.sg; the default **Recorded** mode replays a rainy sample morning. Stops come from a real OneMap address search, with OSRM drive times and roads. Traffic is estimated, accounts are mocked, and the optimiser runs in the browser.

The app does **not require any API key or registration** to run locally.

## Quick start

From the repo root (macOS / Linux, needs Python 3.9+, Node ≥ 20.19 and `make`; Python 3.11 and Node 22 match CI):

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

- Current console: fixed Jurong depot and up to 15 editable stops (the backend accepts arbitrary depot coordinates)
- Cold-chain priority per stop
- Delivery time-window end and service duration
- Adjustable optimisation weights
- 2-hour Singapore weather forecast from data.gov.sg
- HDB live carpark availability from data.gov.sg
- HDB carpark locations from the data.gov.sg datastore
- LTA traffic-camera images from data.gov.sg
- Public OSRM route matrix and route geometry
- OneMap public basemap tiles for map display
- Route sequencing using travel time + weather + parking + traffic proxy + cold-chain + lateness penalties
- FastAPI Swagger docs at `/docs`
- Built-in fallback data so the app remains demo-able when an external public endpoint is temporarily unavailable

## Important traffic limitation

The no-registration public datasets on data.gov.sg expose **traffic camera images**, but not the LTA Traffic Speed Bands API used for actual congestion speeds. LTA DataMall speed-band access requires credentials.

Therefore, this MVP:

1. displays public traffic-camera images for operational context; and
2. uses a clearly labelled **traffic-risk input/proxy** for the optimisation score.

This is deliberate. The application does not claim to infer traffic speed from an image. A future version can replace this proxy with LTA DataMall traffic speeds once the team decides to use an authenticated API.

## Public endpoints used

No credentials are supplied by the project.

| Purpose | Endpoint |
|---|---|
| 2-hour weather forecast | `https://api.data.gov.sg/v1/environment/2-hour-weather-forecast` |
| HDB carpark availability | `https://api.data.gov.sg/v1/transport/carpark-availability` |
| LTA traffic camera images | `https://api.data.gov.sg/v1/transport/traffic-images` |
| HDB carpark information | `https://data.gov.sg/api/action/datastore_search?resource_id=d_23f946fa557947f93a8043bbef41dd09` |
| Route matrix / routing | `https://router.project-osrm.org` |
| Map tiles | `https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png` |

`data.gov.sg` allows public API use without a key; creating a key is optional for higher rate limits. The public OSRM server is appropriate for a low-volume student prototype, not production use.

## Project structure

```text
coldroute-sg/
├─ README.md
├─ Makefile               setup, dev, test, build, deploy
├─ .env.deploy.example    deploy settings (copy to .env.deploy.local)
├─ scripts/deploy-frontend.sh
├─ run_local.bat
├─ run_local.sh
├─ backend/
│  ├─ requirements.txt
│  ├─ .env.example
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ config.py
│  │  ├─ models.py
│  │  ├─ routers/
│  │  │  ├─ data.py
│  │  │  └─ routes.py
│  │  └─ services/
│  │     ├─ geo.py
│  │     ├─ mock_data.py
│  │     ├─ optimization.py
│  │     └─ public_apis.py
│  └─ tests/
│     └─ test_optimization.py
└─ frontend/
   ├─ README.md            design system, data and structure
   ├─ package.json
   ├─ vite.config.ts
   ├─ scripts/fetch-osrm.mjs
   └─ src/
      ├─ App.tsx
      ├─ index.css
      ├─ components/       Shell, StopsEditor, ResultsPanel, MapView, StopCard, Timeline, SharePopover, ui
      ├─ lib/              optimizer, explain, time, types
      └─ data/             sample run, OSRM snapshot
```

# Run locally

## Prerequisites

- Python 3.11+ recommended
- Node.js 20+ recommended
- npm

## 1. Backend

### Windows PowerShell / Command Prompt

```bash
cd coldroute-sg\backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

### macOS / Linux

```bash
cd coldroute-sg/backend
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
cd coldroute-sg/frontend
npm install
npm run dev
```

Open:

`http://localhost:5173`

The console runs on its own. It uses OneMap search, OSRM (a bundled snapshot for the sample run, live calls for new stops), live data.gov.sg feeds read straight from the browser (or the recorded sample morning) and an in-browser optimiser, so the backend is optional for the demo. `VITE_API_BASE_URL` (in `.env.production`) is kept for when the UI switches to the FastAPI endpoints. Try `?state=results` (open on the plan), `?data=live` (live feeds) or `?theme=dark`.

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

# FastAPI endpoints

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

## Optimise a route

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

For each candidate next delivery, the backend creates a composite cost approximately of the form:

```text
score =
  travel_weight     × travel_minutes
+ weather_weight    × weather_risk
+ parking_weight    × parking_risk
+ traffic_weight    × traffic_risk
+ cold_chain_weight × time-sensitive cold-chain exposure
+ lateness_weight   × projected_lateness
```

The current implementation uses a greedy context-aware selection algorithm. It is intentionally easy to explain in a project presentation. Later, it can be upgraded to 2-opt, simulated annealing, OR-Tools VRP, genetic algorithms, or other optimisation techniques.

## Weather risk

Forecast text is mapped to an ordinal risk score. For example, thundery/heavy-rain conditions receive a larger penalty than cloudy/fair conditions.

## Parking risk

For each delivery, the backend finds the nearest HDB carpark and combines:

- occupancy level; and
- distance from the delivery point.

A nearly full or distant carpark receives a larger delivery penalty.

## Cold-chain risk

A cold-chain-priority stop receives a larger penalty the longer it remains undelivered. This encourages highly temperature-sensitive deliveries to move earlier when other constraints are similar.

## Lateness

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

From the repo root, `make test` runs backend pytest, frontend Vitest and TypeScript checks. `make test-frontend` runs only frontend tests; from `frontend/`, use `npm test` or `npm run test:watch`. The frontend tests use fixed scenarios and bundled roads, never live APIs. See [`docs/contributing.md`](docs/contributing.md#test-commands) for coverage and limits.

For backend tests alone, from `backend/`:

```bash
pytest
```

# AWS status

The frontend is on **Amplify Hosting**, deployed by GitHub Actions on every merge to `main` (see [`docs/deployment.md`](docs/deployment.md)). An earlier API Gateway + Lambda copy of the backend (`backend/lambda_handler.py`) runs in a teammate's account, but the new console doesn't call it. There is no:

- DynamoDB
- Cognito
- S3
- EventBridge

A later cloud version can map the local components as follows:

| Local component | Later AWS equivalent |
|---|---|
| FastAPI | ECS/Fargate or Lambda + Mangum |
| In-memory/cache calls | DynamoDB / ElastiCache if needed |
| Scheduled public-data refresh | EventBridge + Lambda |
| React/Vite | Amplify Hosting or S3 + CloudFront |
| User accounts | Cognito |
| Logs | CloudWatch |

# Notes for the report

The local MVP deliberately separates **external data acquisition** from **delivery optimisation**. The external services provide context, while ColdRoute SG owns the route-scoring logic and user interface. This makes it easier to explain what technical value the project itself contributes.
