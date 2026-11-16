---
title: Privasi SIMSA Backup (Google Drive)
---

# Kebijakan Privasi SIMSA Backup

**SIMSA Backup** adalah aplikasi OAuth internal milik pengelola SIMSA. Satu-satunya fungsinya adalah menyalin backup harian SIMSA yang sudah terenkripsi ke folder Google Drive milik administrator yang memberi izin. Aplikasi ini tidak dipakai oleh pengguna umum dan tidak punya antarmuka sendiri.

## Data Google yang diakses

- Izin yang diminta hanya `https://www.googleapis.com/auth/drive.file`. Dengan izin ini, SIMSA Backup hanya bisa melihat dan mengubah file serta folder yang ia buat sendiri, yaitu folder **SIMSA Backup** dan file `simsa-backup-….tar` di dalamnya.
- SIMSA Backup tidak membaca, menyalin, atau mengubah file lain di Google Drive, dan tidak meminta data profil, email, kontak, atau kalender.

## Cara data dipakai

- File yang diunggah adalah backup database dan dokumen SIMSA yang sudah dienkripsi AES-256-GCM sebelum meninggalkan sistem SIMSA. Google maupun pihak lain tidak dapat membaca isinya tanpa kunci yang disimpan terpisah oleh pengelola SIMSA.
- SIMSA Backup hanya membuat folder, mengunggah salinan baru, mencocokkan checksum, dan memindahkan salinan lama ke Sampah Drive sesuai masa simpan (30 hari terakhir ditambah satu salinan per bulan selama 12 bulan). Tidak ada penghapusan permanen.
- Data tidak dijual, tidak dibagikan ke pihak ketiga, dan tidak dipakai untuk iklan atau melatih model AI.

## Penyimpanan izin

Token izin disimpan sebagai secret terenkripsi pada sistem otomasi backup SIMSA dan hanya dipakai oleh proses backup harian. Token tidak ditampilkan di log atau disimpan di komputer pengguna.

## Mencabut izin

Pemilik akun dapat mencabut akses kapan saja melalui [myaccount.google.com/permissions](https://myaccount.google.com/permissions) dengan menghapus akses **SIMSA Backup**. Setelah dicabut, salinan berikutnya berhenti; file yang sudah ada tetap di Drive pemilik akun sampai ia menghapusnya sendiri.

## Kepatuhan

Penggunaan dan pemindahan informasi yang diterima dari Google API oleh SIMSA Backup mematuhi [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), termasuk ketentuan Limited Use.

## Kontak

Pertanyaan tentang kebijakan ini disampaikan kepada Super Admin SIMSA melalui saluran internal Ditjen PTPP.
