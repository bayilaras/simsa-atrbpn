locals {
  worker_image_parts         = split("/", var.worker_image)
  worker_artifact_repository = try(local.worker_image_parts[2], "invalid")
  worker_artifact_registry   = try(local.worker_image_parts[0], "invalid")

  # This value contains identifiers and immutable artifact references only.
  # The dotenv payload remains in Secret Manager and is never placed in VM
  # metadata, Terraform variables, plans, or state.
  worker_bootstrap_config = {
    artifact_registry_host         = local.worker_artifact_registry
    cloud_sql_instance             = google_sql_database_instance.postgres.connection_name
    cloud_sql_proxy_image          = var.cloud_sql_proxy_image
    compose_directory              = "/opt/simsa-workers"
    database_name                  = google_sql_database.simsa.name
    database_user                  = google_sql_user.worker.name
    db_pool_max                    = var.worker_db_pool_max
    final_bucket                   = google_storage_bucket.final.name
    final_retention_seconds        = var.final_retention_seconds
    final_retention_margin_seconds = 3600
    project_id                     = var.project_id
    signature_device               = "/dev/disk/by-id/google-clamav-signatures"
    upload_bucket                  = google_storage_bucket.upload.name
    worker_environment_secret      = google_secret_manager_secret.worker_environment.secret_id
    worker_environment_version     = var.worker_environment_secret_version
    worker_image                   = var.worker_image
  }
}

data "google_artifact_registry_repository" "worker" {
  project       = var.project_id
  location      = var.region
  repository_id = local.worker_artifact_repository

  depends_on = [google_project_service.required["artifactregistry.googleapis.com"]]
}

resource "google_artifact_registry_repository_iam_member" "worker_image_reader" {
  project    = var.project_id
  location   = data.google_artifact_registry_repository.worker.location
  repository = data.google_artifact_registry_repository.worker.repository_id
  role       = "roles/artifactregistry.reader"
  member     = google_service_account.worker.member
}

resource "google_compute_disk" "worker_signatures" {
  project                   = var.project_id
  name                      = "simsa-clamav-signatures"
  zone                      = var.worker_zone
  type                      = "pd-balanced"
  size                      = var.worker_signature_disk_size_gb
  physical_block_size_bytes = 4096
  labels                    = merge(local.labels, { purpose = "clamav-signatures" })

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_instance" "worker" {
  project                   = var.project_id
  name                      = local.worker_instance_name
  zone                      = var.worker_zone
  machine_type              = var.worker_machine_type
  can_ip_forward            = false
  allow_stopping_for_update = true
  deletion_protection       = local.protected_environment
  tags                      = ["simsa-malware-worker"]
  labels                    = merge(local.labels, { workload = "malware-worker" })

  boot_disk {
    auto_delete = true

    initialize_params {
      image  = var.worker_boot_image
      size   = var.worker_boot_disk_size_gb
      type   = "pd-balanced"
      labels = merge(local.labels, { purpose = "worker-boot" })
    }
  }

  # Attach at instance creation so the startup service cannot race a separate
  # google_compute_attached_disk operation. The PD survives VM replacement.
  attached_disk {
    source      = google_compute_disk.worker_signatures.id
    device_name = "clamav-signatures"
    mode        = "READ_WRITE"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.worker.id
    # Deliberately no access_config: there is no public IPv4 address. Cloud NAT
    # supplies outbound-only access for FreshClam and immutable image pulls.
  }

  service_account {
    email  = google_service_account.worker.email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  metadata = {
    block-project-ssh-keys = "TRUE"
    enable-oslogin         = "TRUE"
    enable-oslogin-2fa     = "TRUE"
    serial-port-enable     = "FALSE"
    simsa-worker-config    = jsonencode(local.worker_bootstrap_config)
    startup-script         = <<-EOT
      #!/bin/bash
      set -euo pipefail
      test -x /opt/simsa-workers/bootstrap-gcp.sh
      test -f /opt/simsa-workers/simsa-workers-bootstrap.service
      install -o root -g root -m 0644 /opt/simsa-workers/simsa-workers-bootstrap.service /etc/systemd/system/simsa-workers-bootstrap.service
      systemctl daemon-reload
      systemctl enable --now simsa-workers-bootstrap.service
    EOT
  }

  scheduling {
    automatic_restart   = true
    on_host_maintenance = "MIGRATE"
    preemptible         = false
    provisioning_model  = "STANDARD"
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  lifecycle {
    precondition {
      condition     = local.worker_artifact_repository != "invalid"
      error_message = "worker_image must contain an Artifact Registry repository segment."
    }
  }

  depends_on = [
    google_artifact_registry_repository_iam_member.worker_image_reader,
    google_compute_router_nat.worker,
    google_project_iam_member.cloud_sql_client,
    google_project_iam_member.cloud_sql_instance_user,
    google_secret_manager_secret_iam_member.worker_environment_accessor,
    google_storage_bucket_iam_member.worker_final_runtime,
    google_storage_bucket_iam_member.worker_quarantine_runtime,
  ]
}

resource "google_iap_tunnel_instance_iam_member" "worker_iap_tunnel" {
  for_each = var.worker_operator_members

  project  = var.project_id
  zone     = google_compute_instance.worker.zone
  instance = google_compute_instance.worker.name
  role     = "roles/iap.tunnelResourceAccessor"
  member   = each.value
}

resource "google_compute_instance_iam_member" "worker_os_admin" {
  for_each = var.worker_operator_members

  project       = var.project_id
  zone          = google_compute_instance.worker.zone
  instance_name = google_compute_instance.worker.name
  role          = "roles/compute.osAdminLogin"
  member        = each.value
}

# OS Login deliberately requires operators to be allowed to act as the VM's
# attached identity. Keep this list empty by default and grant it just-in-time:
# an administrator on this host can obtain every permission of the worker SA.
resource "google_service_account_iam_member" "worker_operator_act_as" {
  for_each = var.worker_operator_members

  service_account_id = google_service_account.worker.name
  role               = "roles/iam.serviceAccountUser"
  member             = each.value
}
