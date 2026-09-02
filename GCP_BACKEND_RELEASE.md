# Rilis Backend GCP Manual dan Bertahap

Workflow `.github/workflows/deploy-gcp-backend.yml` adalah satu-satunya jalur
rilis backend GCP yang disiapkan di repositori ini. Workflow hanya dapat
dipanggil manual (`workflow_dispatch`) dan **belum pernah dijalankan dari
repositori ini**. Ia tidak menyentuh frontend maupun dokumentasi yang sudah
dipublikasikan.

## Jaminan alur rilis

- Input sumber harus berupa SHA commit lengkap 40 karakter. Checkout, build,
  kandidat, event receiver, dan seluruh tahap traffic menggunakan SHA tersebut.
- Image target `runtime` dibangun satu kali, dikirim ke Artifact Registry dengan
  tag unik per run, lalu diubah menjadi referensi immutable `@sha256:...`.
- API diperbarui hanya pada container bernama `api` dengan `gcloud run services
  update --container api`. Sidecar Cloud SQL Auth Proxy, service account,
  secret, VPC, scaling, probe, dan konfigurasi lain yang dikelola Terraform
  tidak ditulis ulang.
- Revision kandidat memakai tag dan `--no-traffic`. `/health` dan `/ready`
  harus sama-sama mengembalikan HTTP 200 dalam 20 percobaan terbatas sebelum
  traffic boleh berubah.
- Traffic API berpindah melalui job dan GitHub Environment terpisah:
  `0% -> 5% -> 25% -> 100%`. Reviewer dapat memeriksa artifact, Cloud Logging,
  latency, error rate, dan metrik bisnis sebelum menyetujui tahap berikutnya.
- Sebelum canary, workflow menjalankan perintah rollback aktual ketika revision
  lama masih menerima 100% traffic. Ini adalah perubahan no-op, tetapi
  membuktikan nama revision, IAM, sintaks, dan target rollback sebelum risiko
  canary dimulai.
- Setiap tahap menyimpan revision/digest lama, revision/digest kandidat,
  alokasi traffic, respons probe, URL, commit, dan perintah rollback sebagai
  artifact 30 hari. Probe gagal setelah traffic berubah akan otomatis
  mengembalikan revision lama ke 100%.
- Sebelum build, candidate, dan setiap perubahan traffic, workflow menolak
  service yang tidak berlabel tepat `application=simsa`,
  `environment=ENV`, dan `managed_by=terraform`. Email deploy service account
  juga wajib berasal dari project lingkungan yang dipilih. Ini mencegah rilis
  Preview salah sasaran ke service Production.
- Preview wajib membawa exact run ID, artifact ID, dan artifact digest dari
  `database-bootstrap-gcp-preview`; Production wajib membawa tiga identifier
  yang sama dari database maintenance. Gate memeriksa metadata GitHub API,
  exact commit/environment, mengunduh exact artifact, dan memverifikasi semua
  hash manifest sebelum build. Staging sengaja tidak tersedia sampai memiliki
  workflow bootstrap/evidence immutable yang setara.
- Evidence mengekspor target tersegel berupa project, region,
  instance/connection/database, pasangan service-account/SQL-login seluruh
  runtime, serta bucket upload/final dan metadata private-nya. Revision aktif
  dan kandidat untuk **API maupun event receiver** wajib cocok pada
  `GOOGLE_CLOUD_PROJECT`, `DB_*`, `GCS_UPLOAD_BUCKET`, `GCS_BUCKET`, runtime
  service account, dan exact argumen Cloud SQL Auth Proxy. Sebelum setiap
  candidate/promosi, deploy juga membaca metadata bucket secara live dan
  memverifikasi project, location, uniform bucket-level access, public access
  prevention, label Terraform/environment, serta purpose; drift menghentikan
  traffic.
- Jika event receiver sudah dipromosikan tetapi salah satu tahap API gagal,
  dibatalkan, atau dilewati, job rollback terkoordinasi mencoba mengembalikan
  **API dan event receiver** ke exact previous revision/digest, memverifikasi
  traffic 100%, lalu menguji `/health` dan `/ready` pada keduanya.
- Input `deploy_event_receiver=false` ditolak pada validasi sebelum mutasi apa
  pun. API dan event receiver selalu dirilis serta di-rollback secara
  terkoordinasi, sehingga kegagalan sesudah traffic berubah—termasuk upload
  evidence tahap yang gagal—tidak meninggalkan satu service pada kandidat
  tanpa evidence final.

