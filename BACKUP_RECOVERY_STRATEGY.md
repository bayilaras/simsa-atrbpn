# Strategi Backup & Recovery — SIMSA Database (Neon PostgreSQL)

## Arsitektur Backup 3 Lapis

| Layer | Metode | Retensi | RPO | Otomatis |
|-------|--------|---------|-----|----------|
| 1 | **Neon PITR** (built-in) | 7–30 hari | Milidetik | ✅ |
| 2 | **pg_dump Harian** (GitHub Actions) | 30 hari | 24 jam | ✅ |
| 3 | **Neon Branching** (manual) | Permanen | Point-in-time | ❌ |

---

## Layer 1: Neon Point-in-Time Recovery (PITR)

Neon secara otomatis menyimpan WAL (Write-Ahead Log) untuk seluruh database.

### Cara Menggunakan PITR

1. Buka [Neon Console](https://console.neon.tech)
2. Pilih project → **Branches**
3. Klik **Restore** pada branch `main`
4. Pilih tanggal dan waktu yang diinginkan
5. Neon akan membuat branch baru dari titik waktu tersebut

### Konfigurasi Retensi

| Plan | Retensi PITR |
|------|-------------|
| Free | 24 jam |
| Launch | 7 hari |
| Scale | 14 hari |
| Business | 30 hari |

> **Rekomendasi:** Gunakan plan **Launch** atau **Scale** untuk retensi PITR lebih lama.

---

## Layer 2: pg_dump Otomatis (GitHub Actions)

Backup harian menggunakan `pg_dump` via GitHub Actions. File backup disimpan sebagai GitHub Artifact (retensi 30 hari).

### Setup

1. **Tambahkan secret** di GitHub repo → Settings → Secrets:
   - `NEON_DATABASE_URL`: Connection string Neon (contoh: `postgresql://user:pass@host/db?sslmode=require`)

2. **Workflow file**: `.github/workflows/backup-neon.yml` (sudah dibuat)

3. **Jadwal**: Setiap hari pukul 00:00 UTC (07:00 WIB)

### Cara Download Backup

1. Buka GitHub repo → **Actions** tab
2. Klik workflow **"Daily Neon DB Backup"**
3. Pilih run yang diinginkan
4. Download artifact `neon-backup-YYYY-MM-DD`

### Cara Restore dari Backup

```bash
# 1. Download file backup dari GitHub Actions artifacts

# 2. Restore ke database baru di Neon
#    Buat branch baru di Neon Console terlebih dahulu
psql "postgresql://user:pass@new-host/db?sslmode=require" < backup-file.sql

# 3. Atau restore ke database lokal untuk testing
createdb simsa_restore
psql simsa_restore < backup-file.sql
```

---

## Layer 3: Neon Branching (Pre-Migration)

Sebelum menjalankan migrasi database, buat branch sebagai snapshot.

### Prosedur Pre-Migration Backup

```bash
# 1. Buat branch sebelum migrasi
# Di Neon Console:
#   Branches → Create Branch → dari branch "main"
#   Nama: "pre-migration-YYYY-MM-DD"

# 2. Jalankan migrasi
cd backend
npm run db:push

# 3. Verifikasi migrasi berhasil
npm run dev
# Test di browser

# 4. Jika migrasi gagal — rollback:
#    Di Neon Console:
#    Branches → main → Restore → pilih branch "pre-migration-YYYY-MM-DD"
```

### Kapan Harus Membuat Branch

- ✅ Sebelum `npm run db:push` atau `npm run db:migrate`
- ✅ Sebelum menjalankan seed yang menghapus data
- ✅ Sebelum perubahan schema besar
- ✅ Sebelum deploy ke production

---

## Prosedur Recovery Darurat

### Skenario 1: Data Terhapus Tidak Sengaja (< 24 jam)

1. Gunakan **Neon PITR** → restore ke titik sebelum penghapusan
2. Bandingkan data di branch baru vs branch main
3. Copy data yang hilang menggunakan SQL

### Skenario 2: Data Corrupt (> 24 jam)

1. Download **pg_dump backup** terdekat dari GitHub Actions
2. Buat branch baru di Neon
3. Restore backup ke branch baru
4. Bandingkan dan sinkronisasi data

### Skenario 3: Database Tidak Bisa Diakses

1. Cek status Neon di [status.neon.tech](https://status.neon.tech)
2. Jika ada outage, tunggu Neon recovery
3. Jika perlu restore, gunakan pg_dump backup terakhir ke database baru

---

## Checklist Maintenance Berkala

| Frekuensi | Tugas |
|-----------|-------|
| Harian | ✅ Verifikasi backup GitHub Actions berhasil |
| Mingguan | ✅ Download dan test restore backup terakhir |
| Bulanan | ✅ Review retensi dan hapus branch lama |
| Sebelum deploy | ✅ Buat Neon branch sebagai snapshot |
