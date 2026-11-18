# Hasil rilis frontend C73: dialog dan form responsif, 17 November 2026

Lanjutan `HASIL_RILIS_C79_C72_2026-11-16.md`. Semua waktu dalam UTC (WIB = UTC+7).

Rilis ini hanya membawa frontend dari `main` `4208b98`, yaitu PR #183. Backend tetap C79. Di antara `d9dff53` dan `4208b98`, satu-satunya berkas backend yang berubah adalah `backend/vitest.config.ts`, yang hanya dipakai pengujian. Tidak ada migrasi, perubahan env, atau kredensial yang dicatat.

## Isi rilis

**PR #183** memperbaiki tata letak dialog dan form yang terpotong atau bertumpuk pada layar laptop (lebar sekitar 1.365 px) dan layar sempit. Laporan awalnya datang dari dialog Registrasi Arsip Elektronik Terkendali. PR ini mengubah 27 berkas frontend.

- **Pilihan (`Select`)** kini selebar kolomnya, dan teks panjang dipotong di dalam kotak. Sebelumnya lebar kotak mengikuti isinya.
- **Lebar dialog:** lebar yang diminta setiap dialog kini berlaku di layar lebar. Sebelumnya lebar itu diam-diam dibatasi oleh lebar bawaan.
- **Isi dialog** tersusun satu kolom di layar sempit.
- **Footer dialog panjang** (`<DialogFooter sticky>`) menempel di bagian bawah, sehingga tombol simpan tetap terlihat saat isi digulir.
- **Grid form** di halaman dan dialog lain diselaraskan dengan pola yang sama.

**PR #184** (hanya CI, tidak ikut ke produksi) menambahkan pengecualian sementara untuk advisori GHSA-fc5q-39xc-vjpf pada `picomatch`, berlaku sampai 2026-12-02. Belum ada versi perbaikan dari upstream, dan paket ini hanya dipakai alat build dan uji. Tanpa pengecualian ini, cek wajib Security Audit memblokir semua PR, termasuk #183. Tes allowlist kini menerima entri backend hanya untuk paket yang di lockfile bertanda `dev`/`devOptional`.

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge #184 | Disetujui efanwahyu, semua cek hijau, lalu digabungkan sebagai `a61277d` | 22:17:46 |
| Merge #183 | Disetujui efanwahyu. Branch diperbarui dengan "Update branch" setelah #184 masuk, lalu auto-merge sebagai `4208b98`. Tree `4208b98` identik dengan head PR `012317c` yang lulus semua cek. CI `push` `44191099362` sukses | 22:32:47 |
| Sumber rilis | `release-source.mjs prepare` pada `4208b98`: 1.668 berkas, manifest `97f1a80a432637a34342275eae00c162f67ad66e0ab341c4d39d2fb1b7fb0b1b`, 55 migrasi (tidak ada yang baru) | ±22:34 |
| Target rollback | C72 `dpl_6cJJrxcoRKPh4ctbWmkAa1CweFAV`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±22:34 |
| Kandidat frontend C73 | `dpl_8rDZuG6MkgoojnZodxmYM7HQi7HR` Ready. Verifikasi sumber lulus: lint, 246 berkas uji (1.699 uji). Precache 159 entri (2.776,24 KiB) | 22:35–22:43 |
| Promosi frontend C73 | Sukses. Alias produksi menunjuk `dpl_8rDZuG6MkgoojnZodxmYM7HQi7HR` | 22:43:45 |
| Uji asap | `release-smoke.mjs frontend` 7/7, termasuk bundel `index-CrIMpTKr.js`, `/ready` 200 `ready` lewat proxy, dan `/api` menjawab 401 tanpa sesi. `release-smoke.mjs backend` tetap lulus | ±22:44 |

## Pemeriksaan setelah promosi

- **Bundel produksi** memuat kelas footer dialog yang baru (`sticky -bottom-6 …`), jadi kode #183 sudah aktif.
- **Belum diperiksa:** tampilan dialog belum dilihat langsung dengan akun yang masuk. Pemeriksaan visual sebelum merge dilakukan pada server lokal dengan API tiruan di beberapa lebar layar.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_3auuJCLJqATaW9mXGq4emVJxbbQG` (C79) | `main` `d9dff53` | tidak berubah |
| Frontend | `dpl_8rDZuG6MkgoojnZodxmYM7HQi7HR` (C73) | `main` `4208b98` | C72 `dpl_6cJJrxcoRKPh4ctbWmkAa1CweFAV` |
| Situs panduan | `dpl_C87rrBV7qre51aQnNLgUgD3b5hCW` | `main` `a715742` (halaman privasi backup Google Drive, PR #182) | tidak berubah oleh rilis ini |

Rollback cukup dengan mempromosikan kembali C72 dari folder yang tertaut ke project frontend. Skema database dan env produksi tidak berubah.

## Tindak lanjut

- Sebelum 2026-12-02, periksa apakah `picomatch` sudah punya versi perbaikan. Bila sudah, naikkan versinya dan hapus entri allowlist. Bila belum, putuskan perpanjangan sebelum CI gagal pada tanggal itu.
