# ColdRoute SG on AWS: the console on Amplify Hosting, sign-in with Cognito, the
# FastAPI backend and the planner on Lambda behind an API Gateway HTTP API,
# route history and drive times in DynamoDB, drive times from Amazon Location
# Service, and live road speeds that an EventBridge schedule publishes to S3.
# See README.md for the order to run things in.

data "aws_caller_identity" "current" {}

locals {
  name        = var.prefix
  console_url = "https://main.${aws_amplify_app.console.default_domain}"
  # the API and the backend accept requests from the console and these extras only
  origins = concat([local.console_url], var.extra_origins)
  # whether a key is set is not secret, only the key
  traffic_enabled = nonsensitive(var.lta_account_key != "")
  # written by build-lambda.sh and build-planner.sh, which apply runs (build.tf)
  lambda_zip  = abspath("${path.module}/build/backend.zip")
  planner_zip = abspath("${path.module}/build/planner.zip")
  # the planner's metrics (time and Location Service routes per plan), one namespace per stack
  metrics_namespace = "ColdRoute/${local.name}"
}
