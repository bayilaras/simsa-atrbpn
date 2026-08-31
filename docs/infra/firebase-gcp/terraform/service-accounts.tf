resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = "simsa-api-runtime"
  display_name = "SIMSA API runtime (${var.environment})"
  description  = "Runtime only; no user-managed key may be created."
}

resource "google_service_account" "events" {
  project      = var.project_id
  account_id   = "simsa-event-runtime"
  display_name = "SIMSA storage event runtime (${var.environment})"
  description  = "Processes private Cloud Storage finalized events; no user-managed key."
}

resource "google_service_account" "eventarc_invoker" {
  project      = var.project_id
  account_id   = "simsa-eventarc-invoker"
  display_name = "SIMSA Eventarc invoker (${var.environment})"
  description  = "Invocation identity only; it does not read database, secrets, or objects."
}

resource "google_service_account" "worker" {
  project      = var.project_id
  account_id   = "simsa-malware-worker"
  display_name = "SIMSA malware worker (${var.environment})"
  description  = "Single-purpose ClamAV worker runtime; no user-managed key may be created."
}

resource "google_service_account" "final_cleanup" {
  project      = var.project_id
  account_id   = "simsa-final-cleanup"
  display_name = "SIMSA final orphan cleanup (${var.environment})"
  description  = "Cloud Run Job only; verifies and deletes exact queued final-object generations without listing."
}

resource "google_service_account" "maintenance" {
  project      = var.project_id
  account_id   = "simsa-db-maintenance"
  display_name = "SIMSA database maintenance (${var.environment})"
  description  = "Reviewed seed convergence only; no schema ownership, runtime, storage, or user-managed key access."
}

resource "google_service_account" "grant_admin" {
  project      = var.project_id
  account_id   = "simsa-db-grant-admin"
  display_name = "SIMSA database grant administrator (${var.environment})"
  description  = "Approved role bootstrap and ownership convergence only; no runtime, storage, Firebase, or user-managed key access."
}

resource "google_service_account" "migrator" {
  project      = var.project_id
  account_id   = "simsa-db-migrator"
  display_name = "SIMSA database migrator (${var.environment})"
  description  = "Reviewed Drizzle migrations only; no runtime, storage, Firebase, or user-managed key access."
}

resource "google_service_account" "backup" {
  project      = var.project_id
  account_id   = "simsa-db-backup"
  display_name = "SIMSA database backup reader (${var.environment})"
  description  = "Portable pg_dump and read-only backup evidence only; no runtime, storage, schema, seed, or user-managed key access."
}

resource "google_service_account" "cleanup_scheduler" {
  project      = var.project_id
  account_id   = "simsa-cleanup-scheduler"
  display_name = "SIMSA cleanup scheduler (${var.environment})"
  description  = "Invocation-only identity for the final orphan cleanup job."
}

locals {
  sql_runtime_members = {
    api         = google_service_account.api.member
    backup      = google_service_account.backup.member
    cleanup     = google_service_account.final_cleanup.member
    events      = google_service_account.events.member
    grant_admin = google_service_account.grant_admin.member
    maintenance = google_service_account.maintenance.member
    migrator    = google_service_account.migrator.member
    worker      = google_service_account.worker.member
  }
}

resource "google_project_iam_member" "cloud_sql_client" {
  for_each = local.sql_runtime_members

  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = each.value
}

resource "google_project_iam_member" "cloud_sql_instance_user" {
  for_each = local.sql_runtime_members

  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = each.value
}

resource "google_project_iam_custom_role" "database_evidence_metadata_reader" {
  project     = var.project_id
  role_id     = "simsaDbEvidenceMetadata"
  title       = "SIMSA database evidence metadata reader"
  description = "Read only project and bucket metadata needed to seal database maintenance/bootstrap evidence; grants no object access."
  permissions = [
    "resourcemanager.projects.get",
    "storage.buckets.get",
  ]

  depends_on = [google_project_service.required["storage.googleapis.com"]]
}

resource "google_project_iam_member" "grant_admin_database_evidence_metadata" {
  project = var.project_id
  role    = google_project_iam_custom_role.database_evidence_metadata_reader.name
  member  = google_service_account.grant_admin.member
}

resource "google_project_iam_member" "backend_deploy_database_evidence_metadata" {
  project = var.project_id
  role    = google_project_iam_custom_role.database_evidence_metadata_reader.name
  member  = "serviceAccount:${var.backend_deploy_service_account_email}"
}

