variable "project_id" {
  description = "The Google Cloud Platform project ID to deploy into."
  type        = string
}

variable "region" {
  description = "The target deployment region for single-region isolation."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "The primary zone for AlloyDB."
  type        = string
  default     = "us-central1-a"
}
