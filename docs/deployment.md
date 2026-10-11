# Deployment

How the live demo gets to AWS, where the keys are, and how to change it.

## Live demo

| | |
| --- | --- |
| URL | https://main.daledp6z7ncmz.amplifyapp.com/ (keep the `.com`) |
| What | The dispatcher console from `frontend/` on `main` (static build, no backend calls) |
| Host | AWS Amplify Hosting, app `coldroute-sg` (`daledp6z7ncmz`), branch `main`, region `ap-southeast-1` |
| AWS account | `hxk123123123` (`768396624500`), Xuankun's account on the AWS Free plan |
| How | **GitHub Actions.** Merging to `main` builds `frontend/` and uploads it to Amplify. Amplify itself isn't connected to GitHub: the workflow pushes each build as a manual deployment. |

## How it works

| Workflow | Runs on | Does |
| --- | --- | --- |
| [`checks.yml`](../.github/workflows/checks.yml) | Every PR, and pushes to `main` | Frontend `npm ci && npm run build`, backend `pytest`. No secrets. |
| [`deploy.yml`](../.github/workflows/deploy.yml) | Pushes to `main` that touch `frontend/**`, the deploy script or the workflow; or **Run workflow** in the Actions tab | Runs [`scripts/deploy-frontend.sh`](../scripts/deploy-frontend.sh): build, zip `frontend/dist`, `create-deployment` → upload → `start-deployment`, wait for the job, then write the URL to the run summary. |

So for teammates: **open a PR, wait for Checks to go green, merge. The site updates about two minutes later.** Docs-only or backend-only merges don't redeploy. To redeploy anyway, open Actions → Deploy → Run workflow.

Deploys run one at a time. A newer merge waits for the running deploy to finish.

## Keys

- Deploys use the IAM user **`coldroute-deployer`**, which has only the AWS managed policy `AdministratorAccess-Amplify`. Don't deploy with root keys.
- Its access key is stored in two places:
  - the **repository secrets** `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, used by `deploy.yml`;
  - Xuankun's Mac, in `~/.aws/credentials` under the profile `coldroute`, used by `make deploy`.
- **Never commit keys.** `.gitignore` blocks `.env`, `*.local` and `*accessKeys*.csv`, but check `git status` before you push anyway.
- To rotate or revoke: IAM → Users → `coldroute-deployer` → Security credentials. Create a new key, update both secrets (`gh secret set AWS_ACCESS_KEY_ID -R legolas456/ColdRouteSG`, and the same for `AWS_SECRET_ACCESS_KEY`) and the local profile, then deactivate and delete the old key.

## Deploy by hand (fallback)

Use this if Actions is down, or to deploy a branch before you merge it.

1. Install [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), then run `aws configure --profile coldroute` (region `ap-southeast-1`). Ask Xuankun for a key, or use your own AWS account (the script creates the app if it doesn't exist).
2. `make env` creates `.env.deploy.local` from [`.env.deploy.example`](../.env.deploy.example). It holds the profile, region, app name and app ID, never the keys.
3. `make deploy` to build and upload, or `make deploy-only` to upload the existing `frontend/dist`.

A hand deploy shows up on the live site straight away. It gets replaced by the next deploy from `main`.

## History

There was no CI before October 2026. There were no workflows, no `amplify.yml` and no secrets, and there are no AWS keys anywhere in the Git history. Older deployments are in legolas456's AWS account and aren't maintained:

| What | Where | Notes |
| --- | --- | --- |
| Old frontend | https://production.d3afn54umnn6ms.amplifyapp.com/ | The pre-redesign UI, built on 10 Oct and uploaded by hand as `frontend/coldroute-frontend.zip` (commit `b2aab2b`, removed in `c1372c9`). |
| Old backend | `https://h1mcomkkll.execute-api.ap-southeast-1.amazonaws.com/` | API Gateway + Lambda running FastAPI through Mangum (`backend/lambda_handler.py`), uploaded by hand from `backend/backend-source.zip`. `frontend/.env.production` still points at it, but the new console doesn't call the backend yet. |

## Still open

We're `write` collaborators on `legolas456/ColdRouteSG`. We can push workflows and set Actions secrets, but only the owner can change the repository's Actions settings, webhooks and installed GitHub Apps.

- [ ] Ask legolas456 to protect `main` so that the Checks must pass before a merge.
- [ ] Optional: swap the long-lived key for a GitHub OIDC role (`aws-actions/configure-aws-credentials`), or switch to Amplify's own Git connection once the owner authorises the AWS Amplify GitHub App.
- [ ] Deploy the backend from CI too, once the frontend calls it (roadmap section 5).
