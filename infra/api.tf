# One HTTP API in front of the FastAPI function and the planner. It fails
# closed: API Gateway checks a Cognito token before any request reaches
# Lambda, except the public GET routes and the browser's CORS preflight below.
# The backend reads the verified claims from the request context
# (backend/app/services/auth.py on the Cognito branch).

locals {
  # what anyone may read without signing in: the root and health check, the
  # data.gov.sg routes, the LTA road-speed grid and the URA and mall carparks
  public_routes = [
    "GET /",
    "GET /api/health",
    "GET /api/data/{proxy+}",
    "GET /api/traffic/{proxy+}",
    "GET /api/parking/{proxy+}",
  ]
}

resource "aws_apigatewayv2_api" "api" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"

  # API Gateway answers preflight requests itself (see the routes below)
  cors_configuration {
    allow_origins = local.origins
    allow_methods = ["GET", "POST", "DELETE", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.api.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.console.id]
    issuer   = "https://${aws_cognito_user_pool.users.endpoint}"
  }
}

# The methods the backend serves, not ANY: an ANY route also matches the
# browser's OPTIONS preflight, which carries no token, so the authorizer would
# fail it with a 401 and the browser would block the real request.
resource "aws_apigatewayv2_route" "signed_in" {
  for_each = toset([
    "POST /api/routes/{proxy+}",
    "GET /api/routes/{proxy+}",
    "DELETE /api/routes/{proxy+}",
    "GET /api/admin/{proxy+}",
  ])
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Planning a run in the cloud (planner.tf): for signed-in users, since each new
# pair of stops is a Location Service call.
resource "aws_apigatewayv2_integration" "planner" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.planner.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "plan" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "POST /api/plan"
  target             = "integrations/${aws_apigatewayv2_integration.planner.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "public_read" {
  for_each  = toset(local.public_routes)
  api_id    = aws_apigatewayv2_api.api.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

# The preflight carries no token, so it gets a route of its own; otherwise the
# signed-in $default route below would fail it with a 401 (AWS's documented
# setup for an authorizer on $default).
resource "aws_apigatewayv2_route" "preflight" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "OPTIONS /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

# Everything without a route of its own needs a token too, so a method or path
# added later is not public by accident.
resource "aws_apigatewayv2_route" "fallback" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "$default"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id

  # public reads keep working while an existing stack switches over
  depends_on = [aws_apigatewayv2_route.public_read, aws_apigatewayv2_route.preflight]
}

# The $default route was public before; it is the same route, now signed in.
moved {
  from = aws_apigatewayv2_route.public
  to   = aws_apigatewayv2_route.fallback
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${local.name}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  # a ceiling against runaway clients; far above what a demo or the load test needs
  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId          = "$context.requestId"
      route              = "$context.routeKey"
      status             = "$context.status"
      latencyMs          = "$context.responseLatency"
      integrationLatency = "$context.integrationLatency"
      authError          = "$context.authorizer.error"
    })
  }
}