Cloud Run mendokumentasikan pola revision tanpa traffic, tagged URL, pembagian
traffic, serta rollback melalui `update-traffic` pada [rollout dan rollback
Cloud Run](https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration).

## Gate khusus Production

Production fail-closed kecuali semua syarat berikut benar:

1. operator mengetik `PROMOTE_PRODUCTION`;
2. SHA adalah HEAD aktual default branch menurut GitHub API;
3. commit mempunyai minimal dua parent dan merupakan `merge_commit_sha` dari PR
   yang sudah merged ke default branch;
4. tepat satu PR cocok dengan merge SHA; state review efektif terbaru per
   reviewer harus memuat approval dari reviewer manusia non-author pada head PR
   terakhir. Bila detail branch protection dapat dibaca, jumlah approval harus
   memenuhi `required_approving_review_count`; bila tidak, minimum fail-closed
   tetap satu approval;
5. default branch berstatus protected dan mengekspos minimal satu required
   status-check context; dan
6. setiap context tersebut mempunyai check-run atau commit status terbaru
   dengan hasil literal `success` pada merge commit itu;
7. workflow database maintenance Production yang dilindungi telah sukses pada
   environment dan exact commit yang sama setelah backup `pre_migration` dan
   independent restore; dan
8. artifact maintenance yang immutable masih tersedia dengan ID/digest yang
   sama. Pada gate awal artifact diunduh, seluruh manifest SHA-256 diverifikasi,
   dan summary harus membuktikan image/source ter-review, journal sampai 0033,
   grant convergence, migrator tanpa database `CREATE`, seed kanonis, serta
   exact project/region/instance/database/API principal yang akan dipakai
   revision Cloud Run.

Minimum fallback review di kode adalah **satu** approval manusia non-author
pada head PR final. Fallback ini dipakai hanya bila `GITHUB_TOKEN` tidak dapat
membaca detail `required_approving_review_count`; ia tidak menganggap komentar,
bot, approval author, atau approval pada head lama sebagai valid. Jika kebijakan
organisasi mewajibkan lebih dari satu approval, endpoint branch-protection
wajib dapat dibaca gate agar count itu diterapkan. Gate belum membuktikan
identitas code owner secara terpisah; policy code-owner harus dibuktikan dari
branch/ruleset evidence dan approval Environment. Sampai bukti tambahan itu
tersedia, perlakukan rilis sebagai NO-GO operasional—jangan menurunkan branch
protection agar workflow lewat.

Pemeriksaan dilakukan oleh
`.github/scripts/check-gcp-backend-production-gate.py` memakai hanya
`GITHUB_TOKEN`. Tidak ada PAT. Endpoint branch protection/ruleset harus
mengekspos required contexts melalui respons branch GitHub; bila tidak, gate
memblokir Production sampai konfigurasi diperbaiki. Jangan menjadikan job
`Validate immutable release request` sendiri sebagai required check karena job
itu masih berjalan ketika gate membaca hasil commit.

Gate ini tidak hanya berjalan pada awal workflow. Setelah kandidat selesai dan
reviewer menyetujui setiap environment promosi, ia dijalankan lagi di dalam job
tepat sebelum event traffic berubah serta sebelum API menerima 5%, 25%, dan
100%. Metadata run/artifact maintenance juga diperiksa ulang pada empat titik
ini. Dengan begitu perubahan HEAD, review efektif, rerun required check,
penghapusan artifact, atau ketidakcocokan digest
selama waktu build/approval akan memblokir tahap berikutnya, bukan memakai
hasil gate lama.

Prosedur backup dan maintenance lengkap ada di
`GCP_DATABASE_MAINTENANCE.md`; bootstrap Preview ada di
`GCP_PREVIEW_DATABASE.md`. Preview dan Production tidak boleh saling memakai
evidence database.

