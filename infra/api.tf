# One HTTP API in front of the FastAPI function. API Gateway checks the Cognito
# token before a signed-in route reaches Lambda; the backend reads the verified
# claims from the request context (backend/app/services/auth.py on the Cognito
# branch). Everything else, public data and the traffic grid, needs no token.

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

resource "aws_apigatewayv2_route" "public" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
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
