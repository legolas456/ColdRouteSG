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

variable "deploy_console" {
  description = "Build the console and upload it to Amplify as part of apply. Off: deploy it another way (scripts/deploy-frontend.sh, CI)."
  type        = bool
  default     = true
}

variable "lta_account_key" {
  description = "LTA DataMall AccountKey for live road speeds. Empty leaves out the scheduled traffic refresh."
  type        = string
  default     = ""
  sensitive   = true
}

variable "traffic_schedule" {
  description = "How often the traffic refresh runs. LTA updates every 5 minutes, but a reading is 288 calls and the key's quota is about 3,000 calls an hour, so every 10 minutes (1,728 an hour) leaves room."
  type        = string
  default     = "rate(10 minutes)"
}

variable "traffic_refresh_enabled" {
  description = "Run the traffic refresh on its schedule. Turn off to pause it, e.g. while LTA's call quota for the key is used up."
  type        = bool
  default     = true
}

variable "traffic_profile_schedule" {
  description = "When typical traffic is rebuilt from the kept readings; the default is 02:30 Singapore time."
  type        = string
  default     = "cron(30 18 * * ? *)"
}

variable "routing_region" {
  description = "Region the planner calls Amazon Location Service in. Its routing data differs by region: Sydney's is HERE's, while Singapore's own region uses GrabMaps, which on 29 Oct 2026 could not route to or from NUH and takes no traffic options."
  type        = string
  default     = "ap-southeast-2"
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