Referensi: [REST API check runs](https://docs.github.com/en/rest/checks/runs),
[protected branches](https://docs.github.com/en/rest/branches/branch-protection),
dan [OIDC Google Cloud dari
GitHub](https://github.com/google-github-actions/auth#workload-identity-federation).

## GitHub Environments yang wajib dibuat lebih dahulu

Untuk setiap nilai `preview` dan `production`, buat tujuh environment
berikut **sebelum** workflow pertama. Jika workflow membuat environment secara
otomatis, environment baru itu tidak mempunyai reviewer dan rilis harus
dibatalkan.

```text
gcp-ENV-backend-candidate
gcp-ENV-backend-event-candidate
gcp-ENV-backend-event-promote
gcp-ENV-backend-canary-5
gcp-ENV-backend-canary-25
gcp-ENV-backend-promote-100
gcp-ENV-backend-coordinated-rollback
```

Aktifkan required reviewers pada enam environment kandidat/promosi. Environment
`gcp-ENV-backend-coordinated-rollback` adalah jalur restoratif: jangan beri wait
timer atau reviewer yang dapat menahan rollback, tetapi tetap batasi deployment
branch ke default branch, batasi administrator, dan masukkan subject-nya ke
policy WIF. Untuk Production, aktifkan
`Prevent self-review`, batasi deployment branch ke default branch, dan gunakan
tim berbeda untuk approval kandidat, canary, dan final. Environment approval
adalah tempat operator memeriksa metrik; workflow sengaja tidak memakai sleep
panjang sebagai pengganti observasi manusia.

Simpan variable berikut pada environment `gcp-ENV-backend-candidate` (atau pada
scope organisasi/repository bila isolasi nilainya tetap terjamin):

```text
GCP_PROJECT_ID
GCP_REGION
GCP_ARTIFACT_REPOSITORY
GCP_BACKEND_IMAGE_NAME
GCP_BACKEND_API_SERVICE
GCP_BACKEND_EVENT_SERVICE
GCP_BACKEND_DEPLOY_WIF_PROVIDER
GCP_BACKEND_DEPLOY_SERVICE_ACCOUNT
```

Tidak ada Google credential secret. `GCP_BACKEND_DEPLOY_WIF_PROVIDER` dan
service-account email adalah identifier, bukan key. Workflow menolak pola
`credentials_json` dan hanya memberi `id-token: write` pada job yang perlu
bertukar token OIDC sementara.

## WIF dan IAM minimum

Gunakan provider/identity pool terpisah per lingkungan atau attribute condition
yang eksplisit. Condition minimal mengikat `assertion.repository` ke repository
ini, `assertion.workflow_ref` ke file workflow ini, dan untuk Production
`assertion.ref` ke default branch. Izinkan subject semua environment tahap di
atas, termasuk coordinated rollback; subject OIDC berubah ketika nama GitHub
Environment berubah.

Service account deployment memerlukan cakupan minimum berikut:

- push/read pada satu repository Artifact Registry backend;
- get/update service dan get/list revision Cloud Run untuk hanya service API dan
  event receiver pada project/region lingkungan itu;
- `iam.serviceAccounts.actAs` hanya terhadap runtime service account kedua
  service (Cloud Run memerlukannya saat membuat revision); dan
- custom role `simsaDbEvidenceMetadata` yang hanya memuat
  `resourcemanager.projects.get` dan `storage.buckets.get`, tanpa izin object,
  agar drift metadata bucket dapat diperiksa live;
- `run.routes.invoke`/Cloud Run Invoker hanya pada private event receiver agar
  private probe dapat memakai identity token.

Jangan beri Owner, Editor, Service Account Key Admin, atau file JSON service
account. Google menjelaskan bahwa WIF menghasilkan credential berumur pendek
dan menghindari key service account jangka panjang pada [dokumentasi Workload
Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation).

## Runner private untuk event receiver

Job event dan rollback dua-service tidak berjalan di runner publik. Sediakan
runner ephemeral atau persisten yang di-hardening di VPC GCP dan beri tepat
label berikut:

```text
self-hosted, linux, x64, simsa-gcp-private
```

Runner harus dapat mencapai internal ingress Cloud Run, memakai runner GitHub
yang mendukung action berbasis Node 24, serta mempunyai `bash`, `curl`, `jq`,
`python3`, dan CA bundle yang mutakhir. Ia tetap berautentikasi melalui WIF; jangan tempel
key pada disk runner. Token Cloud Run dibuat untuk service URL sebagai audience
dan tidak pernah ditulis ke artifact/log.

Jika runner ini belum siap, jangan dispatch atau promosikan rilis backend.
Provision runner terlebih dahulu dan pertahankan input
`deploy_event_receiver=true`; workflow sengaja menolak nilai `false` sebelum
mutasi. API canary tidak dapat dimulai sebelum kandidat event lulus private
probe dan event receiver dipromosikan lewat approval terpisah.

## Cara menjalankan

1. Pastikan PR sudah direview/merged dan required checks dijalankan ulang pada
   merge commit. Salin SHA penuh dari default branch.
2. Untuk Preview, selesaikan workflow bootstrap database pada exact SHA dan
   catat run ID, artifact ID, serta digest. Untuk Production, selesaikan backup `pre_migration`, independent restore,
   dan workflow database maintenance pada exact commit. Catat maintenance run
   ID, artifact ID, serta artifact digest.
3. Buka **Actions -> Deploy GCP Backend (Manual, Staged) -> Run workflow**.
4. Pilih Preview atau Production dan isi SHA penuh. Event receiver wajib ikut
   dengan digest yang sama; input false ditolak fail-closed. Isi ketiga
   identifier bootstrap Preview atau maintenance Production.
   Untuk Production isi pula konfirmasi eksak.
5. Pada approval kandidat, cocokkan project/region/service dengan change ticket
   serta `database_target` dan `storage_target` dari artifact gate.
6. Unduh artifact `...-candidate`; periksa `api-candidate-summary.json`,
   `probes.ndjson`, `previous-revision.json`, `previous-api-database-binding.json`,
   `candidate-api-database-binding.json`, `live-storage-target-gate.json`, dan
   `rollback-command.sh`.
7. Bila event aktif, lakukan pemeriksaan yang sama pada artifact event dari
   runner private.
8. Sebelum menyetujui 5%, 25%, dan 100%, periksa artifact tahap sebelumnya,
   Cloud Logging, request/error rate, p95/p99 latency, koneksi Cloud SQL, queue
   scan malware, dan heartbeat worker.
   Untuk Production, pastikan artifact event/API tahap pertama juga berisi
   `production-pre-*-traffic-gate.json` dengan daftar reviewer approval serta
   semua required result yang masih `success`.
9. Setelah 100%, simpan URL workflow, SHA, digest, revision, seluruh artifact,
   approval, dan change ticket pada evidence store organisasi.

## Rollback

Setiap artifact tahap memuat `rollback-command.sh` yang sudah diuji sebagai
no-op sebelum canary. Bentuknya:

```bash
gcloud run services update-traffic SERVICE \
  --project PROJECT_ID \
  --region REGION \
  --to-revisions PREVIOUS_REVISION=100 \
  --quiet
```

Jalankan dengan identitas break-glass yang diaudit bila workflow gagal,
dibatalkan, atau metrik memburuk setelah selesai. Lalu uji `/health` dan
`/ready`, verifikasi traffic 100%, dan simpan output `services describe` serta
`revisions describe`. Jangan membangun ulang image lama; digest sebelumnya
sudah direkam di artifact.

Automatic rollback lokal mencakup kegagalan perintah/probe pada setiap job
promosi API. Bila event receiver sudah 100% dan rangkaian API tidak selesai,
job `Restore API and event receiver after an incomplete release` menjalankan
rollback idempotent pada kedua service dan mengunggah
`coordinated-rollback-summary.json` beserta bukti per service.
Job `Restore API after an incomplete API-only release` tetap ada sebagai
kompatibilitas defensif, tetapi tidak dapat dicapai oleh dispatch yang valid:
input tanpa event dihentikan sebelum candidate dibuat. Ia bukan jalur rilis
atau exception operasional; rollback rilis saat ini selalu dua-service.

GitHub tidak menjamin job pemulihan baru sempat dimulai bila seluruh workflow
dibatalkan paksa, control plane GitHub terganggu, atau runner private mati.
Karena itu `rollback-command.sh` API dan perintah event tetap wajib disalin ke
change ticket sebelum canary. Jalankan seluruh perintah
yang berlaku dengan identitas break-glass,
verifikasi exact digest/revision dan traffic 100%, lalu uji `/health` serta
`/ready`. Rollback traffic tidak membatalkan migration database; revision lama
wajib tetap backward-compatible dengan migration yang sudah dijalankan.

## Rekonsiliasi IaC

Workflow mengubah hanya image container dan traffic/tag service yang telah
diprovisikan Terraform; ia tidak menjalankan Terraform dan tidak mengubah file
Terraform. Setelah promosi sukses, buat PR terpisah untuk mengganti nilai
`api_image` dan, bila event dipromosikan, `event_image` dengan digest yang sama.
Review plan harus hanya menunjukkan rekonsiliasi image/tag yang diharapkan.
Jangan menjalankan `terraform apply` dengan digest lama karena itu akan
mengembalikan revision tanpa melalui gate rilis ini.

Validasi statis lokal/CI:

```bash
python .github/scripts/validate-gcp-backend-release-workflow.py
python .github/scripts/validate-gcp-database-maintenance-workflow.py
```

Validator memastikan trigger tetap manual, action eksternal dipin ke full SHA,
tidak ada key JSON, image dibangun tepat satu kali, target terikat label
environment Terraform, event probe/rollback tetap pada runner private, tahap
approval/traffic lengkap, rollback dua service tersedia, dan gate Production
lulus self-test.
