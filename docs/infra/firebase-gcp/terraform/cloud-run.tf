locals {
  api_environment = {
    NODE_ENV                              = "production"
    APP_PROFILE                           = "internal"
    SIMSA_CLOUD_PLATFORM                  = "gcp"
    AUTH_PROVIDER                         = "firebase"
    OBJECT_STORAGE_PROVIDER               = "gcs"
    GOOGLE_CLOUD_PROJECT                  = var.project_id
    FIREBASE_PROJECT_ID                   = var.project_id
    FIREBASE_SESSION_MAX_AGE_HOURS        = "24"
    FIREBASE_CHECK_REVOKED                = "true"
    FIREBASE_APP_CHECK_REQUIRED           = "true"
    FIREBASE_APP_CHECK_APP_IDS            = join(",", sort(tolist(var.firebase_app_check_app_ids)))
    FRONTEND_URL                          = var.primary_frontend_origin
    ADDITIONAL_TRUSTED_ORIGINS            = local.additional_trusted_origins
    DB_HOST                               = "127.0.0.1"
    DB_PORT                               = "5432"
    DB_NAME                               = google_sql_database.simsa.name
    DB_USER                               = google_sql_user.api.name
    DB_PASSWORD                           = ""
    DB_SSL                                = "false"
    DB_POOL_MAX                           = tostring(var.db_pool_max)
    DB_APPLICATION_NAME                   = local.api_service_name
    GCS_UPLOAD_BUCKET                     = google_storage_bucket.upload.name
    GCS_BUCKET                            = google_storage_bucket.final.name
    FINAL_RETENTION_SECONDS               = tostring(var.final_retention_seconds)
    FINAL_ORPHAN_RETENTION_MARGIN_SECONDS = "3600"
    # The API never connects to clamd in this mode; it makes /ready depend on
    # the durable heartbeat written by the dedicated Compute Engine worker.
    MALWARE_SCANNER_MODE        = "clamav"
    MALWARE_SCAN_WORKER_ENABLED = "true"
    MALWARE_SCAN_WORKER_RUNTIME = "external"
    SRIKANDI_ENABLED            = "false"
  }

  event_environment = {
    NODE_ENV                = "production"
    APP_PROFILE             = "internal"
    SIMSA_CLOUD_PLATFORM    = "gcp"
    OBJECT_STORAGE_PROVIDER = "gcs"
    GOOGLE_CLOUD_PROJECT    = var.project_id
    DB_HOST                 = "127.0.0.1"
    DB_PORT                 = "5432"
    DB_NAME                 = google_sql_database.simsa.name
    DB_USER                 = google_sql_user.events.name
    DB_PASSWORD             = ""
    DB_SSL                  = "false"
    DB_POOL_MAX             = tostring(var.db_pool_max)
    DB_APPLICATION_NAME     = local.event_service_name
    GCS_UPLOAD_BUCKET       = google_storage_bucket.upload.name
    GCS_BUCKET              = google_storage_bucket.final.name
    EVENTARC_HANDLER_PATH   = "/internal/events/storage-finalized"
    MALWARE_SCANNER_MODE    = "disabled"
    SRIKANDI_ENABLED        = "false"
  }

  final_cleanup_environment = {
    NODE_ENV                              = "production"
    SIMSA_CLOUD_PLATFORM                  = "gcp"
    OBJECT_STORAGE_PROVIDER               = "gcs"
    GOOGLE_CLOUD_PROJECT                  = var.project_id
    DB_HOST                               = "127.0.0.1"
    DB_PORT                               = "5432"
    DB_NAME                               = google_sql_database.simsa.name
    DB_USER                               = google_sql_user.final_cleanup.name
    DB_PASSWORD                           = ""
    DB_SSL                                = "false"
    DB_POOL_MAX                           = "2"
    DB_APPLICATION_NAME                   = local.final_cleanup_job_name
    GCS_UPLOAD_BUCKET                     = google_storage_bucket.upload.name
    GCS_BUCKET                            = google_storage_bucket.final.name
    FINAL_ORPHAN_BATCH_SIZE               = "100"
    FINAL_ORPHAN_STALE_AFTER_MS           = "900000"
    FINAL_ORPHAN_MAX_ATTEMPTS             = "10"
    FINAL_ORPHAN_RETRY_BASE_MS            = "60000"
    FINAL_ORPHAN_RETRY_MAX_MS             = "21600000"
    FINAL_RETENTION_SECONDS               = tostring(var.final_retention_seconds)
    FINAL_ORPHAN_RETENTION_MARGIN_SECONDS = "3600"
    CLOUD_SQL_PROXY_SHUTDOWN_URL          = "http://127.0.0.1:9091/quitquitquit"
  }
}

