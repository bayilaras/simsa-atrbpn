project_id                           = "simsa-preview-000"
environment                          = "preview"
region                               = "asia-southeast2"
backend_deploy_service_account_email = "simsa-backend-deploy@simsa-preview-000.iam.gserviceaccount.com"

# Replace every zero digest with a reviewed artifact digest before planning an apply.
api_image             = "asia-southeast2-docker.pkg.dev/simsa-preview-000/simsa/backend@sha256:0000000000000000000000000000000000000000000000000000000000000000"
event_image           = "asia-southeast2-docker.pkg.dev/simsa-preview-000/simsa/backend@sha256:0000000000000000000000000000000000000000000000000000000000000000"
cloud_sql_proxy_image = "gcr.io/cloud-sql-connectors/cloud-sql-proxy@sha256:0000000000000000000000000000000000000000000000000000000000000000"
worker_image          = "asia-southeast2-docker.pkg.dev/simsa-preview-000/simsa/backend-worker@sha256:0000000000000000000000000000000000000000000000000000000000000000"

# Exact hardened image, never an image family. It must contain the reviewed
# deploy/workers bundle, Docker Engine/Compose, gcloud, curl, Python, and iptables.
worker_boot_image   = "projects/simsa-image-factory/global/images/simsa-worker-debian12-20260830"
worker_zone         = "asia-southeast2-a"
worker_machine_type = "e2-standard-2"

frontend_origins = [
  "https://simsa-preview-000.firebaseapp.com",
  "https://simsa-preview-000.web.app",
]
primary_frontend_origin = "https://simsa-preview-000.web.app"
# Replace the example project number/app suffix with the isolated Preview Web App ID.
firebase_app_check_app_ids = ["1:123456789012:web:0000000000000000"]

database_tier         = "db-custom-1-3840"
database_disk_size_gb = 20
database_backup_count = 14
api_min_instances     = 0
api_max_instances     = 3
event_max_instances   = 2
db_pool_max           = 3

upload_expiry_days      = 3
final_retention_seconds = 604800

# Numeric version is metadata, not the secret payload. Populate the secret out-of-band.
firebase_session_csrf_secret_version = "1"
worker_environment_secret_version    = "1"

# Prefer a JIT group grant instead of a permanent individual. Empty means the
# VM is not interactively reachable even through IAP.
worker_operator_members = []

labels = {
  cost_center = "simsa-preview"
  owner       = "simsa-platform"
}
