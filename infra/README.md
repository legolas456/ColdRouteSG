# Infrastructure (Terraform)

The whole AWS stack as code, so anyone can create it in their own account, and the team's account can be rebuilt instead of clicked together again.

| Part | Resources |
| --- | --- |
| Console | Amplify Hosting app `coldroute-console`, branch `main`; apply builds the console and uploads it with `scripts/deploy-frontend.sh` (no Git connection) |
| Sign-in | Cognito user pool (email sign-in, an admin creates users), console app client without a secret, `admin` group |
| API | API Gateway HTTP API. It fails closed: every request needs a Cognito token, which API Gateway checks before Lambda runs, except the public reads (`GET /`, `/api/health`, `/api/data/*`, `/api/traffic/*`, `/api/parking/*`) and the browser's `OPTIONS` preflight. Requests go to the FastAPI Lambda `coldroute-api` (Python 3.12), except `POST /api/plan`, which goes to the planner. CORS allows the console and `extra_origins`. |
| Cloud planner | Lambda `coldroute-planner` (Node.js 22, bundled from `planner/` by `build-planner.sh`) behind the signed-in `POST /api/plan`. It reads the NEA forecast and HDB lots, and from the traffic bucket the URA and mall carparks, the live grid and typical traffic, then runs the console's own optimiser. Drive times come from Amazon Location Service in `routing_region` (default `ap-southeast-2`, whose routing data is HERE's; the Singapore region's GrabMaps data could not route to or from NUH on 29 Oct 2026), each pair cached for 30 days in DynamoDB `coldroute-drive-times`. |
| Route history | DynamoDB `coldroute-route-history`, key `user_id` + `route_id`, on demand |
| Live traffic | EventBridge every 10 minutes (a reading is 288 of the key's roughly 3,000 LTA calls an hour), then Lambda `coldroute-traffic-refresh`, which reads LTA and writes the road-speed grid to the private S3 bucket `coldroute-traffic-<account>`. The API serves it at `/api/traffic/grid`. Every reading is also kept in `traffic/history/` (expires after `traffic_history_days`, default 180) for typical traffic, and LTA's free lots in URA and mall carparks are published to `parking/carparks.json` (six more calls), served at `/api/parking/carparks`. Only created when an LTA key is given. |
| Typical traffic | Each night at 02:30 Singapore time, Lambda `coldroute-traffic-profile` builds a grid per weekday and weekend 15-minute slot from the last four weeks of kept readings (`traffic/typical/`); the API serves the one for a departure at `/api/traffic/typical?at=…`. Only created with an LTA key. |
| Monitoring | Log groups with 14-day retention (every function, API access log), CloudWatch dashboard `coldroute` (API latency p50/p95, requests, errors, plan time and Location Service routes billed per plan, the traffic refresh), optional monthly budget alert |

Each function's role allows only what it uses: the API reads and writes route history, lists users for the admin dashboard and reads the grid; the refresh writes the grid; the planner calls Location Service's routes, reads and writes the drive-time cache and reads its inputs from the bucket.

## Before you start

- Terraform 1.6 or newer and AWS CLI v2.
- `uv` or Python 3 with pip, and `zip`: apply packages the backend (no Docker needed).
- Node 22 with npm, and `curl`: apply bundles the planner, and builds the console and uploads it. Without them, set `deploy_console = false` and deploy the console another way (the planner still needs Node).
- An AWS CLI profile for an IAM user or role that can create these resources (e.g. `AdministratorAccess`). **Not the root user.**
- Optional: an LTA DataMall AccountKey for live traffic (free, https://datamall.lta.gov.sg).

## Create the stack

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # optional: profile, budget email, protect_data
export AWS_PROFILE=coldroute            # your profile
export TF_VAR_lta_account_key=...       # optional; keeps the key out of files
terraform init
terraform apply
```

The commands in the rest of this page run in `infra/` too.

That is the whole deploy. Apply creates the resources, packages `backend/` for the Lambda functions (`build-lambda.sh`) and `planner/` for the planner (`build-planner.sh`), builds the console with this stack's API and Cognito settings and uploads it to Amplify (`scripts/deploy-frontend.sh`). `terraform output` then lists the console URL, the API URL and the Cognito IDs.

For the team's real stack, set `protect_data = true`: deletion protection on the user pool and route history, point-in-time recovery for the table, and a bucket that holds objects is not deleted. It keeps the data, not the stack: `terraform destroy` still removes everything else before it stops at those.

### Publish the first traffic grid

The schedule publishes within 10 minutes. To not wait:

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

### The console from elsewhere

Apply deploys the console itself. To deploy it some other way, set `deploy_console = false` and build with the `VITE_*` values from `terraform output frontend_env`, then upload to the app in `terraform output amplify_app_id` (for example with `scripts/deploy-frontend.sh`).

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

`/api/admin/me` answers for a user in the `admin` group and refuses (403) everyone else.

## Update and remove

- Code change: `terraform apply` again. It rebuilds only what changed: the Lambda package (and every function) when a backend source changes, the console when a frontend source or one of its settings changes. With nothing changed it reports "No changes"; test files and Python caches never count as changes.
- Remove everything: `terraform destroy`. With `protect_data = true` it removes the rest and then stops at the user pool, the route-history table and the traffic bucket (while it holds readings); set it to `false` and apply first to remove those too.

## Things to know

- **`backend.zip` went missing** (you deleted `infra/build/`, or applied existing state from a fresh clone): terraform only rebuilds the package when `backend/` changes, so new or replaced functions would point at a missing file. Rebuild it first with `terraform apply -replace=terraform_data.backend_package`.
- **Two AWS accounts on one machine**: apply uploads the console with the same credentials as the provider and stops if they belong to a different account than the stack. Set `aws_profile` in `terraform.tfvars` to be explicit.

- **State holds secrets.** `terraform.tfstate` contains the LTA key and every resource ID. It stays on the machine that ran Terraform (git-ignored); keep it private, or move it to a private S3 backend if more than one person applies.
- **Replacing the hand-made stack.** Applying this in an account that already has the hand-made Cognito, API Gateway, Lambda and DynamoDB creates a second, separate stack; nothing existing is touched. Users and saved routes are not copied. Once the console works against the new stack, delete the old resources in the console.
- **Cost.** Next to nothing at course scale: the traffic refresh is about 4,300 runs a month of about 7 s at 1 GB, within Lambda's free tier, plus a few cents of S3 and logs. API Gateway, Cognito and DynamoDB are free or pay-per-request at this size. The planner's Location Service calls are billed as Core routes, US$0.50 per 1,000 in Sydney as in Singapore: every cell of a matrix (a stop to itself too) and each road line drawn. The sample run's first plan billed 63, a repeat none (every pair from the cache) and a run with one new stop about 12; October's 408 routes cost nothing, within the free tier. Set `budget_email` for an alert anyway.
- **What the console uses.** Built with `frontend_env`, the console signs in with Cognito, saves each signed-in plan to route history (`POST /api/routes/history`), lists and reopens saved runs, shows admins the team's activity, and reads live traffic. Signed in on Live data, it plans through the cloud planner (`POST /api/plan`), and in the browser otherwise or when the planner cannot be reached. The API's `POST /api/routes/optimize` (the older Python optimiser) is only used by the old UI.

Tested on 29 Oct 2026 in a separate test account: apply created 30 resources; the refresh read 288 LTA pages in 7 s and published the grid; the deployed console read it through the API in Live mode; signed-in routes refused missing and forged tokens (401) and accepted a Cognito token; browser preflights from the console returned 200.
