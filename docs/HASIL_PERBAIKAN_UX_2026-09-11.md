# Perbaikan alur pengguna SIMSA — 11 September 2026

Arahan UI/UX diterapkan pada alur harian SIMSA: login, dasbor, daftar surat masuk,
surat keluar, arsip, dan formulir pencatatan. Identitas warna petrol dipertahankan.

## Perubahan yang dapat digunakan

- Tindakan **Catat Surat Masuk**, **Catat Surat Keluar**, dan **Cari Arsip** berada
  langsung di bawah judul dasbor. Tindakan disesuaikan dengan kewenangan pengguna.
- Pencarian dan filter surat/arsip memiliki label tetap. Nomor surat panjang
  membungkus pada layar kecil, tanpa menghilangkan isi nomor.
- Gagal memuat data dibedakan dari hasil kosong dan dilengkapi **Coba lagi**.
  Di dasbor, penyegaran yang gagal menandai data lama; respons unit lama tidak dapat menimpa
  ringkasan unit yang baru dipilih.
- Statistik surat masuk, surat keluar, dan arsip menampilkan **—** saat memuat
  atau gagal, dengan pesan dan aksi mencoba kembali. Nol hanya ditampilkan setelah
  permintaan berhasil. Hasil unit lama tidak ditampilkan saat unit berganti.
  Backend surat masuk meneruskan kegagalan query agar tidak berubah menjadi nol.
  Statistik surat keluar menghasilkan nol pada unit kosong dan mengecualikan
  surat yang telah dihapus, sesuai cakupan daftar.
- Formulir menolak pengiriman ulang selama proses dan sesudah berhasil sampai
  navigasi selesai. Perubahan surat keluar dan lampiran dilindungi saat berpindah
  halaman. Kegagalan simpan memindahkan fokus ke ringkasan error; kontrol khusus
  mempunyai pesan error yang terhubung.
- Status pelaporan arsip terjaga memakai tahap tersimpan. `dicatat` ditampilkan
  sebagai **Dicatat; pelaporan perlu ditinjau**, karena dapat mencakup draf,
  pencatatan lama, atau pelaporan yang dibatalkan. Status ini bukan bukti bahwa
  arsip sudah dilaporkan atau diterima ANRI.
- Pemberitahuan layanan berkas berada di dalam area halaman, sehingga tidak
  tertutup sidebar. Pesan tetap tampil pada login, panduan, dan area aplikasi.
- Struktur daftar navigasi dan nama kontrol diperbaiki. Font yang dibundel kini
  benar-benar digunakan. Preferensi gerakan terbatas berlaku pada grafik, animasi
  unggahan, dan perpindahan fokus ke kesalahan formulir.
- Menu ponsel dapat ditutup dengan satu kali Escape. Tooltip hanya dipasang saat
  sidebar desktop diciutkan, sehingga tidak menahan Escape ketika tidak terlihat;
  dialog bertumpuk tetap menutup lapisan teratas terlebih dahulu.
- Unggahan membedakan tahap penerimaan berkas, ekstraksi, dan peninjauan. Persentase
  ekstraksi memakai data server dan tersedia bagi pembaca layar; tidak ada
  persentase buatan saat server belum memberikan kemajuan.
- Pesan koneksi terputus menjelaskan tindakan berikutnya dan tetap benar ketika
  koneksi putus kembali sesaat setelah tersambung.

## Bukti pengujian

- Suite frontend akhir: **59 berkas, 338 tes lulus** (`--maxWorkers=2`). Lint
  frontend lulus. Percobaan empat worker bersamaan build mengalami enam timeout;
  pemeriksaan akhir memakai dua worker tanpa mengubah batas waktu atau melewati tes.
- Backend terkait dasbor: **15 tes lulus**, termasuk agregasi SQL dengan PGlite,
  pembatasan unit, dan klasifikasi akses. Service surat masuk: **30 tes lulus**,
  termasuk kegagalan query statistik serta nol yang sah. Service surat keluar dan
  integrasi SQL statistik: **33 tes lulus**, termasuk unit kosong, pembatasan
  klasifikasi, serta data terhapus. Total **78 tes backend terarah**.
  `tsc --noEmit` lulus.
- Build internal frontend/backend lulus. Pemeriksaan encoding memastikan file
  sumber yang berubah valid UTF-8.
- Browser Microsoft Edge: login pada `127.0.0.1:3000` dan `localhost:3000`,
  pencarian gagal/coba lagi/hasil kosong, statistik gagal/coba lagi, perlindungan
  isian surat keluar, Ctrl+K, Escape menu ponsel, serta putus/sambung koneksi lulus.
- Pemeriksaan axe pada login, dasbor, surat masuk, surat keluar, arsip, formulir
  masuk, dan formulir keluar: **tidak ada pelanggaran otomatis terdeteksi** pada
  tema terang maupun gelap dalam keadaan yang diperiksa. Ketujuh halaman tidak
  meluap secara horizontal pada lebar **320, 768, 1024, dan 1440 piksel**.
- Pemeriksaan halaman memakai service worker produksi. Service worker hanya
  diblokir pada skenario simulasi kegagalan agar penggantian respons jaringan
  oleh Playwright dapat diamati secara konsisten. Tidak ada perubahan kebijakan
  keamanan browser aplikasi untuk menjalankan pengujian.
- Bukti lokal utama berada di `output/playwright/ux-*`; tes terarah tambahan di
  `output/list-statistics-*`, `output/sidebar-keyboard-*`, dan log service backend
  dalam `output/` (semuanya diabaikan Git). Kata sandi dan cookie sesi tidak dicatat.

## Lingkup dan batas pengukuran

Pemeriksaan otomatis aksesibilitas dilengkapi pemeriksaan visual dan interaksi
keyboard pada alur yang disebutkan. Ini bukan sertifikasi seluruh halaman atau
pengganti uji tugas bersama pegawai yang akan memakai aplikasi. Acuan kontras dan
reflow: [W3C tentang kontras teks](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
dan [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

Ukuran bundle merupakan ukuran artefak dan estimasi gzip, bukan transfer browser
atau nilai Core Web Vitals lapangan. LCP, INP, dan CLS persentil 75 pengguna nyata
belum diukur. Acuan: [Core Web Vitals](https://web.dev/articles/vitals).

| Artefak build internal | Sebelum | Sesudah |
| --- | ---: | ---: |
| JavaScript awal, jumlah berkas | 4 | 4 |
| JavaScript awal, gzip (byte) | 195.930 | 195.885 |
| CSS awal, gzip (byte) | 32.149 | 32.064 |
| Aset precache PWA, jumlah berkas | 102 | 103 |
| Aset precache PWA, ukuran mentah (byte) | 3.104.398 | 3.115.559 |

Ukuran awal relatif tetap; total precache bertambah bersama kode umpan balik dan
aksesibilitas. Angka ini tidak digunakan untuk mengklaim percepatan pengalaman
pengguna. Pengukuran lapangan dan uji tugas bersama pegawai tetap diperlukan.

Pengelolaan metadata tersedia pada aplikasi lokal. Unggah berkas/OCR masih
memerlukan penyimpanan dan pemeriksaan keamanan berkas yang aktif. Pekerjaan ini
tidak mengaktifkan integrasi resmi SRIKANDI atau mengubah pengesahan instrumen
instansi. Tidak ada migrasi, reset, atau penggantian cluster database pada tahap ini.

Cara menjalankan aplikasi tetap mengikuti
[panduan operasional lokal](OPERASIONAL_LOKAL_2026-09-11.md).
