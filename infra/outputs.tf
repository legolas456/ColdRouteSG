output "console_url" {
  description = "The console, once scripts/deploy-frontend.sh has uploaded a build."
  value       = "${local.console_url}/"
}

output "amplify_app_id" {
  description = "AMPLIFY_APP_ID for scripts/deploy-frontend.sh."
  value       = aws_amplify_app.console.id
}

output "api_url" {
  value = aws_apigatewayv2_api.api.api_endpoint
}

output "traffic_url" {
  description = "VITE_TRAFFIC_URL for the console build."
  value       = "${aws_apigatewayv2_api.api.api_endpoint}/api/traffic/grid"
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.users.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.console.id
}

output "route_history_table" {
  value = aws_dynamodb_table.route_history.name
}

output "traffic_bucket" {
  value = aws_s3_bucket.traffic.bucket
}

output "traffic_function" {
  description = "Invoke it once to publish a grid without waiting for the schedule."
  value       = local.traffic_enabled ? aws_lambda_function.traffic[0].function_name : null
}

output "traffic_profile_function" {
  description = "Invoke it to rebuild typical traffic without waiting for the night."
  value       = local.traffic_enabled ? aws_lambda_function.profile[0].function_name : null
}

output "dashboard_url" {
  value = "https://${var.region}.console.aws.amazon.com/cloudwatch/home?region=${var.region}#dashboards/dashboard/${aws_cloudwatch_dashboard.main.dashboard_name}"
}

output "frontend_env" {
  description = "Build-time settings for the console (frontend/.env.production or the Deploy workflow)."
  value = {
    VITE_TRAFFIC_URL          = "${aws_apigatewayv2_api.api.api_endpoint}/api/traffic/grid"
    VITE_API_BASE_URL         = aws_apigatewayv2_api.api.api_endpoint
    VITE_COGNITO_USER_POOL_ID = aws_cognito_user_pool.users.id
    VITE_COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.console.id
  }
}
