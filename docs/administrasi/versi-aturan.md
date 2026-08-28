# Versi Aturan Klasifikasi dan JRA

SIMSA menyimpan klasifikasi arsip dan Jadwal Retensi Arsip (JRA) sebagai **edisi aturan yang berversi**. Versi yang sudah aktif bersifat hanya-baca. Perubahan regulasi tidak dilakukan dengan menimpa data lama, karena arsip yang telah diregistrasi harus tetap dapat menunjukkan aturan yang dipakai pada saat keputusan dibuat.

Sumber awal yang dimuat dalam aplikasi adalah:

- klasifikasi arsip Permen ATR/BPN Nomor 10 Tahun 2018: 842 baris sumber, 620 butir yang dapat dipilih, dengan lingkup Kementerian, Kanwil, dan Kantah; dan
- JRA Permen ATR/BPN Nomor 8 Tahun 2020: 391 aturan retensi yang dapat dipilih, ditambah simpul hierarki untuk navigasi.

Pemetaan tematik klasifikasi ke JRA hanya merupakan **saran pencarian**. Pemetaan tersebut bukan hubungan hukum otomatis; arsiparis tetap memilih butir JRA yang sesuai dengan isi, fungsi, dan pemicu retensi arsip.

## Menerbitkan perubahan aturan

Super Admin menyiapkan, mengajukan, dan mengaktifkan edisi. Penelaah dan penyetuju dapat memakai akun admin Ditjen/Sesditjen yang berbeda; aplikasi menolak penyusun, pengaju, penelaah, atau penyetuju yang merangkap pada tahapan yang dilarang.

1. Buka **Master Data > Versi Aturan**.
2. Pilih instrumen Klasifikasi atau JRA, lalu klik **Buat Draft dari Versi Aktif**.
3. Isi nomor/versi, tanggal berlaku, dasar hukum, dan URL sumber resmi bila ada. Unggah PDF sumber; SHA-256 dan jumlah halaman **dihitung oleh server**, bukan diketik sebagai bukti.
4. Edit butir pada halaman master atau impor manifest JSON ke draft. Impor mengganti isi draft secara atomik; versi aktif tidak berubah.
5. Verifikasi manifest kelengkapan (jumlah item, jumlah selectable, jumlah halaman, dan rentang halaman sumber), lalu buat laporan diff dan dampak terhadap arsip yang masih memakai edisi sebelumnya.
6. Jalankan **Validasi**. Perbaiki kode ganda, parent hilang/ambigu, siklus hierarki, item parent yang dapat dipilih, halaman sumber yang belum dicatat, atau durasi yang tidak valid.
7. Jalankan urutan **Ajukan → Telaah → Setujui → Aktifkan** dengan akun independen dan catatan substantif pada setiap tahap.

PDF sampai 50 MiB diunggah langsung oleh browser ke namespace private Blob yang terikat pada ID draft. Setelah itu server mengunduh ulang objek private tersebut, memeriksa MIME/signature PDF dan ukuran, menghitung SHA-256 serta jumlah halaman, lalu menyimpan locator internal. URL private tidak ditampilkan pada respons API. Fallback multipart hanya untuk PDF maksimal 4 MiB dan tetap menyimpan byte yang diterima ke private Blob.

Jika PDF sumber edisi aktif dipakai ulang, server membuat objek baru pada namespace draft, mengunduh ulang salinan tersebut, lalu membandingkan SHA-256, ukuran, dan jumlah halaman dengan bukti edisi aktif. Salinan baru memperoleh waktu verifikasi dan pelaku verifikasi saat ini; bukti pelaku/waktu lama tidak diwariskan.

Admin tata kelola dan auditor dapat memakai **Lihat/Unduh PDF**. Aplikasi mengambil stream melalui endpoint terautentikasi `GET /api/regulatory-rule-sets/:id/source-document`; locator Blob tidak dikirim kepada browser dan setiap akses dicatat. Baseline lama yang bitstream-nya belum dimigrasikan ditolak dengan status `409`, bukan diarahkan ke URL publik.

Aktivasi menutup masa berlaku versi sebelumnya. Arsip lama tetap menunjuk versi, butir, dasar hukum, hash dokumen, dan snapshot keputusan yang lama. Jejak perubahan item serta transisi workflow ditulis secara transaksional ke rantai audit append-only; menu Audit menyediakan pemeriksaan integritas rantai.

### Kontrak perluasan penyimpanan bukti

Bukti appraisal, pemicu retensi, dan serah permanen yang kelak memakai direct upload harus mengikuti pola yang sama: token upload terikat `purpose` dan ID entitas; namespace private terikat tujuan/ID; server melakukan HEAD dan mengunduh ulang byte untuk memeriksa locator canonical, MIME, ukuran, signature, dan SHA-256; locator internal, hash, ukuran, MIME, waktu, serta pelaku disimpan secara atomik bersama keputusan. Hash atau URI dari command klien tidak boleh dianggap bukti fixity otoritatif sebelum alur verifikasi server tersebut selesai.

## Rekonsiliasi arsip lama

Arsip yang dibuat sebelum mekanisme ini berstatus `legacy_unverified`. Arsip tersebut tetap dapat dibaca, tetapi tidak dapat masuk proses penyusutan.

1. Buka detail arsip dan periksa badge **Provenance Aturan**.
2. Pilih **Rekonsiliasi Aturan**.
3. Pilih butir klasifikasi dan JRA aktif berdasarkan ID daftar, bukan dengan mengetik keputusan retensi bebas.
4. Isi alasan koreksi yang spesifik, lalu simpan.
5. Periksa tab **Jejak Aturan**. Revisi lama tidak dihapus; revisi baru menaut ke snapshot sebelumnya.

Rekonsiliasi ditolak ketika arsip sedang legal hold, sudah masuk batch penyusutan, atau penyusutannya telah dieksekusi.

## Keputusan yang memerlukan penilaian

Hanya keterangan JRA yang secara eksplisit dan tanpa syarat menyatakan **Musnah** atau **Permanen** yang menjadi hasil akhir otomatis. Ketentuan bersyarat, penyerahan berkas tertentu, bahan referensi, atau rumusan kontekstual diberi hasil **Dinilai Kembali**. Pemicu berbasis peristiwa harus dilengkapi jenis, label, tanggal, dan bukti sebelum tanggal akhir retensi dapat dihitung.

> Fitur ini adalah kontrol tata kelola aplikasi internal, bukan sertifikasi kepatuhan atau pengganti verifikasi Unit Kearsipan.
