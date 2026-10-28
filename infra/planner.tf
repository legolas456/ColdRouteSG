# The planner (planner/): the console's optimiser on Lambda, behind the
# signed-in POST /api/plan. It gathers what a plan reads itself: the NEA
# forecast and HDB lots from data.gov.sg, and from the traffic bucket LTA's URA
# and mall carparks, the live road-speed grid and typical traffic. Drive times
# come from Amazon Location Service in var.routing_region, cached in DynamoDB.

resource "aws_cloudwatch_log_group" "planner_fn" {
  name              = "/aws/lambda/${local.name}-planner"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "planner" {
  name               = "${local.name}-planner"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "planner" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.planner_fn.arn}:*"]
  }
  statement {
    # drive times between stops, and the road lines of the two plans
    sid       = "Routes"
    actions   = ["geo-routes:CalculateRouteMatrix", "geo-routes:CalculateRoutes"]
    resources = ["arn:aws:geo-routes:${var.routing_region}::provider/default"]
  }
  statement {
    sid       = "DriveTimes"
    actions   = ["dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"]
    resources = [aws_dynamodb_table.drive_times.arn]
  }
  statement {
    sid       = "Inputs"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.traffic.arn}/${var.traffic_key}", "${aws_s3_bucket.traffic.arn}/traffic/typical/*", "${aws_s3_bucket.traffic.arn}/parking/carparks.json"]
  }
  statement {
    # so an input not published yet reads as missing, not forbidden
    sid       = "MissingInputs"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.traffic.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = [var.traffic_key, "traffic/typical/*", "parking/carparks.json"]
    }
  }
}

resource "aws_iam_role_policy" "planner" {
  name   = "${local.name}-planner"
  role   = aws_iam_role.planner.id
  policy = data.aws_iam_policy_document.planner.json
}

resource "aws_lambda_function" "planner" {
  function_name = "${local.name}-planner"
  role          = aws_iam_role.planner.arn
  runtime       = "nodejs22.x"
  handler       = "index.handler"
  filename      = local.planner_zip
  # changes when the package's sources do; the package is built during apply (build.tf)
  source_code_hash = local.planner_package_hash
  # most of a plan is waiting on data.gov.sg, S3 and Location Service; the
  # search itself took 57 ms for 15 stops on a laptop
  memory_size = 1024
  # API Gateway gives up at 30 s
  timeout = 29

  environment {
    variables = {
      TRAFFIC_BUCKET    = aws_s3_bucket.traffic.bucket
      TRAFFIC_KEY       = var.traffic_key
      DRIVE_TIMES_TABLE = aws_dynamodb_table.drive_times.name
      ROUTING_REGION    = var.routing_region
      METRICS_NAMESPACE = local.metrics_namespace
    }
  }

  depends_on = [terraform_data.planner_package, aws_cloudwatch_log_group.planner_fn, aws_iam_role_policy.planner]
}

resource "aws_lambda_permission" "planner_api" {
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.planner.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*/api/plan"
}
