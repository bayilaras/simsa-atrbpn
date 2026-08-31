resource "google_secret_manager_secret" "firebase_session_csrf" {
  project   = var.project_id
  secret_id = "simsa-firebase-session-csrf"

  labels = merge(local.labels, { purpose = "session-csrf" })

  annotations = {
    owner                = "simsa-platform"
    payload_managed_by   = "out-of-band"
    rotation_runbook_ref = "docs/infra/firebase-gcp/README.md"
  }

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  deletion_protection = local.protected_environment

  depends_on = [google_project_service.required["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_iam_member" "api_session_csrf_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.firebase_session_csrf.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.api.member
}

resource "google_secret_manager_secret" "worker_environment" {
  project   = var.project_id
  secret_id = "simsa-worker-environment"

  labels = merge(local.labels, { purpose = "malware-worker-env" })

  annotations = {
    owner                = "simsa-platform"
    payload_managed_by   = "out-of-band"
    rotation_runbook_ref = "deploy/workers/README.md"
  }

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  deletion_protection = local.protected_environment

  depends_on = [google_project_service.required["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_iam_member" "worker_environment_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.worker_environment.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.worker.member
}

# Deliberately absent: google_secret_manager_secret_version. Secret payloads
# must never pass through Terraform variables, plans, logs, or state.
