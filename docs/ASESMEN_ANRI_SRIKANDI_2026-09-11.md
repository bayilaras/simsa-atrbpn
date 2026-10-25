# Asesmen SIMSA terhadap ANRI, SRIKANDI, dan kesiapan pengguna

**Pembaruan:** rekomendasi kode dalam asesmen awal ini telah ditindaklanjuti. Lihat [hasil perbaikan dan pengujian](HASIL_PERBAIKAN_KESIAPAN_2026-09-11.md) untuk keadaan aplikasi sesudah perbaikan. Isi berikut dipertahankan sebagai catatan asesmen awal.

Tanggal: 11 September 2026. Kode yang diperiksa: `23a0b1b`, branch lokal `fix/user-readiness`, versi lengkap `frontend/` dan `backend/`. Edisi Spark tidak termasuk.

## Kesimpulan

SIMSA sudah memiliki banyak kontrol kearsipan yang relevan, tetapi **belum dapat dinyatakan sesuai penuh dengan ketentuan ANRI, terintegrasi resmi dengan SRIKANDI, atau siap untuk seluruh penggunaan operasional**. Masih terdapat celah perilaku aplikasi, bukti pelaksanaan, konfigurasi infrastruktur, dan penetapan kewenangan.

Ini adalah asesmen teknis awal lintas modul melalui pembacaan kode, pengujian yang telah tersedia, dan pemeriksaan sumber peraturan resmi. Temuan kode baru di bawah belum direproduksi melalui pengujian integrasi dalam asesmen ini. Pemeriksaan ini bukan penilaian resmi ANRI, pengujian penetrasi, atau audit seluruh baris kode. Tidak ada perubahan perilaku aplikasi, pengiriman data ke SRIKANDI, atau deployment dalam pekerjaan ini.

## Dasar penilaian dan batas sistem

