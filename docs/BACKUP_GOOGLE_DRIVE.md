# Salinan backup offsite ke Google Drive

Backup harian SIMSA (`operations-recovery.yml`, pukul 22:30 WIB) menyimpan database dan dokumen terenkripsi sebagai artefak GitHub selama 14 hari. Langkah tambahan di workflow yang sama menyalin hasil itu ke satu folder Google Drive, sehingga ada salinan di luar GitHub, Vercel, dan Neon.

## Cara kerja

- Salinan hanya dibuat bila backup **dan** uji pemulihannya pada run itu berhasil.
- Folder delivery dikemas menjadi satu file `simsa-backup-<waktu snapshot>-<id run>.tar`, lalu diunggah ke folder **SIMSA Backup** di My Drive pemilik izin. Setelah unggah, MD5 di Drive dicocokkan dengan file asli; bila berbeda, salinan itu dipindah ke Sampah dan run gagal.
- Isinya sama dengan artefak GitHub: database dan dokumen terenkripsi AES-256-GCM, dengan kunci yang dibungkus `BACKUP_ENCRYPTION_PASSPHRASE`. Google tidak bisa membaca isinya, dan file itu juga tidak berguna tanpa passphrase tersebut. Simpan passphrase terpisah dari Drive.
- Izin yang diminta hanya `drive.file`: workflow hanya bisa melihat dan mengubah file serta folder yang ia buat sendiri, bukan isi Drive lainnya.
- Masa simpan: semua salinan 30 hari terakhir, ditambah salinan terbaru setiap bulan untuk 12 bulan kalender terakhir (WIB). Salinan yang lebih tua dipindah ke Sampah Drive, yang dikosongkan Google setelah 30 hari. Tidak ada penghapusan permanen oleh workflow.
- Bila salinan gagal (izin dicabut, Drive penuh, gangguan jaringan berulang), job backup gagal dan job **Report failure** membuka atau memperbarui issue "Pemeriksaan operasional gagal", sehingga pengamat repo mendapat email. Status backup di Monitoring Operasional tetap mengikuti backup utama.

Ukuran: database puluhan MB ditambah dokumen (batas bawaan 4 GiB). Dengan masa simpan di atas, folder itu berisi paling banyak sekitar 42 salinan (30 harian ditambah 12 bulanan). Salinan yang sudah dipindah ke Sampah tetap memakai kuota sampai Google mengosongkannya 30 hari kemudian, jadi sediakan ruang untuk sekitar 70 salinan; hitung kebutuhan ruang dari ukuran file `.tar` pertama. Kuota gratis Google 15 GB dipakai bersama Gmail dan Google Foto.

## Penyiapan (sekali)

Lakukan dengan akun Google yang akan memegang backup. Akun itu wajib memakai verifikasi 2 langkah.

### 1. Buat aplikasi OAuth di Google Cloud Console

