locals {
  required_services = toset([
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "cloudscheduler.googleapis.com",
    "eventarc.googleapis.com",
    "eventarcpublishing.googleapis.com",
    "firebase.googleapis.com",
    "firebaseappcheck.googleapis.com",
    "identitytoolkit.googleapis.com",
    "iap.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "oslogin.googleapis.com",
    "pubsub.googleapis.com",
    "recaptchaenterprise.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
  ])
}

resource "google_project_service" "required" {
  for_each = local.required_services

  project = var.project_id
  service = each.value

  disable_on_destroy = false
}

data "google_project" "current" {
  project_id = var.project_id
}

data "google_storage_project_service_account" "gcs" {
  project = var.project_id

  depends_on = [google_project_service.required["storage.googleapis.com"]]
}
