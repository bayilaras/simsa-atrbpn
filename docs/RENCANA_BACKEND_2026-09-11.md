# Penguatan backend SIMSA

Arahan backend diterapkan pada SIMSA internal yang sudah berjalan. Express,
PostgreSQL, penyimpanan privat, dan mekanisme antrean yang ada dipertahankan.

## Batas kepercayaan dan hasil yang harus dibuktikan

- Permintaan browser membawa identitas, input, dan ID rekod yang tidak boleh
  menentukan izin sendiri. Klasifikasi surat keluar diperiksa saat pencatatan;
  perubahan arsip harus memeriksa kembali keadaan dan mandat di dalam transaksi.
- Unggahan/provider eksternal dapat gagal di antara penyimpanan objek dan commit
  database. Objek yang belum terikat harus tetap dapat ditemukan untuk pemulihan;
  pekerjaan macet tidak boleh menghasilkan penyelesaian palsu atau duplikasi.
- Log harus menghubungkan permintaan gagal dengan nomor penelusuran, waktu respons,
  serta kelompok API, tanpa body, cookie, token, parameter pencarian, atau isi arsip.
  Pengukuran operasional hanya boleh diakses administrator berwenang.
- Backup aktual harus terenkripsi dan dapat diverifikasi dari artifact tersimpan
  dalam proses baru. Pemulihan diuji pada cluster baru, dengan identitas sumber
  serta target diperiksa; database aktif tidak boleh ditimpa atau dimigrasikan.
- Ketergantungan diperiksa menggunakan lockfile yang ada. Perubahan hanya dibuat
  untuk temuan yang terbukti atau untuk melengkapi kemampuan operasional di atas.

## Verifikasi

Gunakan tes regresi hak akses, race transaksi, kegagalan provider, telemetri dan
penjagaan target pemulihan; lanjutkan suite backend, pemeriksaan tipe, build, serta
uji HTTP lokal. Pertahankan seluruh pemeriksaan yang sudah ada. Backup dan restore
nyata dibuktikan terpisah dari simulasi. Ukuran serta durasi pengujian dicatat
sebagai pengamatan lokal, bukan jaminan kapasitas, RPO, atau RTO organisasi.

Layanan berkas/OCR tetap mengikuti konfigurasi dan pemeriksaan kesiapan yang ada.
Pekerjaan ini tidak mengaktifkan integrasi luar, pengiriman notifikasi eksternal,
jadwal backup otomatis, atau publikasi aplikasi.
