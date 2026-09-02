# 🔑 Persetujuan Akses Rekod Terkendali

Fitur ini digunakan untuk meminta akses ke bitstream dengan klasifikasi **Terbatas**, **Rahasia**, atau **Sangat Rahasia**. Role administrator tidak otomatis membuka isi rekod terkendali.

> Persetujuan dalam SIMSA tidak menggantikan clearance personal, surat tugas, atau kewenangan pejabat yang ditetapkan Kementerian.

## Mengajukan permohonan

1. Buka **Administrasi → Persetujuan Akses**.
2. Klik **Minta akses**.
3. Pilih jenis rekod dan masukkan UUID rekod.
4. Pilih **Tayang saja**, **Tayang dan unduh**, atau **Tayang dan kelola (tanpa unduh)** sesuai kebutuhan minimum.
5. Jelaskan tujuan kedinasan secara spesifik, lalu kirim.

Permohonan tidak langsung membuka rekod. Status awalnya **Menunggu** sampai diputuskan oleh super admin lain.

## Memutuskan permohonan

Khusus super admin:

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

- Grant hanya berlaku untuk pengguna, rekod, klasifikasi, dan mode akses yang disetujui.
- Perubahan unit pengguna atau klasifikasi rekod menyebabkan akses gagal-tertutup.
- Izin **Tayang saja** tidak dapat digunakan untuk mengunduh.
- Izin **Tayang saja** dan **Tayang dan unduh** tidak dapat digunakan untuk mengubah rekod; mutasi memerlukan izin **Tayang dan kelola**.
- Izin **Tayang dan kelola** tidak otomatis mengizinkan pengunduhan.
- Rekod yang dihapus, diarsipkan, terkena legal hold, atau selesai disusutkan tetap mengikuti pembatasan mutasi masing-masing.
- Penayangan dan pengunduhan mencatat ID grant, tujuan yang disetujui, waktu kedaluwarsa, pengguna, dan rekod pada audit.
- Keputusan tidak dihapus permanen.

## Tindakan operasional wajib

Sebelum digunakan untuk arsip Rahasia/Sangat Rahasia, organisasi tetap harus menetapkan register clearance, matriks approver, aturan need-to-know, watermark, pengendalian cetak, recertification, pencabutan saat mutasi pegawai, dan pemantauan SIEM.
