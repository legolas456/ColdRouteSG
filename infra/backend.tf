# Two functions from one package (build-lambda.sh): the FastAPI app behind the
# API, and the scheduled traffic refresh. Each has its own role with only what
# it uses.

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# ---- API -------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "api_fn" {
  name              = "/aws/lambda/${local.name}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "api" {
  name               = "${local.name}-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "api" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api_fn.arn}:*"]
  }
  statement {
    sid       = "RouteHistory"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan"]
    resources = [aws_dynamodb_table.route_history.arn]
  }
  statement {
    # the admin dashboard shows each driver's email
    sid       = "DriverEmails"
    actions   = ["cognito-idp:ListUsers"]
    resources = [aws_cognito_user_pool.users.arn]
  }
  statement {
    sid       = "TrafficGrid"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.traffic.arn}/${var.traffic_key}"]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "${local.name}-api"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name}-api"
  role             = aws_iam_role.api.arn
  runtime          = "python3.12"
  handler          = "lambda_handler.handler"
  filename         = local.lambda_zip
  source_code_hash = fileexists(local.lambda_zip) ? filebase64sha256(local.lambda_zip) : null
  memory_size      = 512
  # API Gateway gives up at 30 s
  timeout = 29

  environment {
    variables = {
      CORS_ORIGINS          = join(",", local.origins)
      TRAFFIC_BUCKET        = aws_s3_bucket.traffic.bucket
      TRAFFIC_KEY           = var.traffic_key
      DYNAMODB_ROUTES_TABLE = aws_dynamodb_table.route_history.name
      COGNITO_USER_POOL_ID  = aws_cognito_user_pool.users.id
    }
  }

  lifecycle {
    precondition {
      condition     = fileexists(local.lambda_zip)
      error_message = "No Lambda package at ${local.lambda_zip}. Run ./build-lambda.sh first."
    }
  }

  depends_on = [aws_cloudwatch_log_group.api_fn, aws_iam_role_policy.api]
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ---- Traffic refresh ------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "traffic_fn" {
  count             = local.traffic_enabled ? 1 : 0
  name              = "/aws/lambda/${local.name}-traffic-refresh"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "traffic" {
  count              = local.traffic_enabled ? 1 : 0
  name               = "${local.name}-traffic-refresh"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "traffic" {
  count = local.traffic_enabled ? 1 : 0
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.traffic_fn[0].arn}:*"]
  }
  statement {
    sid       = "PublishGrid"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.traffic.arn}/${var.traffic_key}"]
  }
}

resource "aws_iam_role_policy" "traffic" {
  count  = local.traffic_enabled ? 1 : 0
  name   = "${local.name}-traffic-refresh"
  role   = aws_iam_role.traffic[0].id
  policy = data.aws_iam_policy_document.traffic[0].json
}

resource "aws_lambda_function" "traffic" {
  count            = local.traffic_enabled ? 1 : 0
  function_name    = "${local.name}-traffic-refresh"
  role             = aws_iam_role.traffic[0].arn
  runtime          = "python3.12"
  handler          = "traffic_refresh.handler"
  filename         = local.lambda_zip
  source_code_hash = fileexists(local.lambda_zip) ? filebase64sha256(local.lambda_zip) : null
  # 288 LTA pages, 16 at a time, then about 140,000 records to parse
  memory_size = 1024
  timeout     = 90

  environment {
    variables = {
      LTA_ACCOUNT_KEY = var.lta_account_key
      TRAFFIC_BUCKET  = aws_s3_bucket.traffic.bucket
      TRAFFIC_KEY     = var.traffic_key
    }
  }

  depends_on = [aws_cloudwatch_log_group.traffic_fn, aws_iam_role_policy.traffic]
}

# A reading that failed is stale by the next run, so never retry it.
resource "aws_lambda_function_event_invoke_config" "traffic" {
  count                        = local.traffic_enabled ? 1 : 0
  function_name                = aws_lambda_function.traffic[0].function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 300
}

resource "aws_cloudwatch_event_rule" "traffic" {
  count               = local.traffic_enabled ? 1 : 0
  name                = "${local.name}-traffic-refresh"
  description         = "Publish the LTA road-speed grid to S3"
  schedule_expression = var.traffic_schedule
}

resource "aws_cloudwatch_event_target" "traffic" {
  count = local.traffic_enabled ? 1 : 0
  rule  = aws_cloudwatch_event_rule.traffic[0].name
  arn   = aws_lambda_function.traffic[0].arn
}

resource "aws_lambda_permission" "traffic_schedule" {
  count         = local.traffic_enabled ? 1 : 0
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.traffic[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.traffic[0].arn
}
