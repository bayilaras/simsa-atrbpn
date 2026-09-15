# Akses Google dan perbaikan QA — 14 September 2026

> Catatan historis: dokumen ini merekam rekomendasi sebelum persetujuan onboarding Google pending. Kandidat rilis berikutnya menerapkan alur tersebut dengan flag default mati; kebijakan dan bukti terbaru ada pada [Onboarding Google pending](GOOGLE_PENDING_ONBOARDING_2026-09-14.md). Deskripsi signup tertutup di bawah tetap berlaku ketika flag tersebut mati.

Rekomendasi: pertahankan **akun yang disiapkan administrator sebelum login pertama**. Keberhasilan login Google hanya membuktikan identitas. Akses surat, arsip, pencarian, dashboard, unduhan, ekspor, dan perubahan data tetap memerlukan akun SIMSA aktif dengan peran serta mandat unit yang sah.

Dokumen ini membedakan kebijakan yang sudah ada, satu perbaikan implementasi yang sudah diuji secara lokal, dan usulan onboarding yang belum diimplementasikan. Kandidat perbaikan berada pada salinan kerja terpisah; hasil ini belum menjadi bukti deployment baru.

## Aturan yang sudah ada

| Keadaan akun | Perilaku source sekarang |
| --- | --- |
| Email Google belum didaftarkan administrator | Better Auth menolak pendaftaran provider, termasuk permintaan signup eksplisit. Tidak otomatis menjadi Admin Unit, Staff, atau pengguna arsip. |
| Akun sudah disiapkan, email Google sama dan terverifikasi | Provider dapat menautkan identitas yang sama. Akses aplikasi mengikuti peran, unit, dan status aktif akun SIMSA. |
| Akun internal ber-role `user`, role tidak dikenal, atau mandat unit belum lengkap | Backend menolak akses arsip; frontend menampilkan halaman akses belum diaktifkan. |
| Akun nonaktif dengan sesi lama | Backend sudah menolak setiap permintaan bisnis. Perbaikan di bawah menyelaraskan tampilan frontend ketika status sesi diperiksa ulang. |
| Provider Firebase digunakan | Identitas Firebase tetap harus dipetakan ke akun SIMSA yang aktif, email terverifikasi, dan lengkap penugasannya sebelum memperoleh sesi aplikasi. |

Dasar source:

- [Konfigurasi Better Auth](../backend/src/config/auth.ts), baris 81–143: signup kredensial produksi ditutup; Google `disableImplicitSignUp` dan `disableSignUp` bernilai `true`; role default `user`; input role/unit/aktivasi dari klien tidak diterima.
- [Pemeriksaan identitas aplikasi](../backend/src/services/identity-user.service.ts), baris 17–31, dan [middleware autentikasi](../backend/src/middlewares/auth.middleware.ts), baris 50–80: role arsip harus dikenal, akun aktif, dan unit wajib tersedia untuk akun berscope unit.
- [Sesi Firebase](../backend/src/routes/firebase-auth.routes.ts), baris 59–62 dan 96–119: identitas yang belum lengkap tidak menerima sesi aplikasi.
- [Pembatasan frontend](../frontend/src/components/ProvisionedAccessGate.jsx) dan [aturan provisioning](../frontend/src/lib/provisioning-access.js): komponen halaman data tidak dimuat untuk akun yang belum berhak.
- [Ekspor](../backend/src/routes/export.routes.ts), baris 17–18, memakai pemeriksaan autentikasi dan izin ekspor; [profil](../backend/src/routes/settings.routes.ts), baris 59–100, juga berada di belakang middleware akses aplikasi saat ini.

Dokumentasi [role dan hak akses](tutorial-dasar/role-hak-akses.md) menetapkan Super Admin sebagai pengelola akun. UI penetapan baru saat ini hanya menawarkan Super Admin dan Admin Unit Kerja; role Staff/Auditor lama dipertahankan untuk kompatibilitas. Karena Admin Unit mempunyai kewenangan operasional menulis, role ini tidak tepat diberikan otomatis kepada setiap email Google.

## Perbaikan yang sudah diimplementasikan

**QA-AUTH-001 — akun nonaktif masih dapat memuat shell aplikasi setelah pemeriksaan sesi Better Auth.**

Sebelumnya, adapter Better Auth membuang `isActive` dari hasil user karena field tersebut belum terdaftar dalam schema autentikasi. Di frontend, keputusan akses hanya memeriksa role dan unit. Akun `super_admin`, `admin_unit`, atau Staff yang dinonaktifkan dapat tetap melewati gate UI dan memuat komponen halaman, walaupun API bisnis menolaknya dengan HTTP 403.

