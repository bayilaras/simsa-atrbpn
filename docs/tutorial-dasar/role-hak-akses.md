# 👤 Role & Hak Akses

SIMSA menggunakan sistem **Role-Based Access Control (RBAC)** untuk mengatur siapa bisa mengakses apa.

---

## Daftar Role

| Role | Deskripsi |
|------|-----------|
| **Staff** | Pengguna biasa yang menginput dan mengelola surat serta arsip di unit kerjanya |
| **Admin Dirjen** | Admin khusus Direktorat Jenderal — bisa mengelola master data dan data khusus |
| **Admin Sesditjen** | Admin khusus Sekretariat Dirjen — akses sama seperti Admin Dirjen |
| **Super Admin** | Administrator utama — akses penuh ke seluruh fitur dan semua unit kerja |
| **Auditor** | Pengawas — bisa melihat data dan audit log untuk keperluan audit |

---

## Tabel Hak Akses Lengkap

| Fitur | Staff | Admin Dirjen | Admin Sesditjen | Super Admin | Auditor |
|-------|:-----:|:------------:|:---------------:|:-----------:|:-------:|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Surat Masuk | ✅ | ✅ | ✅ | ✅ | ✅ |
| Surat Keluar | ✅ | ✅ | ✅ | ✅ | ✅ |
| Distribusi | ✅ | ✅ | ✅ | ✅ | ✅ |
| Arsip Aktif | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dosir | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manajemen Retensi | ✅ | ✅ | ✅ | ✅ | ✅ |
| Penyusutan | ✅ | ✅ | ✅ | ✅ | ✅ |
| Layanan Arsip | ✅ | ✅ | ✅ | ✅ | ✅ |
| Peminjaman | ✅ | ✅ | ✅ | ✅ | ✅ |
| Arsip Elektronik | ✅ | ✅ | ✅ | ✅ | ✅ |
| Autentikasi | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tunjuk Silang | ✅ | ✅ | ✅ | ✅ | ✅ |
| Laporan | ✅ | ✅ | ✅ | ✅ | ✅ |
| | | | | | |
| Jadwal Retensi *(edit)* | ❌ | ✅ | ✅ | ✅ | ❌ |
| Klasifikasi Arsip *(edit)* | ❌ | ✅ | ✅ | ✅ | ❌ |
| Lokasi Simpan *(edit)* | ❌ | ✅ | ✅ | ✅ | ❌ |
| Arsip Vital | ❌ | ✅ | ✅ | ✅ | ❌ |
| Arsip Terjaga | ❌ | ✅ | ✅ | ✅ | ❌ |
| | | | | | |
| Audit Log | ❌ | ✅ | ✅ | ✅ | ✅ |
| | | | | | |
| User Management | ❌ | ❌ | ❌ | ✅ | ❌ |
| Settings | ❌ | ❌ | ❌ | ✅ | ❌ |
| Tab Pengawasan (Dashboard) | ❌ | ❌ | ❌ | ✅ | ❌ |

---

## Filter Data Berdasarkan Unit Kerja

Selain akses berdasarkan role, data juga difilter berdasarkan **unit kerja** pengguna:

- **Staff / Admin / Auditor** → Hanya bisa melihat data dari **unit kerja sendiri**
- **Super Admin** → Bisa melihat data dari **semua unit kerja** + memilih filter unit kerja di Dashboard

---

## Bagaimana Cara Mengubah Role?

Hanya **Super Admin** yang bisa mengubah role pengguna melalui menu **User Management**. Jika kamu merasa perlu akses tambahan, hubungi Super Admin di unit kerja kamu.

---

[⬅️ Sebelumnya: Navigasi Sidebar](navigasi-sidebar.md) | [Selanjutnya: Surat Masuk ➡️](../manajemen-surat/surat-masuk.md)
