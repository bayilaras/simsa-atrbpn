locals {
  protected_environment = contains(["staging", "production"], var.environment)

  api_service_name       = "simsa-api"
  event_service_name     = "simsa-storage-events"
  final_cleanup_job_name = "simsa-final-orphan-cleanup"
  network_name           = "simsa-private"
  subnet_name            = "simsa-run-${var.region}"
  sql_instance_name      = "simsa-postgres"
  worker_instance_name   = "simsa-malware-worker"
  worker_subnet_name     = "simsa-worker-${var.region}"
  upload_bucket_name     = var.upload_bucket_name != "" ? var.upload_bucket_name : "${var.project_id}-simsa-upload"
  final_bucket_name      = var.final_bucket_name != "" ? var.final_bucket_name : "${var.project_id}-simsa-final"

  labels = merge(
    var.labels,
    {
      application = "simsa"
      environment = var.environment
      managed_by  = "terraform"
      data_class  = "internal"
    },
  )

  additional_trusted_origins = join(",", sort(tolist(setsubtract(
    var.frontend_origins,
    toset([var.primary_frontend_origin]),
  ))))
}

check "cloud_run_scaling" {
  assert {
    condition     = var.api_min_instances <= var.api_max_instances
    error_message = "api_min_instances cannot exceed api_max_instances."
  }
}

check "production_minimum" {
  assert {
    condition     = var.environment != "production" || var.api_min_instances >= 1
    error_message = "Production requires api_min_instances >= 1."
  }
}

check "bucket_separation" {
  assert {
    condition     = local.upload_bucket_name != local.final_bucket_name
    error_message = "Upload/quarantine and final buckets must be different."
  }
}

check "firebase_hosting_origin_boundary" {
  assert {
    condition = alltrue([
      for origin in var.frontend_origins :
      (
        (!endswith(origin, ".web.app") && !endswith(origin, ".firebaseapp.com")) ||
        contains([
          "https://${var.project_id}.web.app",
          "https://${var.project_id}.firebaseapp.com",
        ], origin)
      )
    ])
    error_message = "Firebase Hosting origins must belong to this environment project; use an explicit custom domain for any other hostname."
  }
}

check "worker_zone_boundary" {
  assert {
    condition     = startswith(var.worker_zone, "${var.region}-")
    error_message = "worker_zone must belong to the configured region."
  }
}

check "worker_image_boundary" {
  assert {
    condition     = startswith(var.worker_image, "${var.region}-docker.pkg.dev/${var.project_id}/")
    error_message = "worker_image must be an Artifact Registry digest in this environment project and region."
  }
}

check "backend_image_boundary" {
  assert {
    condition = (
      startswith(var.api_image, "${var.region}-docker.pkg.dev/${var.project_id}/") &&
      startswith(var.event_image, "${var.region}-docker.pkg.dev/${var.project_id}/")
    )
    error_message = "API and event images must come from Artifact Registry in this environment project and region."
  }
}

check "backend_image_parity" {
  assert {
    condition     = var.event_image == var.api_image
    error_message = "API and private Eventarc receiver must use the same reviewed backend image digest."
  }
}