1. Buka [console.cloud.google.com](https://console.cloud.google.com/), masuk dengan akun tersebut, lalu buat proyek baru, misalnya `SIMSA Backup`.
2. **APIs & Services → Library**, cari **Google Drive API**, lalu klik **Enable**.
3. **Google Auth Platform** (dulu *OAuth consent screen*):
   - **Branding**: nama aplikasi `SIMSA Backup`, email dukungan, dan email kontak pengembang.
   - **Audience**: jenis pengguna **External**. Klik **Publish app** sampai status menjadi **In production**. Ini wajib: pada status *Testing*, Google menghentikan token setelah 7 hari dan backup offsite akan gagal. Karena hanya memakai izin `drive.file` yang tergolong non-sensitif, aplikasi tidak perlu diverifikasi Google.
   - **Data Access** (opsional): tambahkan scope `.../auth/drive.file`.
4. **Clients → Create client**, jenis aplikasi **Desktop app**, nama bebas (mis. `workflow backup`). Salin **Client ID** dan **Client secret**; biarkan jendela itu terbuka sampai langkah 2 selesai.

### 2. Beri izin dan simpan ke GitHub

Dari folder checkout repo di laptop, dengan [GitHub CLI](https://cli.github.com/) sudah masuk (`gh auth status`) memakai akun yang boleh mengatur secret repo:

```powershell
node scripts/ops/google-drive-otorisasi.mjs
```

1. Tempel Client ID, tekan Enter. Tempel Client secret (tidak tampil di layar), tekan Enter.
2. Browser membuka halaman Google. Masuk dengan akun pemegang backup dan setujui akses Google Drive. Bila muncul peringatan aplikasi belum diverifikasi, pastikan nama aplikasinya `SIMSA Backup` buatan Anda sendiri, lalu pilih **Advanced → Go to SIMSA Backup**.
3. Terminal menampilkan bahwa folder **SIMSA Backup** dibuat dan tiga secret `GDRIVE_BACKUP_CLIENT_ID`, `GDRIVE_BACKUP_CLIENT_SECRET`, `GDRIVE_BACKUP_REFRESH_TOKEN` tersimpan di environment `production-recovery`. Token tidak pernah ditampilkan atau disimpan ke disk.

### 3. Aktifkan dan uji

```powershell
gh variable set OPERATIONS_OFFSITE_DRIVE_ENABLED --body true
gh workflow run operations-recovery.yml --ref main
```

Setelah run hijau, folder **SIMSA Backup** di Drive berisi satu file `simsa-backup-….tar`. Log langkah *Copy the encrypted delivery to Google Drive* hanya mencantumkan ukuran, `md5Verified`, dan jumlah salinan yang disimpan atau dipindah ke Sampah.

### 4. Bagikan ke admin cadangan

Di Drive, bagikan folder **SIMSA Backup** sebagai **Viewer** ke akun Super Admin kedua. Dengan begitu backup tetap bisa diambil bila pemilik akun berhalangan.

## Bila salinan gagal

Anotasi error "SIMSA backup offsite gagal" di run menjelaskan penyebabnya:

| Kode | Arti dan tindakan |
|---|---|
| `OFFSITE_DRIVE_CONFIGURATION_MISSING` | Secret belum ada di environment `production-recovery`. Jalankan langkah 2. |
| `OFFSITE_DRIVE_GRANT_REJECTED` | Izin dicabut, kata sandi akun diganti, atau aplikasi masih *Testing*. Pastikan status *In production*, lalu jalankan ulang langkah 2. |
| `OFFSITE_DRIVE_SCOPE_MISSING` | Akses Drive tidak dicentang saat memberi izin. Jalankan ulang langkah 2. |
| `OFFSITE_DRIVE_QUOTA_EXCEEDED` | Drive penuh. Kosongkan ruang atau Sampah, lalu jalankan ulang workflow. |
| `OFFSITE_DRIVE_CHECKSUM_MISMATCH` | File di Drive berbeda dari backup dan sudah dipindah ke Sampah. Jalankan ulang workflow. |
| Kode lain | Gangguan jaringan atau API Google. Jalankan ulang workflow; bila berulang, lihat status Google Workspace. |

Untuk menghentikan salinan sementara: `gh variable set OPERATIONS_OFFSITE_DRIVE_ENABLED --body false`. Backup utama tetap berjalan.

## Memulihkan dari Google Drive

1. Unduh file `simsa-backup-….tar` yang diinginkan dari folder **SIMSA Backup**.
2. Ekstrak (Windows 10 ke atas sudah punya `tar`):
   ```powershell
   tar -xf "$HOME\Downloads\simsa-backup-<waktu>-<id>.tar" -C "$HOME\Downloads\simsa-backup-<waktu>"
   ```
   Hasilnya folder `simsa-recovery-delivery` dengan isi yang sama seperti artefak GitHub.
3. Ikuti langkah `operations-recovery-extract.mjs` di [Cadangan dan pemulihan](OPERATIONS_RECOVERY.md) dengan `--bundle "$HOME\Downloads\simsa-backup-<waktu>\simsa-recovery-delivery"`, atau `restore-delivery` untuk uji pulih penuh di Linux.

## Mengganti atau mencabut akun

- Mencabut: di akun Google pemegang backup, buka [myaccount.google.com/permissions](https://myaccount.google.com/permissions) dan hapus akses **SIMSA Backup**. Run berikutnya gagal dengan `OFFSITE_DRIVE_GRANT_REJECTED` sampai izin baru disimpan atau variabel dimatikan.
- Pindah ke akun lain (mis. akun kantor atau Shared Drive kelak): ulangi penyiapan dengan akun baru. Workflow tidak perlu diubah. Salinan lama tetap ada di Drive akun sebelumnya.
