# Percobaan ClamAV sesuai permintaan

Project ini hanya menguji mesin ClamAV asli terhadap tiga fixture tetap: PDF buatan 1 KiB, PDF buatan tepat 10 MiB, dan string uji EICAR. Tidak ada koneksi database, penyimpanan arsip, input dokumen/URL, atau perubahan status malware SIMSA. Hasil POC tidak mengaktifkan unggah produksi.

## Pengaturan Vercel Preview

1. Buat project terpisah dari repository ini; **Root Directory `scripts/clamav-on-demand-poc`**, framework **Other**, Node.js **24.x**. Jangan salin variabel database, Blob, atau autentikasi aplikasi.
2. Gunakan `vercel.json` di direktori ini: Install Command `node --version`; Build Command `node build.mjs`; Output Directory tidak perlu ditentukan. Build harus berjalan pada Linux x64. `tar` dan `gpg`/`gpg2` harus tersedia; build berhenti bila alat atau verifikasi gagal.
3. Tetapkan variabel nonrahasia **`SIMSA_CLAMAV_POC_ENABLED=1` hanya untuk Preview**. `VERCEL_ENV` berasal dari Vercel; jangan membuat override. Endpoint menolak Production. Deploy branch percobaan sebagai Preview.
4. Sebelum membuka atau menjalankan uji, pastikan **Deployment Protection: Vercel Authentication** aktif pada Preview di dashboard, dan permintaan anonim ditolak oleh Vercel. Kode POC tidak dapat membuktikan setting platform itu sendiri. Jangan gunakan bypass token publik.
5. Buka deployment yang terlindungi melalui browser yang sudah masuk ke Vercel. Klik **Jalankan tiga uji sintetis**. Form melakukan POST kosong pada origin yang sama; hasil teks JSON bisa dibaca langsung. Tidak perlu membuka konsol, mengirim cookie, atau memasukkan file.

Fluid Compute aktif; Hobby memakai memori 2 GB/1 vCPU dari platform. Batas function 300 detik, seluruh rangkaian scan 240 detik. Proses scan berurutan, satu rangkaian per instance; ini belum merupakan pembatas global lintas instance untuk produksi.

## Verifikasi build dan ukuran

Build mengunduh paket Linux resmi ClamAV **1.5.4**, SHA256 `28d6efc5b4423e7830c3559339552eb53870a9eac51ac4efb37d60530d329886`. File `.sig` diverifikasi GPG dengan fingerprint utama Talos **`5BADCA2665EF59DCF8A23D8B707F0DB480836771`**, yang dicocokkan terhadap kunci publik pada halaman unduhan resmi. Paket dan signature tersebut sudah diunduh dan verifikasi GPG nyata berhasil pada workstation; ini belum membuktikan scan Linux.

Paket diekstrak ke direktori sementara tanpa instalasi sistem. Freshclam mengambil `main`, `daily`, dan `bytecode` dari layanan resmi, dengan `TestDatabases yes` dan `FIPSCryptoHashLimits yes`. Ketiga `.cvd.sign` wajib tersedia; `sigtool --info --fips-limits` juga harus berhasil. Tidak ada fallback tanpa tanda tangan. Tidak memakai `curl` untuk menghindari pembatas CDN atau mirror pihak ketiga.

Hanya executable, shared libraries, sertifikat CVD, dan database dimasukkan ke `vendor/` yang diabaikan Git. Manifest mencatat hash/ukuran basis tanda tangan dan saat verifikasi. Runtime menolak build lebih tua dari 24 jam; percobaan perlu build baru sesudah itu. Ini belum merupakan mekanisme pembaruan basis tanda tangan produksi.

Build melaporkan ukuran bundle. Jika lebih dari 240 MiB, build berhenti kecuali operator sengaja memilih `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`; kelayakan Large Functions beta dan kuota akun harus dicek dahulu. Memori tidak dikonfigurasi lewat `vercel.json` karena Fluid menggunakan pengaturan platform.

## Bukti yang harus diambil

Jalankan satu kali pada instance dingin lalu sekali lagi pada instance hangat. Simpan hasil JSON tanpa mengubahnya: tiga scan harus lulus, clean harus exit 0 dan benar-benar memindai satu file; EICAR harus exit 1 dengan deteksi EICAR. Error, limit, timeout, atau proses yang dihentikan tidak dihitung bersih. Ukur `elapsedMs`, ruang `/tmp`, dan RSS proses. Sampling `/proc` setiap 25 ms memberi perkiraan RSS, bukan pengukuran lengkap cgroup; puncak singkat bisa terlewat. Batas konservatif gabungan RSS parent+child adalah 1800 MiB.

Perintah unit test tanpa scanner: `node --test poc.test.mjs`. Perintah Linux setelah build: `node probe.mjs`. Keduanya berbeda: unit test yang lulus tidak menyatakan ClamAV atau Freshclam sudah berjalan.

Sebelum integrasi produksi perlu bukti scan Linux nyata, hasil dingin/hangat, pembaruan definisi yang dapat dipulihkan, job/lease/CAS yang awet, pemeriksaan hash file yang sama, autentikasi worker, serta penanganan kegagalan yang mempertahankan karantina. File 10 MiB harus diunggah langsung ke penyimpanan privat; batas payload Vercel Function 4.5 MB tidak cukup untuk multipart 10 MiB.

Sumber resmi: [paket dan kunci ClamAV](https://www.clamav.net/download), [Freshclam](https://docs.clamav.net/manual/Usage/SignatureManagement.html), [ClamAV 1.5 dan CVD signing](https://blog.clamav.net/2025/10/clamav-150-released.html), [batas Vercel Functions](https://vercel.com/docs/functions/limitations), [memori Fluid](https://vercel.com/docs/functions/configuring-functions/memory).
