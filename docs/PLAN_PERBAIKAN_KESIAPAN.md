# Rencana perbaikan kesiapan SIMSA

Dimulai 11 September 2026 atas permintaan pemilik aplikasi setelah asesmen ANRI/SRIKANDI. Target adalah versi lengkap SIMSA. Sumber temuan: `ASESMEN_ANRI_SRIKANDI_2026-09-11.md`.

## Pekerjaan aplikasi

- [x] Perbaiki siklus pemindahan → inaktif → penyusutan berikutnya, termasuk pemulihan terkendali data lama.
- [x] Wajibkan bukti pelaksanaan pemusnahan, saksi, dan audit sebelum status final; pertahankan legal hold dan pemisahan pelaku.
- [x] Pisahkan pencatatan/pengiriman/penerimaan/verifikasi laporan arsip terjaga; bukti terkendali dan pemeriksa terpisah; jangan memberi label kepatuhan ANRI otomatis.
- [x] Tolak tanggal impor yang hilang/tidak valid; sediakan pratinjau dan hasil per baris.
- [x] Hentikan ekspor yang melampaui batas dengan penjelasan yang jelas; jangan menghasilkan file terpotong tanpa pemberitahuan.
- [x] Sediakan pekerjaan pemeriksaan integritas berkala dengan batas sumber daya, audit, kegagalan yang terlihat, dan panduan penjadwalan.
- [x] Periksa pengesahan instrumen, catatan preservasi, kesiapan skema/izin database, serta panduan akun dan uji penerimaan.
- [ ] Jalankan pengujian regresi, build/lint, migrasi pada database uji, dan pemeriksaan browser atas perubahan.
- [ ] Tinjau hasil secara independen dan perbarui laporan status akhir serta daftar kebutuhan lingkungan tujuan.

## Bukti eksternal yang tetap diperlukan

- Server/domain tujuan, penyimpanan privat, layanan antivirus dan worker.
- Backup database bersama berkas, restore drill pada lingkungan tujuan, pemantauan dan petugas respons.
- Instrumen kearsipan, matriks pejabat/mandat, SOP dan penerimaan petugas/arsiparis.
- Kontrak, izin, sandbox dan penerimaan integrasi SRIKANDI; layanan TTE hanya bila menjadi lingkup penerbitan surat.

Pengujian lokal tidak dianggap sebagai bukti tersedianya layanan atau persetujuan tersebut. Implementasi tidak mengirim arsip keluar, menerbitkan surat resmi, atau memusnahkan berkas secara otomatis.
