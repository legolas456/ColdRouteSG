# Sign-in: drivers and dispatch managers sign in with their email. Managers are
# in the "admin" group, which the backend checks for the admin dashboard.

resource "aws_cognito_user_pool" "users" {
  name                     = "${local.name}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = var.protect_data ? "ACTIVE" : "INACTIVE"

  admin_create_user_config {
    allow_admin_create_user_only = !var.self_sign_up
  }

  password_policy {
    minimum_length                   = 10
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

# The console is a single-page app, so its client has no secret. SRP is what
# Amplify's sign-in uses; password auth lets scripts (the load test, the CLI)
# get a token.
resource "aws_cognito_user_pool_client" "console" {
  name                          = "${local.name}-console"
  user_pool_id                  = aws_cognito_user_pool.users.id
  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"
  explicit_auth_flows           = ["ALLOW_USER_SRP_AUTH", "ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.users.id
  description  = "Dispatch managers: the admin dashboard and every driver's runs"
}
