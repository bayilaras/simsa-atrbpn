# Uji penerimaan pengguna SIMSA

Gunakan data uji yang terpisah dari arsip resmi. Petugas mencatat tanggal, versi aplikasi, akun/peran, hasil aktual, dan bukti untuk setiap skenario. Tabel ini adalah panduan pengujian; kolom hasil tidak dianggap lulus sebelum diuji di lingkungan tujuan.

| Skenario | Hasil yang harus terbukti |
|---|---|
| Login dan logout | Akun aktif dapat masuk, sesi berakhir setelah logout, kata sandi salah ditolak. Pada lokal, `localhost:3000` dan `127.0.0.1:3000` sama-sama dapat dipakai jika keduanya diizinkan operator. |
| Peran dan unit kerja | Petugas melihat unit yang ditugaskan; akses unit lain ditolak. Auditor tidak dapat mengubah arsip. |
| Arsip terbatas/rahasia | Pengguna tanpa pemberian akses tidak dapat membaca/mengubah/mengunduh. Uji juga dengan Super Admin untuk operasi yang membutuhkan hak khusus per arsip. |
| Penonaktifan pengguna | Akun tidak dapat membuat sesi baru; sesi lama tidak dapat melanjutkan operasi yang sudah dicabut. |
| Impor CSV | Pratinjau tidak menambah data. Tanggal kosong, tidak sah dan header duplikat ditolak dengan nomor baris/alasan. Impor ulang diperiksa untuk duplikasi. |
| Ekspor | Hasil sesuai filter dan hak akses. Lebih dari 10.000 baris ditolak dengan arahan mempersempit filter; tidak ada file terpotong diam-diam. |
| Unggah dokumen | File privat; menunggu antivirus sebelum dilepas. Berkas berbahaya, hash tidak cocok, atau akses tanpa kewenangan ditolak. |
| Pemindahan arsip | Selesai pemindahan mempertahankan riwayat dan memungkinkan tahap penyusutan berikutnya sesuai JRA. Pemindahan ulang yang sama ditolak. |
| Pemulihan data pemindahan lama | Hanya petugas berwenang memakai alur pemulihan dengan alasan; tidak membuka arsip yang sudah masuk proses baru atau terkena legal hold. |
| Pemusnahan | Tanpa bukti final, saksi atau kewenangan, finalisasi ditolak. Bukti dan audit final tidak dapat diubah/dihapus. Catatan pelaksanaan tidak otomatis menghapus seluruh berkas storage. |
| Arsip terjaga | Nomor/tanggal hanya membuat draf. Tahap pengiriman/penerimaan memerlukan lampiran terkendali. Pemeriksa yang berbeda memverifikasi bukti internal; tidak muncul klaim otomatis patuh atau terverifikasi oleh ANRI. |
| Preservasi | Pemeriksaan integritas benar-benar membaca byte. Pencatatan kegiatan eksternal menampilkan bukti, hasil dan alat yang dipakai; catatan lama berlabel belum diverifikasi. |
| Pemeriksaan berkala | Jadwal berjalan, kegagalan memicu alarm, antrean tertangani dan mismatch tidak dibuka otomatis. |
| Backup dan pemulihan | Database dan byte dokumen dipulihkan di lingkungan terpisah; hash/ukuran, jumlah data, izin dan unduhan cocok. |
| Integrasi resmi | Jika SRIKANDI/TTE masuk ruang lingkup, uji memakai kontrak dan lingkungan resmi serta bukti penerimaan. Tanpa itu, jangan menyatakan integrasi sudah operasional. |

Arsiparis/penanggung jawab instansi memeriksa klasifikasi, JRA, tata naskah, mandat pejabat, akses dan SOP yang benar untuk unitnya. Pengujian perangkat lunak tidak menggantikan pengesahan instrumen atau kewajiban penggunaan SRIKANDI.

Simpan daftar temuan dan bukti kelulusan. Perbaiki kegagalan kritis sebelum pengguna memasukkan arsip resmi. Panduan terkait: [akun](administrasi/user-management.md), [penyusutan](PENYUSUTAN_TERKENDALI.md), [pelaporan terjaga](PELAPORAN_TERJAGA_BERBUKTI.md), [integritas berkala](OPERASI_PEMERIKSAAN_INTEGRITAS.md).
