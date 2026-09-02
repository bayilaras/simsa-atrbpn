variable "project_id" {
  description = "Existing Firebase/GCP project dedicated to exactly one SIMSA environment."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid GCP project ID."
  }
}

variable "environment" {
  description = "Deployment boundary. Use a different GCP project and Terraform state for each value."
  type        = string

  validation {
    condition     = contains(["preview", "staging", "production"], var.environment)
    error_message = "environment must be preview, staging, or production."
  }
}

variable "region" {
  description = "Single region for Cloud Run, Cloud SQL, Eventarc, GCS, subnet, and secret replica."
  type        = string
  default     = "asia-southeast2"

  validation {
    condition     = can(regex("^[a-z]+-[a-z0-9]+[0-9]$", var.region))
    error_message = "region must be a canonical GCP region such as asia-southeast2."
  }
}

variable "api_image" {
  description = "Immutable Artifact Registry image digest for the SIMSA API."
  type        = string

  validation {
    condition = (
      can(regex("^[a-z0-9.-]+-docker\\.pkg\\.dev/.+@sha256:[0-9a-f]{64}$", var.api_image)) &&
      !can(regex("@sha256:0{64}$", var.api_image))
    )
    error_message = "api_image must be an Artifact Registry URL pinned by a real, non-placeholder sha256 digest."
  }
}

variable "event_image" {
  description = "Immutable Artifact Registry image digest for the private storage-event receiver."
  type        = string

  validation {
    condition = (
      can(regex("^[a-z0-9.-]+-docker\\.pkg\\.dev/.+@sha256:[0-9a-f]{64}$", var.event_image)) &&
      !can(regex("@sha256:0{64}$", var.event_image))
    )
    error_message = "event_image must be an Artifact Registry URL pinned by a real, non-placeholder sha256 digest."
  }
}

variable "cloud_sql_proxy_image" {
  description = "Reviewed Cloud SQL Auth Proxy v2 image pinned by digest."
  type        = string

  validation {
    condition = (
      can(regex("@sha256:[0-9a-f]{64}$", var.cloud_sql_proxy_image)) &&
      !can(regex("@sha256:0{64}$", var.cloud_sql_proxy_image))
    )
    error_message = "cloud_sql_proxy_image must be pinned by a real, non-placeholder sha256 digest."
  }
}

variable "worker_image" {
  description = "Immutable Artifact Registry digest for the malware worker; the repository must already exist."
  type        = string

  validation {
    condition = (
      can(regex("^[a-z0-9.-]+-docker\\.pkg\\.dev/[a-z0-9-]+/[a-z0-9._-]+/.+@sha256:[0-9a-f]{64}$", var.worker_image)) &&
      !can(regex("@sha256:0{64}$", var.worker_image))
    )
    error_message = "worker_image must be a real Artifact Registry image digest, not a tag or placeholder."
  }
}

variable "worker_boot_image" {
  description = "Exact hardened Compute Engine image containing Docker, Compose, gcloud, and the reviewed deploy/workers bundle; image families are forbidden."
  type        = string

  validation {
    condition     = can(regex("^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/global/images/[a-z][a-z0-9-]{2,62}$", var.worker_boot_image))
    error_message = "worker_boot_image must identify one exact projects/.../global/images/... image, never a mutable family."
  }
}

variable "worker_zone" {
  description = "Zone for the single recoverable worker VM and its persistent signature disk."
  type        = string
  default     = "asia-southeast2-a"

  validation {
    condition     = can(regex("^[a-z]+-[a-z0-9]+[0-9]-[a-z]$", var.worker_zone))
    error_message = "worker_zone must be a canonical Compute Engine zone."
  }
}

variable "worker_machine_type" {
  description = "Worker VM size. e2-standard-2 is the low-cost baseline for ClamAV plus the Node worker; micro/small shapes are rejected."
  type        = string
  default     = "e2-standard-2"

  validation {
    condition = (
      can(regex("^[a-z][a-z0-9-]{2,62}$", var.worker_machine_type)) &&
      !contains(["e2-micro", "e2-small", "f1-micro", "g1-small"], var.worker_machine_type)
    )
    error_message = "worker_machine_type must be a valid non-micro/non-small machine; ClamAV needs materially more RAM."
  }
}