resource "google_cloud_run_v2_service" "api" {
  project             = var.project_id
  name                = local.api_service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = local.protected_environment

  template {
    service_account                  = google_service_account.api.email
    timeout                          = "60s"
    max_instance_request_concurrency = 20
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"

    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"

      network_interfaces {
        network    = google_compute_network.private.name
        subnetwork = google_compute_subnetwork.run.name
        tags       = ["simsa-api"]
      }
    }

    containers {
      name       = "api"
      image      = var.api_image
      depends_on = ["cloud-sql-proxy"]

      ports {
        name           = "http1"
        container_port = 8080
      }

      dynamic "env" {
        for_each = local.api_environment

        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name = "FIREBASE_SESSION_CSRF_SECRET"

        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.firebase_session_csrf.secret_id
            version = var.firebase_session_csrf_secret_version
          }
        }
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }

        cpu_idle          = true
        startup_cpu_boost = true
      }

      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 2
        period_seconds        = 2
        failure_threshold     = 30

        http_get {
          path = "/health"
          port = 8080
        }
      }

      liveness_probe {
        initial_delay_seconds = 10
        timeout_seconds       = 2
        period_seconds        = 30
        failure_threshold     = 3

        http_get {
          path = "/health"
          port = 8080
        }
      }

      readiness_probe {
        timeout_seconds   = 3
        period_seconds    = 10
        failure_threshold = 3

        http_get {
          path = "/ready"
          port = 8080
        }
      }
    }

    containers {
      name  = "cloud-sql-proxy"
      image = var.cloud_sql_proxy_image
      args = [
        "--structured-logs",
        "--private-ip",
        "--auto-iam-authn",
        "--address=127.0.0.1",
        "--port=5432",
        google_sql_database_instance.postgres.connection_name,
      ]

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }

        cpu_idle          = true
        startup_cpu_boost = true
      }

      startup_probe {
        timeout_seconds   = 1
        period_seconds    = 2
        failure_threshold = 30

        tcp_socket {
          port = 5432
        }
      }
    }
  }

  labels = local.labels

  depends_on = [
    google_project_service.required["run.googleapis.com"],
    google_project_iam_member.cloud_sql_client,
    google_project_iam_member.cloud_sql_instance_user,
    google_project_iam_member.api_firebase_session_runtime,
    google_secret_manager_secret_iam_member.api_session_csrf_accessor,
    google_storage_bucket_iam_member.upload_api_runtime,
    google_storage_bucket_iam_member.final_api_runtime,
  ]
}

resource "google_cloud_run_v2_service" "events" {
  project             = var.project_id
  name                = local.event_service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = local.protected_environment

  template {
    service_account                  = google_service_account.events.email
    timeout                          = "300s"
    max_instance_request_concurrency = 5
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"

    scaling {
      min_instance_count = 0
      max_instance_count = var.event_max_instances
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"

      network_interfaces {
        network    = google_compute_network.private.name
        subnetwork = google_compute_subnetwork.run.name
        tags       = ["simsa-events"]
      }
    }

    containers {
      name       = "events"
      image      = var.event_image
      depends_on = ["cloud-sql-proxy"]
      command    = ["node"]
      args       = ["dist/events/storage-finalized.js"]

      ports {
        name           = "http1"
        container_port = 8080
      }

      dynamic "env" {
        for_each = local.event_environment

        content {
          name  = env.key
          value = env.value
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }

        cpu_idle          = true
        startup_cpu_boost = true
      }

      startup_probe {
        timeout_seconds   = 2
        period_seconds    = 2
        failure_threshold = 30

        http_get {
          path = "/health"
          port = 8080
        }
      }

      liveness_probe {
        initial_delay_seconds = 10
        timeout_seconds       = 2
        period_seconds        = 30
        failure_threshold     = 3

        http_get {
          path = "/health"
          port = 8080
        }
      }

      readiness_probe {
        timeout_seconds   = 3
        period_seconds    = 10
        failure_threshold = 3

        http_get {
          path = "/ready"
          port = 8080
        }
      }
    }

    containers {
      name  = "cloud-sql-proxy"
      image = var.cloud_sql_proxy_image
      args = [
        "--structured-logs",
        "--private-ip",
        "--auto-iam-authn",
        "--address=127.0.0.1",
        "--port=5432",
        google_sql_database_instance.postgres.connection_name,
      ]

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }

        cpu_idle          = true
        startup_cpu_boost = true
      }

      startup_probe {
        timeout_seconds   = 1
        period_seconds    = 2
        failure_threshold = 30

        tcp_socket {
          port = 5432
        }
      }
    }
  }

  labels = local.labels

  depends_on = [
    google_project_service.required["run.googleapis.com"],
    google_project_iam_member.cloud_sql_client,
    google_project_iam_member.cloud_sql_instance_user,
    google_storage_bucket_iam_member.upload_event_cleanup,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "api_public_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "eventarc_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.events.location
  name     = google_cloud_run_v2_service.events.name
  role     = "roles/run.invoker"
  member   = google_service_account.eventarc_invoker.member
}

