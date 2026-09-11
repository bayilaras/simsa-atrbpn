# Catatan pelaporan arsip terjaga

SIMSA mencatat bukti pengiriman melalui kanal resmi, penerimaan, dan pemeriksaan internal. Sistem ini tidak mengirim laporan ke ANRI, tidak mengesahkan kepatuhan hukum, dan tidak menyatakan bahwa ANRI telah memverifikasi arsip.

1. Buka Arsip Terjaga → Catatan pelaporan. Nomor dan tanggal hanya menghasilkan **draf tercatat**.
2. Unggah bukti sebagai lampiran arsip. Lampiran tetap dalam karantina sampai scanner dan pemeriksaan integritas berhasil. Pilih dokumen berdasarkan namanya, isi tanggal tindakan serta catatan, lalu catat bukti pengiriman.
3. Catat bukti penerimaan dengan cara yang sama. Bukti harus milik arsip yang sedang dibuka, privat, bersih, dan utuh. Server membaca kembali byte lampiran; hash tidak diterima dari formulir pengguna.
4. Pemeriksa aktif yang berwenang mengelola arsip dan memiliki role pemeriksa membuka dokumen lalu memverifikasi bukti. Pemeriksa harus berbeda dari pembuat catatan, pencatat pengiriman/penerimaan, serta pengunggah bukti. Akses arsip yang dibatasi tetap membutuhkan izin per rekod yang masih berlaku.
5. Catatan final dan bukti sebelumnya tidak dapat ditimpa atau dihapus. Koreksi dilakukan dengan pembatalan beralasan sebelum final, atau siklus baru setelah final. Riwayat dan audit tetap tersedia. Jadwal review berikutnya dikelola terpisah dari verifikasi bukti.

Status `bukti_diverifikasi` berarti pemeriksaan bukti internal selesai. Tidak ada transisi yang menetapkan `statusKepatuhan=patuh` atau menghapus penilaian terlambat. Role teknis pemeriksa yang tersedia saat ini adalah `super_admin`, `admin_dirjen`, dan `admin_sesditjen`; instansi tetap perlu menetapkan siapa yang diberi mandat tersebut.

## Migrasi dan konfigurasi

Migrasi `0036_terjaga_reporting_evidence.sql` menyimpan klaim historis dalam `arsip_terjaga.legacy_reporting`. Status lama dilaporkan/terverifikasi diturunkan menjadi `dicatat`; klaim `patuh` diturunkan menjadi `belum_dinilai`. Nomor, tanggal, dan nilai historis tidak hilang. Rekod lama tidak mendapatkan bukti atau verifikasi baru secara otomatis.

Tabel `arsip_terjaga_reports` menyimpan setiap siklus beserta hash, lampiran, pelaku, waktu, catatan dan status. Referensi lampiran tidak boleh dihapus; trigger database membekukan identitas, bukti yang sudah dicatat, dan rekod final. Runtime API mendapat SELECT/INSERT/UPDATE tanpa DELETE. Audit wajib disimpan dalam transaksi yang sama.

Jalankan migrasi dan konvergensi grants sesuai prosedur deployment sebelum menggunakan fitur. Storage privat serta worker antivirus harus operasional untuk menambahkan bukti; konfigurasi lokal tanpa storage tidak melewati pemeriksaan ini. Tidak diperlukan kredensial atau endpoint ANRI untuk pencatatan lokal ini.

## Kontrak API

- `GET /api/arsip-terjaga/:id/reports`: siklus, daftar lampiran, dan kemampuan pengguna berdasarkan akses rekod.
- `POST /api/arsip-terjaga/:id/reports`: `{ nomorLaporan, tanggalPelaporan }` membuat draf. Endpoint lama `PUT /:id/report` juga hanya membuat draf.
- `POST /api/arsip-terjaga/:id/reports/:reportId/transitions`: `send`/`receive` membutuhkan `{ action, attachmentId, occurredOn, notes }`; `verify`/`cancel` membutuhkan `{ action, notes }`.
- Create/update metadata penetapan menolak field status pelaporan, nomor/tanggal laporan, dan status kepatuhan. Gunakan alur khusus di atas.

Uji regresi mencakup migrasi klaim lama, siklus lengkap, independensi pemeriksa, berkas asing/publik/karantina/berubah/hilang, akun dinonaktifkan, audit gagal, bukti final, NULL pada constraint SQL, dan hak DELETE runtime. Uji ini menggunakan database terisolasi dan storage tiruan; uji storage/scanner sungguhan serta penerimaan pengguna pada lingkungan tujuan tetap diperlukan.