variable "worker_boot_disk_size_gb" {
  description = "Boot disk capacity for the hardened host and immutable container layers."
  type        = number
  default     = 30

  validation {
    condition     = var.worker_boot_disk_size_gb >= 20 && var.worker_boot_disk_size_gb <= 200
    error_message = "worker_boot_disk_size_gb must be between 20 and 200."
  }
}

variable "worker_signature_disk_size_gb" {
  description = "Persistent balanced disk capacity for /var/lib/clamav signatures."
  type        = number
  default     = 20

  validation {
    condition     = var.worker_signature_disk_size_gb >= 10 && var.worker_signature_disk_size_gb <= 500
    error_message = "worker_signature_disk_size_gb must be between 10 and 500."
  }
}

variable "worker_db_pool_max" {
  description = "Database pool cap for the single malware worker process."
  type        = number
  default     = 3

  validation {
    condition     = var.worker_db_pool_max >= 1 && var.worker_db_pool_max <= 10
    error_message = "worker_db_pool_max must be between 1 and 10."
  }
}

variable "worker_environment_secret_version" {
  description = "Pinned numeric version of the out-of-band simsa-worker-environment dotenv payload."
  type        = string

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.worker_environment_secret_version))
    error_message = "Use a pinned numeric worker environment secret version, not latest."
  }
}

variable "worker_operator_members" {
  description = "JIT-controlled user/group principals permitted to administer the worker through IAP and OS Login. Empty means no interactive access."
  type        = set(string)
  default     = []

  validation {
    condition = alltrue([
      for member in var.worker_operator_members :
      can(regex("^(user|group):[^@[:space:]]+@[^@[:space:]]+$", member))
    ])
    error_message = "worker_operator_members accepts only explicit user: or group: email principals."
  }
}

variable "frontend_origins" {
  description = "Exact HTTPS origins allowed for CORS and application trust. No wildcard is accepted."
  type        = set(string)

  validation {
    condition = length(var.frontend_origins) > 0 && alltrue([
      for origin in var.frontend_origins :
      can(regex("^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$", origin)) && !strcontains(origin, "*")
    ])
    error_message = "frontend_origins must contain exact HTTPS origins without paths, query strings, credentials, or wildcards."
  }
}

variable "primary_frontend_origin" {
  description = "Canonical Firebase Hosting/custom-domain origin used for FRONTEND_URL and upload session origin binding."
  type        = string

  validation {
    condition     = contains(var.frontend_origins, var.primary_frontend_origin)
    error_message = "primary_frontend_origin must also be present in frontend_origins."
  }
}

variable "firebase_app_check_app_ids" {
  description = "Exact Firebase Web App IDs whose App Check tokens the API accepts. Use environment-local apps only."
  type        = set(string)

  validation {
    condition = length(var.firebase_app_check_app_ids) > 0 && alltrue([
      for app_id in var.firebase_app_check_app_ids :
      can(regex("^1:[0-9]{6,}:web:[0-9A-Fa-f]{8,}$", app_id))
    ])
    error_message = "firebase_app_check_app_ids must contain canonical Firebase Web App IDs."
  }
}

variable "database_version" {
  description = "Cloud SQL PostgreSQL engine version. Test extensions and restore compatibility before changing."
  type        = string
  default     = "POSTGRES_17"

  validation {
    condition     = contains(["POSTGRES_16", "POSTGRES_17"], var.database_version)
    error_message = "database_version must be POSTGRES_16 or POSTGRES_17."
  }
}

variable "database_tier" {
  description = "Cloud SQL machine tier sized from load tests; examples deliberately require an explicit value."
  type        = string

  validation {
    condition     = can(regex("^db-(custom|perf-optimized)-", var.database_tier))
    error_message = "database_tier must be an explicit custom or performance-optimized Cloud SQL tier."
  }
}

variable "database_name" {
  description = "Application database name."
  type        = string
  default     = "simsa"

  validation {
    condition     = can(regex("^[a-z][a-z0-9_]{2,62}$", var.database_name))
    error_message = "database_name must be a lowercase PostgreSQL identifier."
  }
}

