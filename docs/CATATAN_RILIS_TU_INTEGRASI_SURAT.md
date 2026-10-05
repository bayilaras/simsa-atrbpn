# Catatan rilis untuk TU: integrasi surat masuk dan keluar

Berlaku sejak 4 Oktober 2026 (SIMSA frontend C50, backend C51). Ditujukan untuk TU Sesditjen, Ditjen, dan admin unit direktorat.

## Yang baru

1. **Rangkaian surat.** Surat masuk, disposisi, tindak lanjut, dan surat keluar balasannya dikelompokkan dalam satu rangkaian berkode `RS-tahun-nomor`. Rangkaian selesai otomatis ketika semua disposisinya diselesaikan.
2. **Disposisi ke direktorat.** Dit. BPPT, Dit. PTEP, dan Dit. KTPP kini dapat menerima disposisi. Setiap direktorat mempunyai admin unit sendiri.
3. **Distribusi** (menu Distribusi). Di kotak masuk unit tersedia **Terima Surat**, **Buat Tindak Lanjut**, **Penyelesaian** (pilih surat keluar yang sudah disetujui, atau tulis catatan penyelesaian), dan **Tolak & Kembalikan** (wajib alasan).
4. **Lacak Surat** (menu Surat → Lacak). Cari nomor surat atau kata dalam perihal, minimal 3 karakter. Hasil dikelompokkan per rangkaian. Surat yang tidak boleh Anda baca tampil sebagai "Dikecualikan". Tab **Perlu Dilengkapi** memuat daftar kerja: disposisi terbuka, surat masuk belum ditindaklanjuti, rangkaian siap diberkaskan, dan lainnya.
5. **Hak baca.** Admin unit membaca surat unitnya dan rangkaian yang diikutinya. Ditjen dan Sesditjen adalah unit pengawas yang dapat membaca rangkaian seluruh direktorat.

## Lampiran dan pemeriksaan antivirus

- Setiap lampiran PDF disimpan privat dan diperiksa antivirus sebelum dapat dibuka atau diunduh. Pemeriksaan biasanya selesai beberapa detik setelah surat disimpan.
- Selama diperiksa, detail surat menampilkan "Dokumen tersimpan dan menunggu pemeriksaan". Klik **Periksa status**; bila lebih dari dua menit masih menunggu, klik **Lanjutkan pemeriksaan**.
- Bila tertulis "Dokumen belum dapat digunakan", jangan unggah ulang berkas yang sama. Hubungi super_admin.

## Untuk super_admin

- **Pengaturan → Unit Kerja**: sakelar **Dapat menerima distribusi** (matikan untuk unit yang belum memiliki admin unit aktif) dan **Unit Pengawas** (hanya Ditjen dan Sesditjen).
- **Manajemen Pengguna**: admin direktorat dibuat dengan peran Admin Unit dan unit kerja direktoratnya. Pengguna masuk dengan akun Google yang emailnya sama.
- Monitoring Operasional dan workflow GitHub memantau database, penyimpanan, pemindai, antrean, integritas berkas, backup, dan uji pemulihan. Pemindai dibangunkan otomatis sebelum verifikasinya kedaluwarsa.

## Bila ada masalah

Catat nomor surat, kode rangkaian, waktu, dan tangkapan layar pesan galat, lalu laporkan ke super_admin. Jangan menghapus surat atau lampiran untuk mengulang proses.
