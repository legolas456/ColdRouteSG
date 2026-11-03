# Amplify Hosting without a Git connection: scripts/deploy-frontend.sh (and the
# Deploy workflow) uploads each build as a manual deployment, as it does today.

resource "aws_amplify_app" "console" {
  name     = "${local.name}-console"
  platform = "WEB"

  # the SPA rewrite: unknown paths get index.html, real files are served as-is
  custom_rule {
    source = "/<*>"
    target = "/index.html"
    status = "404-200"
  }
}

resource "aws_amplify_branch" "main" {
  app_id      = aws_amplify_app.console.id
  branch_name = "main"
  stage       = "PRODUCTION"
}
