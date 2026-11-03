# Infrastructure (Terraform)

The whole AWS stack as code, so anyone can create it in their own account, and the team's account can be rebuilt instead of clicked together again.

| Part | Resources |
| --- | --- |
| Console | Amplify Hosting app `coldroute-console`, branch `main`, uploaded by `scripts/deploy-frontend.sh` (no Git connection, as before) |
| Sign-in | Cognito user pool (email sign-in, an admin creates users), console app client without a secret, `admin` group |
| API | API Gateway HTTP API. It fails closed: every request needs a Cognito token, which API Gateway checks before Lambda runs, except the public reads (`GET /`, `/api/health`, `/api/data/*`, `/api/traffic/*`) and the browser's `OPTIONS` preflight. All of it goes to the FastAPI Lambda `coldroute-api` (Python 3.12). CORS allows the console and `extra_origins`. |
| Route history | DynamoDB `coldroute-route-history`, key `user_id` + `route_id`, on demand |
| Live traffic | EventBridge every 5 minutes, then Lambda `coldroute-traffic-refresh`, which reads LTA and writes the road-speed grid to the private S3 bucket `coldroute-traffic-<account>`. The API serves it at `/api/traffic/grid`. Only created when an LTA key is given. |
| Monitoring | Log groups with 14-day retention (both functions, API access log), CloudWatch dashboard `coldroute` (API latency p50/p95, requests, errors, the traffic refresh), optional monthly budget alert |

Each function's role allows only what it uses: the API reads and writes route history, lists users for the admin dashboard and reads the grid; the refresh writes the grid.

## Before you start

- Terraform 1.6 or newer, AWS CLI v2, and `uv` or Python 3 with pip (for the Lambda package; no Docker needed).
- An AWS CLI profile for an IAM user or role that can create these resources (e.g. `AdministratorAccess`). **Not the root user.**
- Optional: an LTA DataMall AccountKey for live traffic (free, https://datamall.lta.gov.sg).

## Create the stack

From the repo root:

```bash
./infra/build-lambda.sh                 # backend/ -> infra/build/backend.zip
cd infra
cp terraform.tfvars.example terraform.tfvars   # optional: profile, budget email, protect_data
export AWS_PROFILE=coldroute            # your profile
export TF_VAR_lta_account_key=...       # optional; keeps the key out of files
terraform init
terraform apply
```

`terraform output` then lists the console URL, the API URL, the Cognito IDs and `frontend_env`, the settings the console build needs.

For the team's real stack, set `protect_data = true`: deletion protection on the user pool and route history, point-in-time recovery for the table, and the bucket is kept on destroy.

### Publish the first traffic grid

The schedule publishes within 5 minutes. To not wait:

```bash
aws lambda invoke --function-name "$(terraform output -raw traffic_function)" /dev/stdout
```

### Create users

Sign-up is closed (`self_sign_up = false`), so an admin creates each account:

```bash
POOL=$(terraform output -raw cognito_user_pool_id)
aws cognito-idp admin-create-user --user-pool-id $POOL --username manager@example.com \
  --user-attributes Name=email,Value=manager@example.com Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --user-pool-id $POOL --username manager@example.com --group-name admin
```

Cognito emails a temporary password; the first sign-in asks for a new one. Leave out the group for a driver.

### Deploy the console

From the repo root, with the stack's IDs and the build settings from `terraform output frontend_env`:

```bash
export AMPLIFY_APP_ID=$(terraform -chdir=infra output -raw amplify_app_id)
export VITE_TRAFFIC_URL=$(terraform -chdir=infra output -raw traffic_url)
DEPLOY_ENV_FILE=/dev/null ./scripts/deploy-frontend.sh
```

For the GitHub Deploy workflow, set `AMPLIFY_APP_ID` and the `VITE_*` values in `.github/workflows/deploy.yml`, and store keys for a user that can deploy to this app as the repository secrets (see [docs/deployment.md](../docs/deployment.md#keys)).

## Check it

```bash
API=$(terraform output -raw api_url)
curl -s "$API/api/health"                                   # 200
curl -s "$API/api/traffic/grid" | head -c 200               # the grid, once published
curl -s -X POST "$API/api/routes/optimize"                  # 401 {"message":"Unauthorized"}
curl -s "$API/anything-else"                                # 401 too: no route is public by default
```

With a token (the console client allows password sign-in for scripts):

```bash
TOKEN=$(aws cognito-idp initiate-auth --client-id "$(terraform output -raw cognito_client_id)" \
  --auth-flow USER_PASSWORD_AUTH --auth-parameters USERNAME=manager@example.com,PASSWORD='...' \
  --query AuthenticationResult.IdToken --output text)
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/admin/me"
```

The token gets past API Gateway; `/api/admin/me` itself answers once the Cognito branch's backend is merged (until then FastAPI returns 404).

## Update and remove

- Code change: `./infra/build-lambda.sh && terraform -chdir=infra apply` updates both functions.
- Remove everything: `terraform destroy` (refused for the user pool and table while `protect_data = true`).

## Things to know

- **State holds secrets.** `terraform.tfstate` contains the LTA key and every resource ID. It stays on the machine that ran Terraform (git-ignored); keep it private, or move it to a private S3 backend if more than one person applies.
- **Replacing the hand-made stack.** Applying this in an account that already has the hand-made Cognito, API Gateway, Lambda and DynamoDB creates a second, separate stack; nothing existing is touched. Users and saved routes are not copied. Once the console works against the new stack, delete the old resources in the console.
- **Cost.** Next to nothing at course scale: the traffic refresh is about 8,600 runs a month of about 7 s at 1 GB, within Lambda's free tier, plus a few cents of S3 and logs. API Gateway, Cognito and DynamoDB are free or pay-per-request at this size. Set `budget_email` for an alert anyway.
- **Not wired yet.** The new console does not sign in or call the optimise endpoint yet (its planner runs in the browser); only live traffic uses this API today. The Cognito, route-history and admin endpoints come from the backend on `feat/lianping-admin-dashboard-cognito-dynamodb`, which still needs merging into `backend/`.

Tested on 29 Oct 2026 in a separate test account: apply created 30 resources; the refresh read 288 LTA pages in 7 s and published the grid; the deployed console read it through the API in Live mode; signed-in routes refused missing and forged tokens (401) and accepted a Cognito token; browser preflights from the console returned 200.