resource "google_project_iam_member" "eventarc_event_receiver" {
  project = var.project_id
  role    = "roles/eventarc.eventReceiver"
  member  = google_service_account.eventarc_invoker.member
}

resource "google_cloud_run_v2_job" "final_cleanup" {
  project             = var.project_id
  name                = local.final_cleanup_job_name
  location            = var.region
  deletion_protection = local.protected_environment

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.final_cleanup.email
      timeout         = "900s"
      max_retries     = 0

      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"

        network_interfaces {
          network    = google_compute_network.private.name
          subnetwork = google_compute_subnetwork.run.name
          tags       = ["simsa-final-cleanup"]
        }
      }

      containers {
        name       = "final-cleanup"
        image      = var.worker_image
        depends_on = ["cloud-sql-proxy"]
        command    = ["node"]
        args       = ["dist/workers/final-object-orphan-reconciliation.js"]

        dynamic "env" {
          for_each = local.final_cleanup_environment

          content {
            name  = env.key
            value = env.value
          }
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }
      }

      containers {
        name  = "cloud-sql-proxy"
        image = var.cloud_sql_proxy_image
        args = [
          "--structured-logs",
          "--private-ip",
          "--auto-iam-authn",
          "--address=127.0.0.1",
          "--port=5432",
          "--health-check",
          "--quitquitquit",
          "--admin-port=9091",
          "--exit-zero-on-sigterm",
          google_sql_database_instance.postgres.connection_name,
        ]

        resources {
          limits = {
            cpu    = "1"
            memory = "256Mi"
          }
        }

        startup_probe {
          timeout_seconds   = 1
          period_seconds    = 2
          failure_threshold = 30

          tcp_socket {
            port = 5432
          }
        }
      }
    }
  }

  labels = local.labels

  depends_on = [
    google_project_service.required["run.googleapis.com"],
    google_project_iam_member.cloud_sql_client,
    google_project_iam_member.cloud_sql_instance_user,
    google_storage_bucket_iam_member.final_cleanup_runtime,
  ]
}

resource "google_cloud_run_v2_job_iam_member" "cleanup_scheduler_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_job.final_cleanup.location
  name     = google_cloud_run_v2_job.final_cleanup.name
  role     = "roles/run.invoker"
  member   = google_service_account.cleanup_scheduler.member
}

resource "google_cloud_scheduler_job" "final_cleanup" {
  project          = var.project_id
  region           = var.region
  name             = "simsa-final-orphan-cleanup"
  description      = "Runs exact-generation cleanup from the durable final-object orphan queue."
  schedule         = "17 * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "320s"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "30s"
    max_backoff_duration = "300s"
    max_doublings        = 3
  }

  http_target {
    http_method = "POST"
    uri = join("", [
      "https://run.googleapis.com/v2/projects/",
      var.project_id,
      "/locations/",
      var.region,
      "/jobs/",
      google_cloud_run_v2_job.final_cleanup.name,
      ":run",
    ])

    oauth_token {
      service_account_email = google_service_account.cleanup_scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [
    google_cloud_run_v2_job_iam_member.cleanup_scheduler_invoker,
    google_project_service.required["cloudscheduler.googleapis.com"],
  ]
}