SRIKANDI adalah aplikasi umum bidang kearsipan dinamis pemerintah, bukan nama satu standar yang otomatis dipenuhi dengan meniru menu. Penetapannya dirujuk pada [Kepmen PANRB 679/2020](https://jdih.menpan.go.id/dokumen-hukum/keputusan-menteri-pendayagunaan-aparatur-negara-dan-reformasi-birokrasi-nomor-679-tahun-2020-tentan-1137). [Peraturan ANRI 4/2021, Pasal 2–3](https://jdih.anri.go.id/storage/rules/January2024/GfOD5OlHAJWvwmMcHY4O.pdf) mengatur penerapan SRIKANDI oleh lembaga yang disebutkan, dengan mengacu pada pedomannya. Kebijakan fitur SIMSA tidak dapat dipakai sebagai pengecualian kewajiban instansi tersebut.

Untuk pengelolaan arsip elektronik, [Peraturan ANRI 6/2021](https://peraturan.bpk.go.id/Details/192784/peraturan-anri-no-6-tahun-2021) menjadi acuan prinsip autentisitas, keandalan, keutuhan, ketergunaan, tahapan pengelolaan, dan keamanan. Untuk lingkungan pengguna aplikasi ini, [Permen ATR/BPN 2/2026](https://peraturan.bpk.go.id/Details/346032/permen-atrkepala-bpn-no-2-tahun-2026) juga relevan; registri resmi mencatat berlaku sejak 9 Februari 2026. Lampiran II mengatur pengelolaan arsip dinamis konvensional dan elektronik, termasuk akses, penyusutan, dan arsip terjaga. Kebutuhan tata naskah dinas, klasifikasi, JRA, serta klasifikasi keamanan dan akses juga dijelaskan oleh [ANRI tentang instrumen kearsipan](https://www.anri.go.id/publikasi/berita/arsip-nasional-republik-indonesia-sosialisasikan-instrumen-kearsipan-dan-srikandi).

**Rekomendasi arsitektur:** SIMSA menjadi aplikasi substantif/pengelolaan berkas internal pendamping. Unit Kearsipan, pemilik proses, dan pengelola TI perlu menetapkan sistem pencatatan resmi untuk setiap proses, nomor/identitas sumber, dan cara rekonsiliasi. Konektor langsung SIMSA–SRIKANDI adalah keputusan integrasi tersendiri; tidak identik dengan kewajiban instansi menggunakan SRIKANDI. Istilah “opsional” pada dokumentasi profil SIMSA harus dibaca dalam batas konektor produk tersebut.

## Kontrol yang sudah tersedia

| Area | Bukti implementasi | Batas bukti |
| --- | --- | --- |
| Surat, pemberkasan dan pencarian | Metadata surat/arsip, lokasi fisik, distribusi antarunit, pencarian, daftar dan template cetak. | Belum membuktikan format dan SOP sudah disahkan untuk unit pengguna. |
| Aturan dan retensi | Katalog klasifikasi/JRA berversi, hash sumber, snapshot aturan, pemicu retensi dengan verifikasi, penilaian kembali dan legal hold. | Pengesahan isi/mapping oleh arsiparis tetap diperlukan. |
| Akses | Role/unit, permohonan akses per rekod, tujuan, masa berlaku, pemisahan pemohon/penyetuju dan audit. | Mandat jabatan/clearance kelembagaan belum lengkap. |
| Berkas elektronik | Hash SHA-256, pemeriksaan ulang integritas, versi terverifikasi, penyimpanan privat, karantina dan worker antivirus. | Lingkungan lokal belum memiliki storage/scanner operasional; alur berkas belum terbukti pada target. |
| Penyerahan permanen | Modul tata kelola retensi memiliki manifest dan bukti terkendali, pemeriksaan ulang, pencatatan serah terima/penerimaan dengan pelaku berbeda. | Bukan bukti penyerahan nyata atau integrasi ANRI. |
| SRIKANDI | Antrean pengiriman transaksional, pencegahan duplikasi, retry, audit dan validasi pengakuan/ID balasan. | Payload masih profil SIMSA; belum ada bukti kontrak resmi dan uji bersama pengelola. |

Pengujian sebelumnya mencakup 1.622 tes backend, 235 tes frontend, build/lint, dan 32 langkah HTTP dengan PostgreSQL nyata. Detail dan batasnya ada pada [laporan kesiapan](KESIAPAN_PENGGUNA_2026-09-11.md). Kelulusan tes tidak menghilangkan temuan yang belum dicakup skenario uji.

## Perbaikan perilaku yang diprioritaskan

P1 berarti perlu diselesaikan sebelum fitur terkait dipakai untuk data operasional. Temuan ini berasal dari jalur kode yang diperiksa, bukan kejadian kehilangan data pengguna yang telah diamati.

### 1. P1 — Pemindahan menghalangi penyusutan berikutnya

`backend/src/services/penyusutan.service.ts:724` menetapkan `disposalStatus='executed'` untuk seluruh jenis batch, termasuk pemindahan. Batch tetap terhubung ke arsip. Pemeriksaan pada baris 371 menolak arsip dengan status selain aktif atau batch terisi; pencarian kandidat pada baris 1013 juga mensyaratkan aktif. Manifest penyerahan baru memiliki syarat serupa pada `backend/src/services/retention-governance.service.ts:1482`.

**Dampak:** setelah dipindahkan dari aktif ke inaktif, arsip tidak dapat melanjutkan proses musnah/serah melalui jalur normal. **Perbaikan:** pisahkan status proses batch dari siklus hidup arsip dan pertahankan riwayat tiap peristiwa. **Bukti selesai:** satu arsip dapat melalui aktif → pemindahan → inaktif → jatuh retensi → pemusnahan atau penyerahan tanpa perubahan database manual; legal hold tetap memblokir tindakan yang relevan.

### 2. P1 — Tanggal sumber impor dapat diganti dengan tanggal hari impor

`backend/src/services/migration.service.ts:109` membaca tanggal, tetapi baris 154 memakai tanggal hari ini bila hasil parsing kosong. Untuk surat yang memiliki nomor resmi, kondisi ini tidak ditolak seperti pada surat tanpa nomor.

**Dampak:** makna dan tahun dokumen historis dapat berubah tanpa koreksi eksplisit. **Perbaikan:** tolak atau tahan baris bermasalah untuk peninjauan, simpan nilai sumber, serta sediakan pratinjau dan hasil per baris. **Bukti selesai:** tanggal invalid/kosong tidak direka; impor ulang tidak menduplikasi rekod; jumlah dan sampel hasil cocok dengan sumber.

### 3. P1 untuk ekspor besar — Hasil dapat terpotong pada 10.000 baris

`backend/src/services/export.service.ts:42` dan `:223` meminta halaman pertama dengan batas 10.000, mengambil hanya `data`, lalu membuat workbook. Pola ini terdapat pada surat masuk, surat keluar, dan arsip.

**Dampak:** pengguna dapat mengira hasilnya merupakan daftar lengkap. **Perbaikan:** ekspor semua halaman yang berizin melalui pekerjaan bertahap, atau tampilkan batas dan cakupan secara eksplisit. **Bukti selesai:** dataset minimal 10.001 rekod menghasilkan semua rekod yang semestinya, tanpa duplikasi, kebocoran lintas unit, atau penggunaan memori tak terkendali.

### 4. P1 — Label “patuh” pelaporan arsip terjaga belum dibuktikan

`backend/src/services/arsip-terjaga.service.ts:301` menerima nomor dan tanggal laporan lalu menetapkan `statusKepatuhan='patuh'`. Route pada `backend/src/routes/arsip-terjaga.routes.ts:229` tidak mensyaratkan bukti pengiriman/penerimaan. Pencatatan designation terjaga juga belum dibaca langsung oleh pemeriksaan kandidat penyusutan.

**Perbaikan:** pisahkan status dicatat, dikirim, diterima, dan diverifikasi; kaitkan bukti terkendali dan pemeriksa berwenang. Tetapkan bersama arsiparis aturan perlindungan terjaga dan hubungkan ke transisi terkait. Jangan menyimpulkan semua arsip terjaga memiliki satu larangan penyusutan yang sama. **Bukti selesai:** nomor/tanggal saja tidak memberi label kepatuhan; bukti dan keputusan dapat ditelusuri; aturan perlindungan diuji pada kandidat dan eksekusi.

### 5. P1 — Status pelaksanaan pemusnahan belum mensyaratkan bukti lengkap

`backend/src/services/penyusutan.service.ts:594` menerima catatan/aktor, lalu transisi pada baris 703–735 mengubah status/tanggal. Belum ada syarat lampiran berita acara final, saksi, atau bukti tindakan pada media/objek dan salinannya. Template berita acara memang tersedia pada `backend/src/services/print-template.service.ts:475`; template cetak tidak membuktikan pelaksanaan.

**Perbaikan:** simpan keputusan, daftar terkunci, berita acara final, identitas pejabat/saksi, serta bukti pelaksanaan sesuai SOP dan kebijakan salinan/backup. Jangan menambahkan penghapusan otomatis hanya berdasarkan habis retensi. **Bukti selesai:** status final ditolak bila bukti kurang; pelaksanaan dapat direkonsiliasi; legal hold yang muncul kemudian diperiksa ulang. Modul penyerahan permanen yang lebih lengkap tetap dipertahankan.

## Penyempurnaan kontrol dan operasi

1. **Instrumen dan kewenangan resmi.** Seed klasifikasi/JRA sudah memiliki versi dan provenance; bukan sekadar data dummy. Namun aktivasi baseline memiliki pengecualian tanpa aktor pada `backend/src/services/regulatory-rule-set.service.ts:2040`. Rekonsiliasikan sumber, pemetaan, pemicu dan hasil akhir dengan aturan yang berlaku; simpan review serta keputusan arsiparis. Approver akses pada `backend/src/routes/record-access-grant.routes.ts:59` masih berbasis super-admin. Hubungkan kewenangan ke jabatan, unit, kelas data, delegasi dan masa mandat; admin teknis tidak otomatis menjadi pejabat pemberi izin.

2. **Dokumen digital dan pemulihan.** Konfigurasikan storage privat, scanner dan worker pada target. Uji berkas bersih, EICAR, scanner mati/restart, objek hilang, hash berbeda dan penolakan akses. Backup harus mencakup database **dan** byte lampiran; jalankan restore ke lingkungan terpisah, cocokkan jumlah/referensi/hash, serta ukur sasaran kehilangan data dan lama pemulihan. Rujukan operasional: `BACKUP_RECOVERY_STRATEGY.md:16`, `CLOUD_SQL_BACKUP_RECOVERY.md:14`.

3. **Preservasi dan pemantauan.** `backend/src/services/arsip-elektronik.service.ts:513` benar-benar memeriksa berkas untuk `integrity_check`; jenis kegiatan preservasi lain masih dicatat sebagai log. Tambahkan pemeriksaan integritas terjadwal, alert dan remediasi. Jika migrasi/konversi format menjadi lingkup, ikat hasil ke berkas asli, alat/versi, parameter, hash dan pemeriksaan mutu. Aktifkan pemantauan API, database, antrean scanner, backup, serta pemilik respons insiden; runbook bukan bukti bahwa alert sudah dikonfigurasi.

4. **Persetujuan, disposisi dan panduan pengguna.** Persetujuan surat sudah ada, tetapi `backend/src/services/approval.service.ts:439` dapat berakhir ketika penyetuju berikutnya tidak diberikan. Tetapkan jalur wajib sesuai SOP sebelum menilai kecukupannya. Distribusi antarunit sudah tersedia; penanggung jawab pribadi, tenggat, bukti tindak lanjut dan pengingat merupakan pengembangan lanjutan bila diperlukan. Selaraskan panduan provisioning dengan provider login dan mandat unit aktual. Uji penerimaan melibatkan petugas, pemeriksa, arsiparis dan administrator, bukan hanya akun super-admin.

## SRIKANDI dan tanda tangan elektronik

Producer pada `backend/src/services/srikandi-producer.service.ts:50`–124 baru mencakup pembuatan surat masuk/keluar dengan profil `simsa-record-v1`. HTTP adapter pada `backend/src/services/srikandi-http.adapter.ts:187` mengirim struktur generik. Belum ditemukan alur perubahan/status atau penerimaan balik yang membuktikan sinkronisasi lifecycle lengkap. Lingkungan uji sekarang menonaktifkan pengiriman.

Sebelum aktivasi diperlukan kontrak/izin resmi, pemetaan identitas organisasi dan arsip, aturan data yang boleh dipertukarkan, sandbox, pengujian retry tanpa duplikasi, dan rekonsiliasi. Kebutuhan arah serta jenis event harus mengikuti kontrak yang disepakati, bukan dibuat seolah API resmi telah diketahui. [Layanan SRIKANDI ANRI](https://www.anri.go.id/layanan-publik/layanan-srikandi) menyediakan pendampingan dan pembahasan teknis implementasi.

TTE BSrE/PSrE belum operasional: `backend/src/services/signature.service.ts:88` menolak signing dengan 501 dan verifikasi pada baris 109 tidak menyatakan valid. Persetujuan internal dan checksum tidak setara dengan TTE. Jika SIMSA hanya menyimpan arsip, dokumen final dapat berasal dari proses resmi yang ditetapkan, dengan pemeriksaan keaslian. Jika SIMSA diminta menerbitkan surat elektronik resmi, alur penandatanganan/verifikasi memerlukan lingkup dan layanan yang disetujui. Menambah editor surat/TTE bukan otomatis syarat bagi seluruh fungsi pengelolaan berkas internal.

## Urutan kerja yang disarankan

| Tahap | Pekerjaan | Syarat selesai |
| --- | --- | --- |
| 1 — Ketepatan data dan status | Perbaiki lima temuan perilaku; tambah regresi yang membuktikan alur dan skenario gagal; perbarui status dalam dokumentasi. | Tidak ada tanggal rekaan, ekspor diam-diam terpotong, siklus arsip terputus, atau klaim selesai/patuh tanpa bukti. |
| 2 — Pilot operasional terbatas | Validasi instrumen/mandat, tetapkan unit dan jenis data, deploy storage/scanner, restore drill, monitoring, migrasi uji dan UAT. | Bukti penerimaan ditandatangani pemilik proses; akun/akses, berkas, backup dan pemulihan bekerja pada lingkungan tujuan. |
| 3 — Pertukaran resmi sesuai mandat | Tetapkan batas SIMSA–SRIKANDI; selesaikan kontrak, pemetaan, sandbox dan rekonsiliasi; TTE hanya bila penerbitan surat termasuk lingkup. | Pengelola resmi menerima hasil uji dan mekanisme operasi/kegagalan disepakati. |

Kelima temuan baru masih terbuka. Penyelesaian tahap awal memperbaiki kesiapan teknis; keputusan kesesuaian kelembagaan tetap memerlukan penilaian Unit Kearsipan dan pihak berwenang terhadap bukti serta aturan yang berlaku.
