variable "region" {
  description = "AWS region for every resource."
  type        = string
  default     = "ap-southeast-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to deploy with; null uses AWS_PROFILE or the default profile."
  type        = string
  default     = null
}

variable "prefix" {
  description = "Prefix for resource names, so two stacks can share an account."
  type        = string
  default     = "coldroute"
}

variable "lambda_zip" {
  description = "The backend package built by build-lambda.sh, relative to this folder."
  type        = string
  default     = "build/backend.zip"
}

variable "lta_account_key" {
  description = "LTA DataMall AccountKey for live road speeds. Empty leaves out the scheduled traffic refresh."
  type        = string
  default     = ""
  sensitive   = true
}

variable "traffic_schedule" {
  description = "How often the traffic refresh runs; LTA updates its speed bands every 5 minutes."
  type        = string
  default     = "rate(5 minutes)"
}

variable "traffic_key" {
  description = "S3 key of the published road-speed grid."
  type        = string
  default     = "traffic/speed-grid.json"
}

variable "traffic_history_days" {
  description = "How long the kept LTA readings (the typical-traffic history) stay in S3."
  type        = number
  default     = 180
}

variable "extra_origins" {
  description = "Origins besides the Amplify console that may call the API, e.g. a local dev server."
  type        = list(string)
  default     = ["http://localhost:5173"]
}

variable "self_sign_up" {
  description = "Let anyone create an account. Off: an admin creates every user (see README)."
  type        = bool
  default     = false
}

variable "protect_data" {
  description = "Deletion protection for the user pool and route history, and keep the traffic bucket on destroy. Turn on for the team's real stack."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps the Lambda and API logs."
  type        = number
  default     = 14
}

variable "budget_email" {
  description = "Email for the monthly cost alert. Empty creates no budget."
  type        = string
  default     = ""
}

variable "budget_limit_usd" {
  description = "Monthly budget for the whole account, in US dollars."
  type        = number
  default     = 10
}
