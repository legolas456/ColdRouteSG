# Deployment

How the live demo gets to AWS, where the keys are, and how to change it.

## Live demo

| | |
| --- | --- |
| URL | https://main.d1f8mppryelp5v.amplifyapp.com/ (keep the `.com`) |
| What | The dispatcher console from `frontend/` on `main`, with the AWS stack in `infra/` behind it: Cognito sign-in, saved runs, live LTA traffic |
| Host | AWS Amplify Hosting, app `coldroute-console` (`d1f8mppryelp5v`), branch `main`, region `ap-southeast-1` |
| AWS account | Jay's account, the team's production stack since 2 Nov 2026 |
| How | **`terraform apply`** in `infra/` builds the console with the stack's settings and uploads it to Amplify ([`infra/README.md`](../infra/README.md)). Merging to `main` does not deploy by itself. |

The earlier app, `coldroute-sg` (`daledp6z7ncmz`) in Xuankun's account, is retired: nothing deploys to it any more. Do not use or cite it.

## How it works

| Workflow | Runs on | Does |
| --- | --- | --- |
| [`checks.yml`](../.github/workflows/checks.yml) | Every PR, and pushes to `main` | Frontend tests and build, planner typecheck, tests and build, backend `pytest`, `terraform fmt` and `validate`. No secrets. |

So for teammates: **open a PR, wait for Checks to go green, merge.** Whoever holds the Terraform state (Jay) then runs `terraform apply` in `infra/` to put `main` live.

To see which commit is live, look for `<meta name="coldroute-build" content="<sha> <build time>">` in the page source, or run:

```bash
curl -s https://main.d1f8mppryelp5v.amplifyapp.com/ | grep coldroute-build
```

## Keys

- The live stack is created and deployed with the credentials of whoever runs `terraform apply` (Jay's AWS profile). No AWS keys are stored in the repo or in GitHub.
- The earlier `deploy.yml` workflow (removed) used the IAM user **`coldroute-deployer`** in Xuankun's account, with its key in the repository secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` and in a local `coldroute` profile. Nothing uses that key now: delete the two secrets (repository Settings → Secrets and variables → Actions) and deactivate the user's access key (IAM → Users → `coldroute-deployer` → Security credentials).
- **Never commit keys.** `.gitignore` blocks `.env`, `*.local` and `*accessKeys*.csv`, but check `git status` before you push anyway.

## Deploy by hand (your own test app only)

`make deploy` builds the console and uploads it to an Amplify app named in `.env.deploy.local` (`make env` creates it from [`.env.deploy.example`](../.env.deploy.example)), using your own AWS profile. Use it for an app of your own, never for the live site, which `terraform apply` owns.

## History

There was no CI before October 2026. Older deployments, in legolas456's AWS account, are retired and should not be used or cited:

| What | Where | Notes |
| --- | --- | --- |
| Old frontend | `production.d3afn54umnn6ms.amplifyapp.com` | The pre-redesign UI, built on 10 Oct and uploaded by hand. |
| Old backend | API Gateway `h1mcomkkll` in `ap-southeast-1` | FastAPI on Lambda through Mangum, uploaded by hand. Replaced by the stack in `infra/`. |

## Infrastructure as code

[`infra/`](../infra/README.md) creates the whole stack with Terraform: Amplify Hosting for the console, Cognito, the FastAPI Lambda and the cloud planner behind an API Gateway HTTP API (Cognito tokens checked at the gateway), DynamoDB route history and drive times, the scheduled traffic refresh (EventBridge, Lambda, S3) and a CloudWatch dashboard. It runs in Jay's account as the team's production stack. The earlier Amplify app and the old backend (above) were set up by hand and are no longer updated.

## Live traffic service

Live road speeds need an LTA DataMall AccountKey, which must never reach the browser or the repo. Two ways to serve the grid the console reads (`VITE_TRAFFIC_URL`), both in `ap-southeast-1`:

| | Scheduled grid (what `infra/` runs) | On request (simplest) |
| --- | --- | --- |
| Runs | `backend/traffic_refresh.handler` as a Lambda, triggered by an EventBridge schedule `rate(10 minutes)` (a reading is 288 calls of the key's roughly 3,000 an hour) | The existing FastAPI Lambda (`backend/lambda_handler.py`), route `GET /api/traffic/grid` |
| Environment | `LTA_ACCOUNT_KEY`, `TRAFFIC_BUCKET`, optionally `TRAFFIC_KEY` (default `traffic/speed-grid.json`) | `LTA_ACCOUNT_KEY` |
| Permissions | `s3:PutObject` on the grid's key, on `traffic/history/*` and `traffic/history-index/*` (every reading kept, and the stretch index they refer to) and on `parking/carparks.json` | none beyond the function's own |
| Console reads | the API route `GET /api/traffic/grid`, whose Lambda reads the private S3 object | the API route, which must not need a sign-in token (it is public data) and must allow the console's origin in CORS |
| Timeout | 90 s (it reads 288 LTA pages, 16 at a time with retries: 3–6 s on 27 Oct 2026, up to 30 s seen with 8 at a time) | 30 s at API Gateway; the first request after a cold start does the same reading, so a slow LTA can time it out |

Both need `backend/app/data/speed_baseline.json` in the package: each road stretch's speed at night, which the delay factors are measured against. Without it every stretch falls back to one speed per road category, which reads junctions and bends as traffic; the grid then reports `"nightShare": 0`. To rebuild it, save a few raw readings between 2 and 5 am (`python -m app.services.traffic --out grid.json --raw night1.json`, from `backend/`, 20 minutes apart), then run `python -m app.services.traffic --baseline night*.json --out app/data/speed_baseline.json`.

The Terraform in `infra/` also runs `backend/traffic_profile.handler` each night (02:30 Singapore time), which builds typical traffic for every weekday and weekend 15-minute slot from the kept readings; the console asks for it (`/api/traffic/typical`) when no live reading covers a departure.

`terraform apply` sets `VITE_TRAFFIC_URL` for the console build. Without it (a local build), the console plans with free-flowing drive times and shows the Road speeds section as "Off".

Cost: the LTA API is free; the schedule is about 4,300 short Lambda runs a month, each writing the grid and a kept reading to S3, plus one nightly typical-traffic build.

## Still open

- [ ] Ask legolas456 to protect `main` so that the Checks must pass before a merge.
- [ ] Delete the old deploy key (see Keys above).
