# Hasil rilis frontend C57 — migrasi Vite 8, 25 Oktober 2026

Lanjutan `HASIL_RILIS_C59_C56_2026-10-25.md`. Rilis ini hanya menyangkut frontend; backend tetap C59. Semua waktu dalam UTC (WIB = UTC+7). Kredensial tidak dicatat.

## Isi rilis (`main` `95cc5ee`)

Empat PR di-merge hari ini. Masing-masing disetujui efanwahyu pada head terakhir dan CI-nya hijau 9/9.

| PR | Merge | Isi | Dampak runtime |
|---|---|---|---|
| #76 | `68e10ea` 12:46:57 | `"dependabot/**": false` di `git.deploymentEnabled` untuk `vercel.json` (simsa-atrbpn), `docs-site/vercel.json`, dan `scripts/clamav-on-demand-poc/vercel.json`, ditambah test | Tidak ada |
| #75 | `c81b563` 13:39:47 | docs-site: override `tinypool ^2.2.0`; allowlist audit dikosongkan (advisori braces GHSA-vfj7 ditarik GitHub 23 Okt) | Tidak ada |
| #74 | `3702be4` 13:54:58 | Laporan rilis C59/C56 | Tidak ada |
| #64 | `95cc5ee` 14:10:20 | Frontend: `@vitejs/plugin-react` 6.1.2, **vite 7.3.7 → 8.3.5** (Rolldown), vite-plugin-pwa 1.3.0, tailwindcss 4.3.3; `manualChunks` diganti `build.rolldownOptions.output.codeSplitting.groups` (empat chunk vendor tetap); `vitest.config.ts` memakai `import.meta.dirname` | Bundel frontend |

Antara `9a5f7d5` (sumber C59/C56) dan `95cc5ee` tidak ada perubahan di `backend/`. Migrasi tetap 52 (terakhir `0051_surat_keluar_sifat`), dan tidak ada perubahan grant atau env.

## Gladi lokal bundel produksi (14:15–14:30)

Kandidat produksi tidak bisa dipakai untuk login karena backend hanya memercayai `FRONTEND_URL`. Karena itu bundel produksi Vite 8 diuji secara lokal: worktree terlepas `95cc5ee`, lalu `npm ci` dan `vite build`. Bundel disajikan dengan `vite preview` di 127.0.0.1:3000 (proxy `/api`) dan memakai backend lokal di 127.0.0.1:3001 (`/ready` ready), dengan PostgreSQL 18 lokal berisi data uji.

| Uji | Hasil |
|---|---|
| Sesi `tester@simsa.local` (super_admin) | Aktif; `get-session` mengembalikan peran yang benar |
| 21 halaman lewat navigasi SPA (dashboard, surat masuk/keluar/inisiatif/tambah, lacak, arsip, distribusi, laporan, pengguna, monitoring, audit log, klasifikasi, JRA, pengaturan, panduan, unggah massal, dosir, peminjaman, arsip vital, penyusutan) | Semua chunk termuat dan judul halaman tampil; tidak ada galat JavaScript, tidak ada `before initialization`, tidak ada penolakan promise |
| Detail surat keluar | Dirender |
| Laporan (pilih Direktorat BPPT) | Grafik recharts dirender |
| Dropdown Radix (unit kerja) | 6 opsi muncul |
| `/bulk-upload` (kapabilitas berkas dipaksa aktif di tab karena lokal tanpa Blob), reduced-motion mati | Panel unggah framer-motion selesai beranimasi (`opacity: 1; transform: none`) |
| Service worker | `sw.js` dan `workbox-*.js` lolos `node --check`, strukturnya sama dengan `sw.js` produksi (Workbox `generateSW`). Registrasi gagal hanya di panel browser lokal, padahal `fetch('/sw.js')` 200; di produksi terbukti aktif (lihat di bawah) |

Hash chunk vendor build lokal identik dengan build Vercel, contohnya `vendor-react-DU-teErA.js`.

## Ringkasan langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Sumber rilis | `release-source.mjs prepare --commit 95cc5ee1835386ad25f9624a81729823d87a9c23`: 1.698 file, manifest `fb7657da34d08c7e67e6e06c6998a45ca26939dc5d1a80021c7ac8b9166ec8a8`, arsip `5e559d9b…9a2a`; `verify` lulus | 14:15 |
| Kandidat frontend C57 | `dpl_CZPFqWHK2zAtUQ9ekG9n1umTz6oz`; `npm ci` di `source/frontend` lebih dulu; lint dan 155 berkas / 1.128 test lulus; `SIMSA candidate frontend: source checks passed`; build 8 menit | 14:21–14:29:43 |
| Promosi frontend | Sukses | 14:30:57 |

## Smoke setelah promosi

- Alias `simsa-frontend.vercel.app` → `dpl_CZPFqWHK2zAtUQ9ekG9n1umTz6oz`; `simsa-backend.vercel.app` tetap `dpl_B1D7qG3KhoLiS3tGsohR8BreVpXq` (C59).
- Frontend `/`, `/login`, `/surat/keluar`, `/bulk-upload`, `/laporan`, dan `/sw.js` 200. `/ready`, `/health`, `/api/capabilities`, dan `/api/auth/get-session` lewat proxy 200. `/api/surat-keluar` tanpa sesi 401. `x-vercel-id` `sin1`, CSP tetap terpasang.
- HTML produksi memuat `assets/index-C_m11hNu.js`. Tab yang masih memakai C56 dari cache memasang service worker baru, memuat ulang otomatis, lalu menjalankan bundel C57. Halaman login (form email/kata sandi dan "Masuk dengan Google") tampil tanpa galat konsol baru.
- 0 galat runtime frontend dan backend dalam 30 menit setelah promosi.
- Login sungguhan dengan akun produksi setelah C57 dilakukan oleh pengguna.

## Efek PR #76 pada kuota

Push `bd37a44` ke branch Dependabot #64 (setelah #76 masuk `main`) hanya membuat deployment simsa-frontend dan simsa-backend; simsa-atrbpn dan simsa-antivirus-probe tidak lagi membuat deployment. Total deployment tim sejak 25 Okt 03:00 sampai rilis ini adalah 37, termasuk kandidat C57.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_B1D7qG3KhoLiS3tGsohR8BreVpXq` (C59, `sin1`) | `main` `9a5f7d5` | C58 `dpl_6bjFHG626TtVS4p2cTS1YGC6CRAU` |
| Frontend | `dpl_CZPFqWHK2zAtUQ9ekG9n1umTz6oz` (C57) | `main` `95cc5ee` | C56 `dpl_5oWJqU8aUPedky7E6cNXDvYCffnN` |

Rilis ini tidak mengubah API, jadi rollback frontend ke C56 bisa dilakukan sendiri tanpa menyentuh backend.

## Sisa

- Login produksi dengan akun sungguhan setelah C57, oleh pengguna.
- Kuota Vercel: simsa-antivirus-probe masih membuat deployment produksi untuk setiap merge ke `main`, dan simsa-frontend masih membuat build `main` yang langsung CANCELED (`git.deploymentEnabled` di `frontend/vercel.mjs` tidak dihormati saat pemicuan).
- PR #10 (`codex/spark-reliability-recovery`) masih terbuka dari sebelumnya; tidak termasuk rilis ini.
