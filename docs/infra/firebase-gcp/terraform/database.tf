resource "google_sql_database_instance" "postgres" {
  project          = var.project_id
  name             = local.sql_instance_name
  region           = var.region
  database_version = var.database_version

  deletion_protection = local.protected_environment
  deletion_policy     = local.protected_environment ? "PREVENT" : "DELETE"

  settings {
    tier              = var.database_tier
    edition           = "ENTERPRISE"
    availability_type = local.protected_environment ? "REGIONAL" : "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = var.database_disk_size_gb
    disk_autoresize   = true
    pricing_plan      = "PER_USE"
    data_api_access   = "DISALLOW_DATA_API"

    deletion_protection_enabled = local.protected_environment
    retain_backups_on_delete    = local.protected_environment

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "18:00"
      location                       = var.database_backup_location
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = var.database_backup_count
        retention_unit   = "COUNT"
      }
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.private.id
      enable_private_path_for_google_cloud_services = true
      ssl_mode                                      = "ENCRYPTED_ONLY"
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = true
    }

    maintenance_window {
      day          = 7
      hour         = 18
      update_track = "stable"
    }

    user_labels = local.labels

  }

  lifecycle {
    ignore_changes = [settings[0].disk_size]
  }

  depends_on = [
    google_project_service.required["sqladmin.googleapis.com"],
    google_service_networking_connection.private_services,
  ]
}

resource "google_sql_database" "simsa" {
  project  = var.project_id
  name     = var.database_name
  instance = google_sql_database_instance.postgres.name
  charset  = "UTF8"

  deletion_policy = local.protected_environment ? "ABANDON" : "DELETE"
}

resource "google_sql_user" "api" {
  project  = var.project_id
  name     = trimsuffix(google_service_account.api.email, ".gserviceaccount.com")
  instance = google_sql_database_instance.postgres.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"

  deletion_policy = local.protected_environment ? "ABANDON" : "DELETE"
}

resource "google_sql_user" "events" {
  project  = var.project_id
  name     = trimsuffix(google_service_account.events.email, ".gserviceaccount.com")
  instance = google_sql_database_instance.postgres.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"

  deletion_policy = local.protected_environment ? "ABANDON" : "DELETE"
}

resource "google_sql_user" "worker" {
  project  = var.project_id
  name     = trimsuffix(google_service_account.worker.email, ".gserviceaccount.com")
  instance = google_sql_database_instance.postgres.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"

  deletion_policy = local.protected_environment ? "ABANDON" : "DELETE"
}

resource "google_sql_user" "final_cleanup" {
  project  = var.project_id
  name     = trimsuffix(google_service_account.final_cleanup.email, ".gserviceaccount.com")
  instance = google_sql_database_instance.postgres.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"

  deletion_policy = local.protected_environment ? "ABANDON" : "DELETE"
}

resource "google_sql_user" "maintenance" {
  project  = var.project_id
  name     = trimsuffix(google_service_account.maintenance.email, ".gserviceaccount.com")
  instance = google_sql_database_instance.postgres.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"

  deletion_policy = local.protected_environment ? "ABANDON" : "DELETE"
}

resource "google_sql_user" "grant_admin" {
  project  = var.project_id
  name     = trimsuffix(google_service_account.grant_admin.email, ".gserviceaccount.com")
  instance = google_sql_database_instance.postgres.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"

  deletion_policy = local.protected_environment ? "ABANDON" : "DELETE"
}

resource "google_sql_user" "migrator" {
  project  = var.project_id
  name     = trimsuffix(google_service_account.migrator.email, ".gserviceaccount.com")
  instance = google_sql_database_instance.postgres.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"

  deletion_policy = local.protected_environment ? "ABANDON" : "DELETE"
}

resource "google_sql_user" "backup" {
  project  = var.project_id
  name     = trimsuffix(google_service_account.backup.email, ".gserviceaccount.com")
  instance = google_sql_database_instance.postgres.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"

  deletion_policy = local.protected_environment ? "ABANDON" : "DELETE"
}
