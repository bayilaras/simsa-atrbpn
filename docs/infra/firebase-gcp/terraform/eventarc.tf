resource "google_eventarc_trigger" "upload_finalized" {
  project  = var.project_id
  name     = "simsa-upload-finalized"
  location = var.region

  matching_criteria {
    attribute = "type"
    value     = "google.cloud.storage.object.v1.finalized"
  }

  matching_criteria {
    attribute = "bucket"
    value     = google_storage_bucket.upload.name
  }

  destination {
    cloud_run_service {
      service = google_cloud_run_v2_service.events.name
      region  = var.region
      path    = "/internal/events/storage-finalized"
    }
  }

  service_account = google_service_account.eventarc_invoker.email
  labels          = local.labels

  depends_on = [
    google_project_service.required["eventarc.googleapis.com"],
    google_project_service.required["eventarcpublishing.googleapis.com"],
    google_project_iam_member.gcs_event_publisher,
    google_project_iam_member.eventarc_event_receiver,
    google_cloud_run_v2_service_iam_member.eventarc_invoker,
  ]
}
