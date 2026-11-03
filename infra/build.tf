# `terraform apply` builds what it deploys, so applying is all a deploy takes:
# the backend's and the planner's Lambda packages when their sources change,
# and the console when its sources or its settings (the API and Cognito IDs
# below) change. A plan with nothing changed rebuilds nothing. The machine that
# applies needs Python 3 with uv or pip, Node 22 with npm, zip, curl and the
# AWS CLI.

locals {
  backend_dir = abspath("${path.module}/../backend")
  # what goes into the package: the app, its handlers and their requirements, not caches
  backend_files = sort([
    for f in setunion([for pattern in ["app/**", "*.py", "requirements-lambda.txt"] : fileset(local.backend_dir, pattern)]...) : f
    if !strcontains(f, "__pycache__")
  ])
  backend_package_hash = base64sha256(join("\n", concat(
    [for f in local.backend_files : "${f} ${filesha256("${local.backend_dir}/${f}")}"],
    ["build-lambda.sh ${filesha256("${path.module}/build-lambda.sh")}"],
  )))

  planner_dir = abspath("${path.module}/../planner")
  # the planner bundles the console's own code (frontend/src/lib and its data), so changes there rebuild it too
  planner_files = sort(concat(
    [for f in setunion([for pattern in ["src/**", "package.json", "package-lock.json", "build.mjs"] : fileset(local.planner_dir, pattern)]...) : "planner/${f}" if !strcontains(f, "__tests__")],
    [for f in setunion([for pattern in ["src/lib/**", "src/data/**"] : fileset(local.frontend_dir, pattern)]...) : "frontend/${f}" if !strcontains(f, "__tests__")],
  ))
  planner_package_hash = base64sha256(join("\n", concat(
    [for f in local.planner_files : "${f} ${filesha256("${path.module}/../${f}")}"],
    ["build-planner.sh ${filesha256("${path.module}/build-planner.sh")}"],
  )))

  frontend_dir = abspath("${path.module}/../frontend")
  # what the console build reads; tests do not change it
  frontend_files = sort([
    for f in setunion([
      for pattern in ["src/**", "public/**", "index.html", "package.json", "package-lock.json", "vite.config.ts", "tsconfig*.json", ".env.production"] :
      fileset(local.frontend_dir, pattern)
    ]...) : f
    if !strcontains(f, "__tests__")
  ])
  # the console's build-time settings; also an output
  frontend_env = {
    VITE_TRAFFIC_URL          = "${aws_apigatewayv2_api.api.api_endpoint}/api/traffic/grid"
    VITE_API_BASE_URL         = aws_apigatewayv2_api.api.api_endpoint
    VITE_COGNITO_USER_POOL_ID = aws_cognito_user_pool.users.id
    VITE_COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.console.id
  }
  console_hash = sha256(join("\n", concat(
    [for f in local.frontend_files : "${f} ${filesha256("${local.frontend_dir}/${f}")}"],
    ["deploy-frontend.sh ${filesha256("${path.module}/../scripts/deploy-frontend.sh")}", jsonencode(local.frontend_env)],
  )))
}

# Packages backend/ into build/backend.zip for every function (build-lambda.sh).
resource "terraform_data" "backend_package" {
  triggers_replace = [local.backend_package_hash]

  provisioner "local-exec" {
    command = "${path.module}/build-lambda.sh"
  }
}

# Bundles planner/ into build/planner.zip (build-planner.sh).
resource "terraform_data" "planner_package" {
  triggers_replace = [local.planner_package_hash]

  provisioner "local-exec" {
    command = "${path.module}/build-planner.sh"
  }
}

# Builds the console with this stack's settings and uploads it to Amplify
# (scripts/deploy-frontend.sh). Set deploy_console = false to deploy it some
# other way, e.g. from CI.
resource "terraform_data" "console" {
  count            = var.deploy_console ? 1 : 0
  triggers_replace = [local.console_hash, aws_amplify_app.console.id]

  provisioner "local-exec" {
    command     = "./scripts/deploy-frontend.sh"
    working_dir = abspath("${path.module}/..")
    environment = merge(local.frontend_env, {
      AMPLIFY_APP_ID = aws_amplify_app.console.id
      AMPLIFY_BRANCH = aws_amplify_branch.main.branch_name
      AWS_REGION     = var.region
      # settings come from here, not from a local .env.deploy.local
      DEPLOY_ENV_FILE = "/dev/null"
      # upload with the provider's credentials, into the provider's account
      COLDROUTE_PROFILE_FALLBACK = "0"
      EXPECT_AWS_ACCOUNT         = data.aws_caller_identity.current.account_id
    }, var.aws_profile == null ? {} : { AWS_PROFILE = var.aws_profile })
  }
}
