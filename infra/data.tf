# Each driver's saved runs, newest first: the sort key starts with the time
# the run was saved (backend/app/services/dynamodb.py on the Cognito branch).
resource "aws_dynamodb_table" "route_history" {
  name                        = "${local.name}-route-history"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "user_id"
  range_key                   = "route_id"
  deletion_protection_enabled = var.protect_data

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "route_id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.protect_data
  }
}

# The road-speed grid the traffic refresh publishes. Private: the console reads
# it through the API's public /api/traffic/grid route.
resource "aws_s3_bucket" "traffic" {
  bucket        = "${local.name}-traffic-${data.aws_caller_identity.current.account_id}"
  force_destroy = !var.protect_data
}

resource "aws_s3_bucket_public_access_block" "traffic" {
  bucket                  = aws_s3_bucket.traffic.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
