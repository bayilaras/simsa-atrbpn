project_id                           = "simsa-staging-000"
environment                          = "staging"
region                               = "asia-southeast2"
backend_deploy_service_account_email = "simsa-backend-deploy@simsa-staging-000.iam.gserviceaccount.com"

api_image             = "asia-southeast2-docker.pkg.dev/simsa-staging-000/simsa/backend@sha256:0000000000000000000000000000000000000000000000000000000000000000"
event_image           = "asia-southeast2-docker.pkg.dev/simsa-staging-000/simsa/backend@sha256:0000000000000000000000000000000000000000000000000000000000000000"
cloud_sql_proxy_image = "gcr.io/cloud-sql-connectors/cloud-sql-proxy@sha256:0000000000000000000000000000000000000000000000000000000000000000"
worker_image          = "asia-southeast2-docker.pkg.dev/simsa-staging-000/simsa/backend-worker@sha256:0000000000000000000000000000000000000000000000000000000000000000"
worker_boot_image     = "projects/simsa-image-factory/global/images/simsa-worker-debian12-20260830"
worker_zone           = "asia-southeast2-a"
worker_machine_type   = "e2-standard-2"

frontend_origins = [
  "https://simsa-staging-000.firebaseapp.com",
  "https://simsa-staging-000.web.app",
]
primary_frontend_origin    = "https://simsa-staging-000.web.app"
firebase_app_check_app_ids = ["1:123456789012:web:0000000000000000"]

database_tier         = "db-custom-2-7680"
database_disk_size_gb = 50
database_backup_count = 30
api_min_instances     = 0
api_max_instances     = 10
event_max_instances   = 5
db_pool_max           = 5

upload_expiry_days      = 7
final_retention_seconds = 604800

firebase_session_csrf_secret_version = "1"
worker_environment_secret_version    = "1"
worker_operator_members              = []

labels = {
  cost_center = "simsa-staging"
  owner       = "simsa-platform"
}