Perbaikan:

1. Field `isActive` dimasukkan ke output user Better Auth dengan `input: false`. Status berasal dari database; pengguna tidak dapat mengaktifkan akunnya sendiri melalui endpoint pembaruan profil autentikasi. Tidak diperlukan kolom atau migrasi baru karena `users.is_active` sudah ada.
2. `hasProvisionedAccess` menolak `isActive=false`.
3. Gate menampilkan **Akun dinonaktifkan**, tidak memasang komponen halaman data, dan tetap menyediakan Keluar serta Periksa ulang akses. Pesan akun nonaktif dibedakan dari akun yang belum diberi peran/unit.

Ini perbaikan konsistensi keamanan UI dan sesi, **bukan temuan bahwa API sebelumnya membocorkan arsip**. Middleware backend sudah menolak akun nonaktif. Pemeriksaan ulang/reload membaca status terbaru; perubahan ini tidak menambahkan push notifikasi pencabutan akses ke tab yang sudah terbuka. Pembatasan server tetap menjadi penegak akses pada setiap permintaan.

Pendaftaran Google tetap tertutup, field role/unit tetap tidak dapat ditetapkan oleh klien, dan matriks izin tidak diubah. Tidak ada login menggunakan akun Google nyata, pembuatan akun live, migrasi database, atau perubahan data deployment pada pengujian ini.

## Bukti pengujian lokal

Regression sebelum perbaikan menghasilkan 3 kegagalan frontend untuk sesi nonaktif Super Admin, Admin Unit, dan Staff, serta 1 kegagalan backend yang menunjukkan `isActive=false` hilang melalui adapter database nyata Better Auth. Test memakai data sintetis dan adapter dengan respons database terkontrol.

Sesudah perbaikan: **62 test lulus** dalam 6 file — frontend 28/28, backend 34/34. Cakupan meliputi anak komponen tidak terpasang, pesan/aksi gate, akun normal dan belum lengkap, role/unit, logout, penolakan role tak dikenal/unit kosong oleh backend, larangan signup Google, serta penolakan input role/unit/aktivasi dari pengguna.

| Bukti | Lokasi |
| --- | --- |
| Regression frontend gagal sebelum fix | [auth-frontend-red.log](../../simsa-remediation-evidence-20260914/auth-frontend-red.log) |
| Regression adapter backend gagal sebelum fix | [auth-backend-red.log](../../simsa-remediation-evidence-20260914/auth-backend-red.log) |
| Hasil frontend sesudah fix | [auth-frontend-green.json](../../simsa-remediation-evidence-20260914/auth-frontend-green.json) |
| Hasil backend sesudah fix | [auth-backend-green.json](../../simsa-remediation-evidence-20260914/auth-backend-green.json) |

`auth-backend-parser-probe.log` merupakan percobaan awal desain test yang hanya menyentuh serializer, belum mencakup transformasi adapter. Log itu disimpan sebagai catatan investigasi, bukan kegagalan aplikasi tambahan atau bagian dari hitungan regression final.

## Usulan onboarding jika nanti disetujui

Jika organisasi ingin menerima permohonan dari email Google yang belum disiapkan, buat keputusan produk tersendiri untuk onboarding. Akses awal yang disarankan hanya identitas/profil sendiri yang terbatas, bantuan, status permohonan, pengajuan keanggotaan unit, dan logout. Pengguna boleh mengusulkan unit pada permohonan, tetapi tidak boleh menulis unit atau role otoritatifnya sendiri.

Dashboard operasional, daftar dan detail surat/arsip, pencarian, preview/unduhan, ekspor, upload, pemberian grant, dan seluruh mutasi tetap ditolak sampai administrator menyetujui penugasan. Persetujuan perlu mencatat reviewer, waktu, alasan, role dan unit; permintaan berulang harus tidak menghasilkan keanggotaan ganda. Email berdomain instansi dapat menjadi syarat masuk permohonan, tetapi bukan alasan pemberian hak arsip otomatis.

Alur ini **belum dibuat atau diaktifkan**. Ia memerlukan endpoint identitas terbatas dan penyimpanan permohonan terpisah; jangan melonggarkan `authMiddleware` seluruh aplikasi hanya agar akun pending bisa membuka profil. Signup provider tetap ditutup sampai alur tersebut mempunyai kebijakan, implementasi, dan test akses negatif yang disetujui.

Laporan UAT deployment sebelumnya tetap menjadi [baseline historis](../../simsa-qa/QA_REPORT.md). Perubahan lokal ini harus menjalani pemeriksaan rilis dan pengujian ulang pada build deployment sebelum dianggap menyelesaikan temuan di website live.
