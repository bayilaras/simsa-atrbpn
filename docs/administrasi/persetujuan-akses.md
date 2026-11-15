# 🔑 Persetujuan Akses Rekod Terkendali

Fitur ini digunakan untuk meminta akses ke surat atau arsip dengan klasifikasi **Terbatas**, **Rahasia**, atau **Sangat Rahasia**. Peran administrator tidak otomatis membuka isi rekod terkendali.

> Persetujuan dalam SIMSA tidak menggantikan clearance personal, surat tugas, atau kewenangan pejabat yang ditetapkan Kementerian.

## Mengajukan permohonan

Cara termudah adalah mengajukan dari rekodnya langsung:

1. Buka surat atau arsip dari daftarnya. Bila isinya belum boleh Anda buka, halaman menampilkan judul **Perlu persetujuan akses** dengan nomor dan perihal rekod. Keterangannya menyebut kelas rekod, misalnya *Surat ini berkelas keamanan Terbatas. Datanya tetap tersimpan dan tidak dihapus, tetapi isinya baru dapat dibuka setelah permohonan akses Anda disetujui Super Admin.*
2. Klik **Minta Akses**. Halaman **Persetujuan Akses Rekod** terbuka dengan dialog **Minta akses rekod terkendali** yang sudah terisi untuk rekod itu; kotak **Rekod yang diminta** menampilkan nomor dan perihalnya.
3. Pilih **Mode akses**: **Tayang saja**, **Tayang dan unduh**, atau **Tayang dan kelola (tanpa unduh)** sesuai kebutuhan minimum.
4. Isi **Tujuan kedinasan** secara spesifik (minimal 20 karakter), lalu klik **Kirim permohonan**.

Anda juga dapat membuka **Administrasi → Persetujuan Akses Arsip** dan mengklik **Minta akses**. Karena belum ada rekod yang terpilih, pilih **Jenis rekod** dan isi **ID rekod**, yaitu deret kode di akhir alamat halaman detail rekod tersebut.

Permohonan tidak langsung membuka rekod. Status awalnya **Menunggu** sampai diputuskan oleh Super Admin lain. Pantau statusnya pada tab **Permohonan Saya**.

Rekod milik unit lain, di atas kewenangan kelas peran Anda, atau yang memang tidak ada tetap menampilkan **Surat Tidak Ditemukan** atau **Arsip Tidak Ditemukan**, tanpa tombol **Minta Akses**.

## Memutuskan permohonan

Khusus Super Admin:

1. Buka tab **Perlu Keputusan**.
2. Periksa identitas pemohon, unit, rekod, klasifikasi, tujuan, dan mode akses.
3. Pilih **Setujui** atau **Tolak**.
4. Bila disetujui, tetapkan masa berlaku antara 15 menit dan 30 hari.
5. Tuliskan dasar keputusan. Pemohon tidak dapat menyetujui permohonannya sendiri.

Akses aktif dapat dicabut sewaktu-waktu dengan alasan yang dicatat.

## Arti status

| Status | Arti |
|---|---|
| Menunggu | Belum ada keputusan |
| Disetujui | Dapat dipakai sampai masa berlaku berakhir |
| Ditolak | Permohonan tidak diberikan |
| Dicabut | Persetujuan dihentikan sebelum kedaluwarsa |
| Kedaluwarsa | Masa berlaku telah selesai |

## Perilaku keamanan

- Persetujuan hanya berlaku untuk pengguna, rekod, klasifikasi, dan mode akses yang disetujui.
- Bila unit pengguna atau klasifikasi rekod berubah, akses tertutup dan perlu diajukan ulang.
- Izin **Tayang saja** tidak dapat digunakan untuk mengunduh. Mode ini hanya menyembunyikan tombol unduh, cetak, dan buka di tab baru; isi berkas tetap tampil di layar peminta dan dapat disalin, dan setiap penayangan tercatat di Audit Log. Keterangan ini juga tampil saat memilih mode **Tayang saja** dan saat Super Admin menyetujuinya.
- Izin **Tayang saja** dan **Tayang dan unduh** tidak dapat digunakan untuk mengubah rekod; mutasi memerlukan izin **Tayang dan kelola**.
- Izin **Tayang dan kelola** tidak otomatis mengizinkan pengunduhan.
- Rekod yang dihapus, diarsipkan, terkena legal hold, atau selesai disusutkan tetap mengikuti pembatasan mutasi masing-masing.
- Penayangan dan pengunduhan mencatat persetujuan yang dipakai, tujuan yang disetujui, waktu kedaluwarsa, pengguna, dan rekod pada audit.
- Keputusan tidak dihapus permanen.

## Tindakan operasional wajib

Sebelum digunakan untuk arsip Rahasia/Sangat Rahasia, organisasi tetap harus menetapkan register clearance, matriks approver, aturan need-to-know, watermark, pengendalian cetak, recertification, pencabutan saat mutasi pegawai, dan pemantauan SIEM.
