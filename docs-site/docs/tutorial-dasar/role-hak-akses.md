# 👤 Role & Hak Akses

SIMSA menggunakan sistem **Role-Based Access Control (RBAC)** untuk mengatur siapa bisa mengakses apa.

---

## Daftar Role

| Role | Deskripsi |
|------|-----------|
| **Staff** | Pengguna biasa — hanya bisa **melihat** surat masuk/keluar dan arsip aktif (read-only), serta laporan |
| **Admin Dirjen** | Admin khusus Direktorat Jenderal — bisa mengelola surat, arsip, master data, dan data khusus |
| **Admin Sesditjen** | Admin khusus Sekretariat Dirjen — akses sama seperti Admin Dirjen |
| **Super Admin** | Administrator utama — akses penuh ke seluruh fitur dan semua unit kerja |
| **Auditor** | Pengawas — bisa melihat dashboard dan audit log untuk keperluan audit |

---

## Tabel Hak Akses Lengkap

| Fitur | Staff | Admin Dirjen | Admin Sesditjen | Super Admin | Auditor |
|-------|:-----:|:------------:|:---------------:|:-----------:|:-------:|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Surat Masuk/Keluar | 👁️ Lihat | ✅ | ✅ | ✅ | ❌ |
| Distribusi | ❌ | ✅ | ✅ | ✅ | ❌ |
| Arsip Aktif | 👁️ Lihat | ✅ | ✅ | ✅ | ❌ |
| Dosir | ❌ | ✅ | ✅ | ✅ | ❌ |
| Jadwal Retensi | ❌ | ✅ | ✅ | ✅ | ❌ |
| Manajemen Retensi | ❌ | ✅ | ✅ | ✅ | ❌ |
| Penyusutan | ❌ | ✅ | ✅ | ✅ | ❌ |
| Layanan Arsip | Ajukan/lihat sendiri | Proses unit | Proses unit | ✅ | 👁️ Lihat unit |
| Peminjaman | ❌ | ✅ | ✅ | ✅ | ❌ |
| Lokasi Simpan | ❌ | ✅ | ✅ | ✅ | ❌ |
| Arsip Vital | ❌ | ✅ | ✅ | ✅ | ❌ |
| Arsip Terjaga | ❌ | ✅ | ✅ | ✅ | ❌ |
| Arsip Elektronik | ❌ | ✅ | ✅ | ✅ | ❌ |
| Autentikasi Arsip | ❌ | ❌ | ❌ | ✅ | ❌ |
| Tunjuk Silang | ❌ | ✅ | ✅ | ✅ | ❌ |
| Klasifikasi Arsip | ❌ | ✅ | ✅ | ✅ | ❌ |
| Laporan | ✅ | ✅ | ✅ | ✅ | ❌ |
| Audit Log | ❌ | ✅ | ✅ | ✅ | ✅ |
| User Management | ❌ | ❌ | ❌ | ✅ | ❌ |
| Pengaturan: profil & preferensi | ✅ | ✅ | ✅ | ✅ | ✅ |
| Pengaturan: unit & template nomor | ❌ | ✅ (unit sendiri) | ✅ (unit sendiri) | ✅ | ❌ |
| Tab Pengawasan (Dashboard) | ❌ | ❌ | ❌ | ✅ | ❌ |

> 💡 **Keterangan:**
> - 👁️ **Lihat** = Staff hanya bisa **melihat** data (read-only), **tidak bisa** menambah, mengedit, atau menghapus.
> - Semua akun yang sudah diprovisi dapat mengelola **Profil** dan **Preferensi**. Tab unit kerja serta template nomor hanya tampil untuk admin sesuai cakupan unitnya.

---

## Filter Data Berdasarkan Unit Kerja

Selain akses berdasarkan role, data juga difilter berdasarkan **unit kerja** pengguna:

- **Staff / Admin / Auditor** → Hanya bisa melihat data dari **unit kerja sendiri**
- **Super Admin** → Bisa melihat data dari **semua unit kerja** + memilih filter unit kerja di Dashboard

---

## Notifikasi per Unit Kerja (Super Admin)

Super Admin memiliki fitur tambahan di panel **Notifikasi** — yaitu **dropdown filter unit kerja** yang memungkinkan melihat notifikasi dari unit kerja tertentu:

- Ditjen PTPP
- Sesditjen
- Dir. BPPT
- Dir. PTEP
- Dir. KTPP
- Dir. PLP

---

## Bagaimana Cara Mengubah Role?

Hanya **Super Admin** yang bisa mengubah role pengguna melalui menu **User Management**. Jika kamu merasa perlu akses tambahan, hubungi Super Admin di unit kerja kamu.

---

[⬅️ Sebelumnya: Navigasi Sidebar](navigasi-sidebar.md) | [Selanjutnya: Surat Masuk ➡️](../manajemen-surat/surat-masuk.md)