resource "google_project_iam_custom_role" "api_firebase_session_runtime" {
  project     = var.project_id
  role_id     = "simsaFirebaseSessionRuntime"
  title       = "SIMSA Firebase Auth runtime"
  description = "Minimum Firebase Auth permissions for sessions plus transactional application user create/delete compensation."
  permissions = [
    "firebaseauth.configs.get",
    "firebaseauth.users.create",
    "firebaseauth.users.createSession",
    "firebaseauth.users.delete",
    "firebaseauth.users.get",
    "firebaseauth.users.update",
  ]

  depends_on = [google_project_service.required["identitytoolkit.googleapis.com"]]
}

resource "google_project_iam_member" "api_firebase_session_runtime" {
  project = var.project_id
  role    = google_project_iam_custom_role.api_firebase_session_runtime.name
  member  = google_service_account.api.member
}

resource "google_project_iam_custom_role" "api_quarantine_runtime" {
  project     = var.project_id
  role_id     = "simsaApiQuarantineRuntime"
  title       = "SIMSA API quarantine runtime"
  description = "Create and inspect resumable uploads, and delete only compensated or rejected quarantine objects."
  permissions = [
    "storage.objects.create",
    "storage.objects.delete",
    "storage.objects.get",
  ]

  depends_on = [google_project_service.required["storage.googleapis.com"]]
}

resource "google_project_iam_custom_role" "api_final_runtime" {
  project     = var.project_id
  role_id     = "simsaApiFinalRuntime"
  title       = "SIMSA API final-object runtime"
  description = "Create immutable objects with metadata and read authorized records; readiness uses the permission-test API and never enumerates, mutates, or deletes objects."
  permissions = [
    "storage.objects.create",
    "storage.objects.get",
  ]

  depends_on = [google_project_service.required["storage.googleapis.com"]]
}

resource "google_project_iam_custom_role" "event_upload_cleanup" {
  project     = var.project_id
  role_id     = "simsaEventUploadCleanup"
  title       = "SIMSA Eventarc upload cleanup"
  description = "Delete only a rejected, exact-generation upload object after validation fails."
  permissions = [
    "storage.objects.delete",
  ]

  depends_on = [google_project_service.required["storage.googleapis.com"]]
}

resource "google_project_iam_custom_role" "worker_quarantine_runtime" {
  project     = var.project_id
  role_id     = "simsaWorkerQuarantineRuntime"
  title       = "SIMSA malware worker quarantine runtime"
  description = "Read exact quarantine generations and delete source generations selected by the lease reconciler."
  permissions = [
    "storage.objects.delete",
    "storage.objects.get",
  ]

  depends_on = [google_project_service.required["storage.googleapis.com"]]
}

resource "google_project_iam_custom_role" "worker_final_runtime" {
  project     = var.project_id
  role_id     = "simsaWorkerFinalRuntime"
  title       = "SIMSA malware worker final runtime"
  description = "Create scanner-clean final objects and verify their immutable metadata; never delete them."
  permissions = [
    "storage.objects.create",
    "storage.objects.get",
  ]

  depends_on = [google_project_service.required["storage.googleapis.com"]]
}

resource "google_project_iam_custom_role" "final_cleanup_runtime" {
  project     = var.project_id
  role_id     = "simsaFinalCleanupRuntime"
  title       = "SIMSA final orphan cleanup runtime"
  description = "Read and delete only exact durable-queue candidates in the final bucket; never create, update, or enumerate objects."
  permissions = [
    "storage.objects.delete",
    "storage.objects.get",
  ]

  depends_on = [google_project_service.required["storage.googleapis.com"]]
}

resource "google_project_iam_member" "worker_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = google_service_account.worker.member
}

resource "google_project_iam_member" "worker_monitoring" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = google_service_account.worker.member
}

resource "google_project_iam_custom_role" "worker_iap_discovery" {
  project     = var.project_id
  role_id     = "simsaWorkerIapDiscovery"
  title       = "SIMSA worker IAP discovery"
  description = "Read only the Compute metadata required by gcloud IAP SSH."
  permissions = [
    "compute.instances.get",
    "compute.instances.list",
    "compute.projects.get",
  ]

  depends_on = [google_project_service.required["compute.googleapis.com"]]
}

resource "google_project_iam_member" "worker_operator_discovery" {
  for_each = var.worker_operator_members

  project = var.project_id
  role    = google_project_iam_custom_role.worker_iap_discovery.name
  member  = each.value
}

resource "google_project_iam_member" "gcs_event_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}
