# `terraform apply` builds what it deploys, so applying is all a deploy takes:
# the backend's Lambda package when its sources change, and the console when
# its sources or its settings (the API and Cognito IDs below) change. A plan
# with nothing changed rebuilds nothing. The machine that applies needs Python 3
# with uv or pip, Node 22 with npm, zip, curl and the AWS CLI.

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
    }, var.aws_profile == null ? {} : { AWS_PROFILE = var.aws_profile })
  }
}
