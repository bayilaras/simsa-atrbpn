# Kelanjutan retensi dan bukti pelaksanaan penyusutan

Perubahan ini memperbaiki alur aplikasi. Keabsahan keputusan, kewenangan pejabat/saksi, dan isi berita acara tetap ditelaah oleh Unit Kearsipan; kelulusan validasi aplikasi bukan persetujuan ANRI.

## Pemindahan ke inaktif

`disposalStatus` menunjukkan ketersediaan untuk proses penyusutan, bukan fase retensi. Setelah batch `pemindahan` dilaksanakan, arsip kembali tersedia (`active`, tanpa `disposalBatchId`). Tanggal dan batch pemindahan tersimpan pada `inactiveTransferredAt`/`inactiveTransferBatchId`; daftar item batch tetap menjadi riwayat. Fase aktif/inaktif dan kelayakan hasil akhir tetap dihitung dari snapshot JRA dan peristiwa retensi yang sah. Pemindahan berulang ditolak. Alih media juga tidak mengakhiri siklus arsip.

Arsip lama yang terlanjur bertanda `executed` karena pemindahan tidak diubah otomatis oleh migrasi. Administrator lain dapat memakai **Pulihkan kelanjutan retensi** pada detail batch setelah memeriksa rekam pelaksanaan dan menulis alasan. API: `POST /api/penyusutan/:id/recover-transfer?unitKerjaId=...`, `{reason}`. Proses mengunci batch/arsip, menolak legal hold, perubahan pemilik batch, perbaikan berulang, unit yang berbeda, dan jenis selain pemindahan. Audit menyimpan alasan, pelaksana/tanggal lama, serta perubahan status. Batch lama tetap tidak diubah.

## Pemusnahan final

`PUT /api/penyusutan/:id/status` untuk transisi pemusnahan `approved → executed` sekarang memerlukan `executionEvidence`:

- `beritaAcaraAttachmentId`, `decisionAttachmentId`, `executionProofAttachmentId`.
- `performedAt` (ISO timestamp, sesudah tanggal persetujuan dan bukan masa depan), `method`, `copiesStatement`.
- `witnesses`: sedikitnya dua pengguna berbeda beserta `authorityAttachmentId`. Ini adalah kontrol internal aplikasi; pejabat menentukan penugasan dan jumlah saksi yang diwajibkan ketentuan/SOP yang berlaku.

Pilihan dokumen dan saksi ditampilkan dengan nama melalui `GET /api/penyusutan/:id/execution-options`. Lampiran harus milik arsip dalam batch, privat, mempunyai hash, lulus pemeriksaan malware, dan lulus pemeriksaan integritas. Saksi harus aktif dan memiliki mandat unit; pelaksana pencatat harus berbeda dari saksi serta seluruh pelaku usul/review/persetujuan sebelumnya. Arsip terkendali tetap memerlukan grant kelola per rekod yang belum kedaluwarsa. Penetapan terjaga menghentikan kandidat/transisi pemusnahan sampai ditinjau melalui tata kelola penetapan; status pelaporan terjaga tidak menghapus perlindungan ini.

BA yang baru selesai dapat diunggah pada detail batch melalui `POST /api/penyusutan/:id/evidence` (multipart `arsipId`, `file`; PDF/JPEG/PNG, 10 MB). Endpoint ini terbatas pada pemusnahan disetujui dan arsip yang masih dimiliki batch. Upload masuk karantina; status bersih tidak dapat ditetapkan oleh formulir. Endpoint lampiran biasa tetap mengikuti izin arsip yang berlaku.

Eksekusi menyimpan snapshot identitas dokumen, hash, saksi, metode, waktu, dan pernyataan penanganan salinan, dengan hash snapshot dan audit dalam transaksi yang sama. Kegagalan audit membatalkan transaksi. Database melarang pengubahan/penghapusan batch selesai serta penggantian/penghapusan metadata bitstream bukti; pemeriksaan integritas berikutnya tetap dapat mencatat kerusakan. Fungsi trigger pemeriksaan referensi memakai akses baca terbatas melalui `SECURITY DEFINER` dan `search_path=pg_catalog`, sehingga worker tidak memerlukan akses ke daftar penyusutan.

Transisi, unggah bukti, dan pemulihan pemindahan memuat ulang akun aktif, peran, dan mandat unit setelah mengunci arsip dalam transaksi. Finalisasi membaca ulang byte setiap lampiran bukti unik dengan batas ukuran/waktu pemeriksaan integritas, lalu memeriksa kembali masa berlaku grant sebelum menyimpan snapshot. Hash snapshot memakai representasi JSON kanonis agar tetap cocok setelah disimpan sebagai JSONB.

Pilihan bukti juga membaca status batch dan metadata arsip di dalam transaksi setelah penguncian; perubahan klasifikasi, unit, legal hold, atau status proses harus memenuhi pemeriksaan terkini sebelum nama dokumen ditampilkan. Tanggal usul, review, persetujuan, dan pelaksanaan memakai kalender Asia/Jakarta, termasuk tindakan setelah tengah malam WIB.

Jika byte berbeda, transaksi menyimpan status integritas `mismatch` beserta audit penolakan, sementara batch tetap disetujui dan belum dilaksanakan. Jika storage tidak tersedia, proses gagal tanpa menyatakan pemeriksaan baru berhasil. Jika audit tidak dapat disimpan, seluruh transaksi termasuk hasil pemeriksaan dibatalkan; perbaiki audit dan ulangi pemeriksaan. Pemeriksaan integritas terjadwal tetap diperlukan untuk memantau berkas setelah transaksi selesai.

Pencatatan ini **tidak menjalankan penghapusan objek/replika/backup** dan tidak membuktikan isi dokumen benar secara hukum. Pelaksanaan fisik/digital, kebijakan salinan, jadwal backup, dan uji operasional harus dilaksanakan serta dibuktikan oleh petugas. Penyimpanan privat dan worker antivirus diperlukan agar bukti dapat keluar dari karantina. Tidak ada kredensial layanan atau bukti pelaksanaan yang dibuat secara sintetis untuk penggunaan nyata.

## Migrasi dan verifikasi

Migrasi `0035_disposition_lifecycle_evidence` menambah kolom dan trigger; tidak memperbarui arsip historis otomatis. Jalankan melalui runner migrasi yang biasa digunakan dan verifikasi grant/readiness. Uji utama mencakup pemindahan lalu disposition berikutnya, pemindahan berulang, hold/grant/terjaga, bukti kurang/asing/karantina, saksi tidak sah, audit gagal, repair historis, SQL immutability, serta formulir unggah dan pengisian bukti.
