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

# Every reading is kept (about 13 KB each, 144 a day at the 10-minute
# schedule) for the typical-traffic profile; old ones expire. The stretch
# index they refer to does not.
resource "aws_s3_bucket_lifecycle_configuration" "traffic" {
  bucket = aws_s3_bucket.traffic.id

  rule {
    id     = "expire-traffic-history"
    status = "Enabled"
    filter {
      prefix = "traffic/history/"
    }
    expiration {
      days = var.traffic_history_days
    }
  }
}

# Drive times between pairs of places as Amazon Location Service measured them
# (planner/src/roads.ts), keyed by both positions. Location Service bills every
# pair, so the planner asks for each at most once a month; DynamoDB deletes
# expired ones. A cache: nothing here needs protecting or backing up.
resource "aws_dynamodb_table" "drive_times" {
  name         = "${local.name}-drive-times"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pair"

  attribute {
    name = "pair"
    type = "S"
  }

  ttl {
    attribute_name = "expires"
    enabled        = true
  }
}
