# What the evaluation reports: API latency (p50/p95), errors and Lambda time,
# plus whether the traffic refresh keeps running.

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.name
  dashboard_body = jsonencode({
    widgets = concat(
      [
        {
          type = "metric", x = 0, y = 0, width = 12, height = 6
          properties = {
            title  = "API latency (ms)"
            region = var.region
            period = 300
            metrics = [
              ["AWS/ApiGateway", "Latency", "ApiId", aws_apigatewayv2_api.api.id, { stat = "p50", label = "p50" }],
              ["...", { stat = "p95", label = "p95" }],
              ["AWS/ApiGateway", "IntegrationLatency", "ApiId", aws_apigatewayv2_api.api.id, { stat = "p95", label = "Lambda p95" }],
            ]
          }
        },
        {
          type = "metric", x = 12, y = 0, width = 12, height = 6
          properties = {
            title  = "API requests and errors"
            region = var.region
            period = 300
            stat   = "Sum"
            metrics = [
              ["AWS/ApiGateway", "Count", "ApiId", aws_apigatewayv2_api.api.id],
              [".", "4xx", ".", "."],
              [".", "5xx", ".", "."],
            ]
          }
        },
        {
          type = "metric", x = 0, y = 6, width = 12, height = 6
          properties = {
            title  = "API function"
            region = var.region
            period = 300
            metrics = [
              ["AWS/Lambda", "Duration", "FunctionName", aws_lambda_function.api.function_name, { stat = "p95", label = "duration p95 (ms)" }],
              [".", "Errors", ".", ".", { stat = "Sum" }],
              [".", "Throttles", ".", ".", { stat = "Sum" }],
            ]
          }
        },
      ],
      local.traffic_enabled ? [
        {
          type = "metric", x = 12, y = 6, width = 12, height = 6
          properties = {
            title  = "Traffic refresh"
            region = var.region
            period = 300
            metrics = [
              ["AWS/Lambda", "Invocations", "FunctionName", aws_lambda_function.traffic[0].function_name, { stat = "Sum" }],
              [".", "Errors", ".", ".", { stat = "Sum" }],
              [".", "Duration", ".", ".", { stat = "Maximum", label = "duration max (ms)" }],
            ]
          }
        },
      ] : []
    )
  })
}

resource "aws_budgets_budget" "monthly" {
  count        = var.budget_email != "" ? 1 : 0
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}
