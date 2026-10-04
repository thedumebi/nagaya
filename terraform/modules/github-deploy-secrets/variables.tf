variable "repositories" {
  description = "Repository names (without owner)."
  type        = set(string)
}

variable "secrets" {
  description = "Secret name → value, set on every repository."
  type        = map(string)
  sensitive   = true
}
