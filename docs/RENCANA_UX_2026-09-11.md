# Perbaikan alur harian SIMSA

Arahan pengguna diterapkan pada aplikasi administrasi SIMSA: informasi yang jelas,
tindakan sesuai kewenangan, dan formulir yang aman dipakai. Warna petrol, tipografi,
filter lanjutan, dan tabel responsif yang sudah ada dipertahankan.

## Ruang lingkup dan kriteria penerimaan

1. Dasbor menempatkan tindakan pekerjaan harian sebelum grafik. Staf/auditor tidak
   ditawari rute khusus admin. Tahap pelaporan terjaga mencerminkan status tersimpan;
   draf tidak boleh disebut telah dilaporkan ke ANRI.
2. Dasbor pengawasan dan daftar surat membedakan kegagalan jaringan dari hasil
   kosong. Pengguna dapat mencoba kembali, dan angka lama tidak terlihat sebagai
   hasil terbaru ketika penyegaran gagal.
3. Formulir masuk/keluar menolak pengiriman ulang selama permintaan dan setelah
   berhasil sampai navigasi selesai. Perubahan Surat Keluar dilindungi saat pengguna
   berpindah. Kesalahan yang muncul setelah simpan dapat ditemukan dengan keyboard.
4. Pencarian dan filter pada surat/arsip memiliki label tetap yang terhubung dengan
   kontrol. Tata letak diuji pada lebar 320, 768, 1024, dan 1440 piksel.
5. Pemberitahuan layanan berkas tetap jujur, terbaca, serta tidak tertutup navigasi.
   Status pemuatan terbaca; animasi JavaScript mengikuti preferensi gerakan terbatas.

## Verifikasi

- Tes perilaku terarah untuk perubahan status, kegagalan/retry, kewenangan dan simpan.
- Suite frontend, lint, build internal, serta pengujian backend terkait bila berubah.
- Pemeriksaan browser untuk login, dasbor, pencarian, formulir, keyboard dan reflow.
- Catat ukuran bundle dan hasil pemeriksaan aksesibilitas lokal. Pengukuran lokal
  bukan bukti Core Web Vitals persentil 75 pengguna nyata atau sertifikasi WCAG.

Tidak mengubah instrumen instansi, hak akses, konfigurasi penyimpanan, atau status
integrasi resmi. Optimalisasi pemuatan hanya dilakukan jika ada bukti dan dapat
diverifikasi tanpa mengurangi perlindungan data.
