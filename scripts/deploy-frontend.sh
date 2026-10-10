#!/usr/bin/env bash
# Build frontend/ and upload it to AWS Amplify Hosting as a manual deployment
# (no Git connection). Safe to re-run: it reuses the app and branch if they
# already exist and only uploads a new build.
#
# Settings come from .env.deploy.local (copy .env.deploy.example). AWS keys are
# NOT read from this repo: they come from the AWS CLI profile in ~/.aws.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT/.env.deploy.local}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

AWS_PROFILE="${AWS_PROFILE:-coldroute}"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
AMPLIFY_APP_NAME="${AMPLIFY_APP_NAME:-coldroute-sg}"
AMPLIFY_BRANCH="${AMPLIFY_BRANCH:-main}"
AMPLIFY_APP_ID="${AMPLIFY_APP_ID:-}"
SKIP_BUILD="${SKIP_BUILD:-0}"
export AWS_PROFILE AWS_REGION AWS_PAGER=""

command -v aws >/dev/null || { echo "AWS CLI v2 not found. See docs/deployment.md." >&2; exit 1; }

echo "==> Deploying as $(aws sts get-caller-identity --query Arn --output text) in $AWS_REGION"

# 1. Find or create the Amplify app.
if [ -z "$AMPLIFY_APP_ID" ]; then
  AMPLIFY_APP_ID="$(aws amplify list-apps --query "apps[?name=='$AMPLIFY_APP_NAME'].appId | [0]" --output text)"
fi
if [ -z "$AMPLIFY_APP_ID" ] || [ "$AMPLIFY_APP_ID" = "None" ]; then
  echo "==> Creating Amplify app $AMPLIFY_APP_NAME"
  # The SPA rewrite sends unknown paths to index.html; real files are served as-is.
  AMPLIFY_APP_ID="$(aws amplify create-app \
    --name "$AMPLIFY_APP_NAME" \
    --platform WEB \
    --custom-rules '[{"source":"/<*>","target":"/index.html","status":"404-200"}]' \
    --query app.appId --output text)"
fi
if [ -f "$ENV_FILE" ] && ! grep -q "^AMPLIFY_APP_ID=." "$ENV_FILE"; then
  sed -i '' '/^AMPLIFY_APP_ID=/d' "$ENV_FILE" 2>/dev/null || true
  echo "AMPLIFY_APP_ID=$AMPLIFY_APP_ID" >> "$ENV_FILE"
fi
echo "==> App $AMPLIFY_APP_ID"

# 2. Make sure the branch exists.
if ! aws amplify get-branch --app-id "$AMPLIFY_APP_ID" --branch-name "$AMPLIFY_BRANCH" >/dev/null 2>&1; then
  echo "==> Creating branch $AMPLIFY_BRANCH"
  aws amplify create-branch --app-id "$AMPLIFY_APP_ID" --branch-name "$AMPLIFY_BRANCH" --stage PRODUCTION >/dev/null
fi

# 3. Build.
if [ "$SKIP_BUILD" != "1" ]; then
  echo "==> Building frontend"
  (cd "$ROOT/frontend" && npm ci --no-audit --no-fund && npm run build)
fi
[ -f "$ROOT/frontend/dist/index.html" ] || { echo "frontend/dist/index.html missing. Build first." >&2; exit 1; }

# 4. Zip the contents of dist/ (index.html must sit at the zip root).
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
(cd "$ROOT/frontend/dist" && zip -qr "$WORK/dist.zip" .)
echo "==> Packed $(du -h "$WORK/dist.zip" | cut -f1) from frontend/dist"

# 5. Upload and start the deployment.
read -r JOB_ID UPLOAD_URL < <(aws amplify create-deployment \
  --app-id "$AMPLIFY_APP_ID" --branch-name "$AMPLIFY_BRANCH" \
  --query '[jobId, zipUploadUrl]' --output text)
curl --fail --silent --show-error -X PUT -H "Content-Type: application/zip" \
  --upload-file "$WORK/dist.zip" "$UPLOAD_URL"
aws amplify start-deployment --app-id "$AMPLIFY_APP_ID" --branch-name "$AMPLIFY_BRANCH" --job-id "$JOB_ID" >/dev/null
echo "==> Started job $JOB_ID"

# 6. Wait for it to finish.
for _ in $(seq 1 60); do
  STATUS="$(aws amplify get-job --app-id "$AMPLIFY_APP_ID" --branch-name "$AMPLIFY_BRANCH" --job-id "$JOB_ID" \
    --query job.summary.status --output text)"
  case "$STATUS" in
    SUCCEED) break ;;
    FAILED|CANCELLED) echo "Deployment $STATUS. Check the Amplify console." >&2; exit 1 ;;
    *) printf '   %s\n' "$STATUS"; sleep 5 ;;
  esac
done
[ "$STATUS" = "SUCCEED" ] || { echo "Timed out waiting for job $JOB_ID" >&2; exit 1; }

echo "==> Live: https://$AMPLIFY_BRANCH.$AMPLIFY_APP_ID.amplifyapp.com/"