variable "database_disk_size_gb" {
  description = "Initial SSD size; disk autoresize is enabled."
  type        = number
  default     = 50

  validation {
    condition     = var.database_disk_size_gb >= 20 && var.database_disk_size_gb <= 65536
    error_message = "database_disk_size_gb must be between 20 and 65536."
  }
}

variable "database_backup_location" {
  description = "Cloud SQL automated-backup location; choose according to residency and DR policy."
  type        = string
  default     = "asia"
}

variable "database_backup_count" {
  description = "Number of automated backups retained."
  type        = number
  default     = 30

  validation {
    condition     = var.database_backup_count >= 7 && var.database_backup_count <= 365
    error_message = "database_backup_count must be between 7 and 365."
  }
}

variable "api_min_instances" {
  description = "Minimum API instances. Production should normally use at least one."
  type        = number
  default     = 0

  validation {
    condition     = var.api_min_instances >= 0 && var.api_min_instances <= 10
    error_message = "api_min_instances must be between 0 and 10."
  }
}

variable "api_max_instances" {
  description = "Maximum API instances; coordinate with DB pool and Cloud SQL connection budget."
  type        = number
  default     = 10

  validation {
    condition     = var.api_max_instances >= 1 && var.api_max_instances <= 100
    error_message = "api_max_instances must be between 1 and 100."
  }
}

variable "event_max_instances" {
  description = "Maximum event receiver instances; bounds database and storage fan-out."
  type        = number
  default     = 5

  validation {
    condition     = var.event_max_instances >= 1 && var.event_max_instances <= 50
    error_message = "event_max_instances must be between 1 and 50."
  }
}

variable "db_pool_max" {
  description = "Per-container PostgreSQL pool size. Ensure (API + event max instances) * pool is within DB limits."
  type        = number
  default     = 5

  validation {
    condition     = var.db_pool_max >= 1 && var.db_pool_max <= 20
    error_message = "db_pool_max must be between 1 and 20."
  }
}

variable "upload_bucket_name" {
  description = "Optional globally unique upload bucket override; empty uses <project>-simsa-upload."
  type        = string
  default     = ""

  validation {
    condition = (
      var.upload_bucket_name == "" ||
      can(regex("^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$", var.upload_bucket_name))
    )
    error_message = "upload_bucket_name must be empty or a valid 3-63 character GCS bucket name."
  }
}

variable "final_bucket_name" {
  description = "Optional globally unique final bucket override; empty uses <project>-simsa-final."
  type        = string
  default     = ""

  validation {
    condition = (
      var.final_bucket_name == "" ||
      can(regex("^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$", var.final_bucket_name))
    )
    error_message = "final_bucket_name must be empty or a valid 3-63 character GCS bucket name."
  }
}

variable "upload_expiry_days" {
  description = "Age after which unclaimed quarantine objects become eligible for lifecycle deletion."
  type        = number
  default     = 7

  validation {
    condition     = var.upload_expiry_days >= 1 && var.upload_expiry_days <= 30
    error_message = "upload_expiry_days must be between 1 and 30."
  }
}

variable "final_retention_seconds" {
  description = "Unlocked minimum bucket retention. Legal/JRA retention remains an application policy."
  type        = number
  default     = 604800

  validation {
    condition     = var.final_retention_seconds >= 86400 && var.final_retention_seconds <= 31536000
    error_message = "final_retention_seconds must be between one day and one year."
  }
}

variable "firebase_session_csrf_secret_version" {
  description = "Existing enabled Secret Manager version number. The secret value is never a Terraform variable."
  type        = string

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.firebase_session_csrf_secret_version))
    error_message = "Use a pinned numeric secret version, not latest."
  }
}

variable "backend_deploy_service_account_email" {
  description = "Existing keyless GitHub backend-deploy service account that must read project/bucket metadata for live release drift checks."
  type        = string

  validation {
    condition = can(regex(
      "^[a-z][a-z0-9-]{4,28}[a-z0-9]@${var.project_id}\\.iam\\.gserviceaccount\\.com$",
      var.backend_deploy_service_account_email,
    ))
    error_message = "backend_deploy_service_account_email must be an existing service account in project_id."
  }
}

variable "labels" {
  description = "Additional non-sensitive labels."
  type        = map(string)
  default     = {}
}
