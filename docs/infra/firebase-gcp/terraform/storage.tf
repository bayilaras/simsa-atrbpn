resource "google_storage_bucket" "upload" {
  project                     = var.project_id
  name                        = local.upload_bucket_name
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = merge(local.labels, { purpose = "quarantine" })

  versioning {
    enabled = true
  }

  soft_delete_policy {
    retention_duration_seconds = 604800
  }

  cors {
    origin          = sort(tolist(var.frontend_origins))
    method          = ["PUT", "POST", "HEAD"]
    response_header = ["Content-Type", "Range", "x-goog-resumable", "x-guploader-uploadid"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      age        = var.upload_expiry_days
      with_state = "ANY"
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required["storage.googleapis.com"]]
}

resource "google_storage_bucket" "final" {
  project                     = var.project_id
  name                        = local.final_bucket_name
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = merge(local.labels, { purpose = "final" })

  versioning {
    enabled = true
  }

  soft_delete_policy {
    retention_duration_seconds = 2592000
  }

  retention_policy {
    retention_period = var.final_retention_seconds
    is_locked        = false
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required["storage.googleapis.com"]]
}

locals {
  upload_bucket_members = {
    api = google_service_account.api.member
  }

  final_bucket_members = {
    api = google_service_account.api.member
  }
}

resource "google_storage_bucket_iam_member" "upload_event_cleanup" {
  bucket = google_storage_bucket.upload.name
  role   = google_project_iam_custom_role.event_upload_cleanup.name
  member = google_service_account.events.member
}

resource "google_storage_bucket_iam_member" "upload_api_runtime" {
  for_each = local.upload_bucket_members

  bucket = google_storage_bucket.upload.name
  role   = google_project_iam_custom_role.api_quarantine_runtime.name
  member = each.value
}

resource "google_storage_bucket_iam_member" "final_api_runtime" {
  for_each = local.final_bucket_members

  bucket = google_storage_bucket.final.name
  role   = google_project_iam_custom_role.api_final_runtime.name
  member = each.value
}

resource "google_storage_bucket_iam_member" "worker_quarantine_runtime" {
  bucket = google_storage_bucket.upload.name
  role   = google_project_iam_custom_role.worker_quarantine_runtime.name
  member = google_service_account.worker.member
}

resource "google_storage_bucket_iam_member" "worker_final_runtime" {
  bucket = google_storage_bucket.final.name
  role   = google_project_iam_custom_role.worker_final_runtime.name
  member = google_service_account.worker.member
}

resource "google_storage_bucket_iam_member" "final_cleanup_runtime" {
  bucket = google_storage_bucket.final.name
  role   = google_project_iam_custom_role.final_cleanup_runtime.name
  member = google_service_account.final_cleanup.member
}
