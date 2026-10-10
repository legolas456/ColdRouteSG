# Deployment

How the live demo gets to AWS today, where the keys are, and what blocks CI.

## Live demo

| | |
| --- | --- |
| URL | https://main.daledp6z7ncmz.amplifyapp.com/ |
| What | The dispatcher console from `frontend/` on `main` (static build, no backend calls) |
| Host | AWS Amplify Hosting, app `coldroute-sg` (`daledp6z7ncmz`), branch `main`, region `ap-southeast-1` |
| AWS account | `hxk123123123` (`768396624500`), Xuankun's account on the AWS Free plan |
| How | Manual deployment: a zip of `frontend/dist` uploaded with `make deploy`. **Not connected to GitHub**, so pushing to `main` does not redeploy. |

Older deployments, both in legolas456's AWS account and not maintained:

| What | Where | Notes |
| --- | --- | --- |
| Old frontend | https://production.d3afn54umnn6ms.amplifyapp.com/ | The pre-redesign UI, built on 10 Oct and uploaded by hand as `frontend/coldroute-frontend.zip` (commit `b2aab2b`, removed in `c1372c9`). |
| Old backend | `https://h1mcomkkll.execute-api.ap-southeast-1.amazonaws.com/` | API Gateway + Lambda running FastAPI through Mangum (`backend/lambda_handler.py`), uploaded by hand from `backend/backend-source.zip`. `frontend/.env.production` still points at it, but the new console doesn't call the backend yet. |

There was never any CI: no GitHub Actions workflows, no `amplify.yml`, no repository secrets, and no AWS keys anywhere in the Git history.

## Keys

- Deploys use the IAM user **`coldroute-deployer`**, which has only the AWS managed policy `AdministratorAccess-Amplify`. Don't deploy with root keys.
- Its access key is stored only on Xuankun's Mac, in `~/.aws/credentials` under the profile **`coldroute`** (region in `~/.aws/config`).
- **Never commit keys.** `.gitignore` blocks `.env`, `*.local` and `*accessKeys*.csv`, but check `git status` before you push anyway.
- If a key leaks or gets lost: IAM → Users → `coldroute-deployer` → Security credentials → deactivate and delete the old key, then create a new one.

## Deploy from your machine

One-time setup:

1. Install [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).
2. Add the deploy key as a profile: `aws configure --profile coldroute` (region `ap-southeast-1`). Ask Xuankun for a key, or use your own AWS account (the script creates the app if it doesn't exist).
3. `make env` creates `.env.deploy.local` from [`.env.deploy.example`](../.env.deploy.example). It holds the profile, region, app name and app ID, never the keys.

Then each time:

```bash
git pull --ff-only origin main
make deploy        # npm ci + build + upload + wait, then prints the live URL
make deploy-only   # upload the existing frontend/dist without rebuilding
```

[`scripts/deploy-frontend.sh`](../scripts/deploy-frontend.sh) finds or creates the Amplify app and branch, builds `frontend/`, zips the contents of `frontend/dist`, uploads the zip (`create-deployment` → upload → `start-deployment`) and waits for the job to finish. The app has one rewrite (`/<*>` → `/index.html`, 404-200) so that unknown paths load the single-page app.

## TODO: CI (blocked on the repo owner)

We can't set up proper CI until **legolas456** (the owner of `legolas456/ColdRouteSG`) gives us access or does these steps himself. The rest of us are `write` collaborators. We can push code, workflow files and Actions secrets, but we can't see or change the repository's Actions settings, webhooks or installed GitHub Apps.

- [ ] **Preferred: Amplify Git-based deployment**, as in the proposal. The owner authorises the AWS Amplify GitHub App for this repo, then we connect `main` to the `coldroute-sg` app (or create a new Git-connected app) with build root `frontend/`, `npm ci && npm run build`, output `dist`, Node 22. Every push to `main` then redeploys.
- [ ] Or **GitHub Actions**: the owner confirms that Actions are enabled with the right workflow permissions, and we store the deploy credentials as repository secrets (better: an OIDC role instead of long-lived keys). A workflow then runs `make deploy` on pushes to `main`.
- [ ] Whichever we choose, remove the manual path from this doc and keep the keys out of the repo.
