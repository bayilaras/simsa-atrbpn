output "environment_boundary" {
  description = "Project and environment that this isolated state manages."
  value = {
    environment = var.environment
    project_id  = var.project_id
    region      = var.region
  }
}

output "cloud_run_api" {
  description = "Cloud Run API identity and URI. Prefer access through Firebase Hosting."
  value = {
    name = google_cloud_run_v2_service.api.name
    uri  = google_cloud_run_v2_service.api.uri
  }
}

output "cloud_run_events" {
  description = "Private Eventarc receiver identity and URI."
  value = {
    name = google_cloud_run_v2_service.events.name
    uri  = google_cloud_run_v2_service.events.uri
  }
}

output "cloud_sql" {
  description = "Non-secret Cloud SQL identifiers used for operational verification."
  value = {
    instance_name   = google_sql_database_instance.postgres.name
    connection_name = google_sql_database_instance.postgres.connection_name
    database_name   = google_sql_database.simsa.name
    private_ip      = google_sql_database_instance.postgres.private_ip_address
  }
}

output "storage_buckets" {
  description = "Private bucket names. These are locators, not authorization credentials."
  value = {
    upload_quarantine = google_storage_bucket.upload.name
    final             = google_storage_bucket.final.name
  }
}

output "firebase_session_csrf_secret_id" {
  description = "Secret container only; payload and value are intentionally absent from Terraform."
  value       = google_secret_manager_secret.firebase_session_csrf.id
}

output "malware_worker" {
  description = "Non-secret identifiers for IAP operations and recovery. The VM has no public IP."
  value = {
    instance_name              = google_compute_instance.worker.name
    zone                       = google_compute_instance.worker.zone
    internal_ip                = google_compute_instance.worker.network_interface[0].network_ip
    service_account            = google_service_account.worker.email
    signature_disk             = google_compute_disk.worker_signatures.name
    environment_secret_id      = google_secret_manager_secret.worker_environment.secret_id
    environment_secret_version = var.worker_environment_secret_version
    worker_image               = var.worker_image
  }
}

output "final_orphan_cleanup" {
  description = "Dedicated cleanup identities and scheduled Cloud Run Job; no secret values."
  value = {
    job_name           = google_cloud_run_v2_job.final_cleanup.name
    runtime_identity   = google_service_account.final_cleanup.email
    database_principal = google_sql_user.final_cleanup.name
    scheduler_job      = google_cloud_scheduler_job.final_cleanup.name
    scheduler_identity = google_service_account.cleanup_scheduler.email
  }
}

output "database_runtime_identities" {
  description = "Canonical Terraform-owned runtime service-account to Cloud SQL IAM-login bindings."
  value = {
    project_id = var.project_id
    api = {
      service_account    = google_service_account.api.email
      database_principal = google_sql_user.api.name
    }
    events = {
      service_account    = google_service_account.events.email
      database_principal = google_sql_user.events.name
    }
    worker = {
      service_account    = google_service_account.worker.email
      database_principal = google_sql_user.worker.name
    }
    final_cleanup = {
      service_account    = google_service_account.final_cleanup.email
      database_principal = google_sql_user.final_cleanup.name
    }
  }
}

output "database_maintenance" {
  description = "Dedicated keyless database identities. Grant-admin still requires the documented one-time PostgreSQL CREATEROLE/ownership ceremony."
  value = {
    grant_admin_service_account = google_service_account.grant_admin.email
    grant_admin_principal       = google_sql_user.grant_admin.name
    maintenance_service_account = google_service_account.maintenance.email
    maintenance_principal       = google_sql_user.maintenance.name
    migrator_service_account    = google_service_account.migrator.email
    migrator_principal          = google_sql_user.migrator.name
    backup_service_account      = google_service_account.backup.email
    backup_principal            = google_sql_user.backup.name
  }
}

output "cloud_sql_backup_identity" {
  description = "Dedicated keyless read-only database backup identity; no storage IAM is attached."
  value = {
    service_account    = google_service_account.backup.email
    database_principal = google_sql_user.backup.name
  }
}
