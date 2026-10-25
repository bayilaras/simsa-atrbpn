# Deployment UX Arsip — 13 September 2026

Pembaruan frontend aktif di https://simsa-frontend.vercel.app sejak **09:29:09 WIB**, 13 September 2026. Promosi memakai deployment produksi yang telah dibangun dan diuji, melalui `vercel promote`.

| Identitas | Nilai |
| --- | --- |
| Frontend baru | `dpl_6GuxkzC6mY3B6CEXPXB24JdJDo2o` |
| URL tetap deployment | https://simsa-frontend-qeacnpbho-bayilaras-projects.vercel.app |
| Manifest sumber SHA-256 | `f54d7d5f0c7050afb34dd4c73c25faf863ab75085f4eb12090a15b9942e21f2d` |
| Snapshot sumber | `output/archive-deployment-20260913/release-KauMMn/source` |
| Frontend sebelumnya / rollback | `dpl_aw3g2Dsrh73KEFCuUKzsCux9ctyy` |
| Backend yang dipertahankan | `dpl_4FWzGVK2UgJmsXjMAJ7kzZ7k1vbd` |

Rilis membawa query pencarian/filter/paginasi di URL, filter tersimpan per pengguna di browser, panel pratinjau dokumen sumber, status pemuatan/kegagalan dan retry, serta penyesuaian tabel dan tampilan ponsel. Rincian implementasi tercatat dalam `docs/PENERAPAN_UX_ARSIP_2026-09-13.md`.

Sumber dibuat dari snapshot frontend produksi sebelumnya dengan 12 berkas delta yang dipilih secara eksplisit. Seluruh **1.301 hash berkas** cocok sebelum promosi. Pekerjaan lokal lain tidak dimasukkan. Konfigurasi proxy identik dengan produksi sebelumnya, menggunakan backend tetap yang sama. Tidak ada deployment backend, migrasi database, unggahan baru, atau perubahan arsip dalam kegiatan ini.

## Validasi

- Vercel Linux / Node 24: lint seluruh frontend lulus; **78 berkas tes, 512 tes lulus**; build Vite dan PWA lulus. Pemeriksaan tes dijalankan tanpa kredensial deployment. Instalasi melaporkan nol kerentanan.
- Pemeriksaan kandidat: halaman utama dan kedua halaman arsip, health/readiness, serta penolakan akses daftar arsip anonim: **6/6 lulus**. Kedua domain utama tetap menggunakan deployment sebelumnya sebelum promosi.
- Pemeriksaan produksi sebelum dan setelah promosi: masing-masing **42/42 lulus**. Pemeriksaan sesudah promosi selesai 09:30:37 WIB, melalui 29 permintaan aplikasi. Identitas alias, health/readiness, daftar arsip, login/logout, pembatalan sesi lama, dan PDF privat 10.000.000 byte dalam mode inline/unduh beserta SHA-256 terverifikasi.
- Browser produksi: login, kontrol fitur baru, pencarian/tahun/jumlah baris di URL, simpan/terapkan/hapus filter, serta perpindahan tab dengan filter tetap terisi berhasil. Pada viewport 320 piksel, lebar dokumen dan body 305 piksel: tidak ada overflow horizontal. Tidak ada error konsol yang tercatat. Filter uji dihapus dan ukuran viewport dipulihkan.

Kandidat pertama berhenti pada gerbang tes dan tidak dipromosikan. Dua tes lama mengasumsikan satu status pemuatan dan role `textbox`; indikator daftar baru menambah status kedua dan input `type="search"` menggunakan role `searchbox`. Dua selector tes diperbaiki tanpa mengubah kode fitur; 20/20 tes terkait lulus lokal, kemudian seluruh 512 tes lulus di kandidat kedua. Bukti percobaan pertama disimpan di `output/archive-deployment-20260913/attempt-1`.

Daftar arsip produksi masih kosong saat pemeriksaan browser. Panel pratinjau dengan baris arsip tercakup tes komponen dan fixture lokal sebelumnya; smoke produksi memverifikasi jalur PDF privat surat yang sudah tersedia. Tidak dibuat arsip tambahan untuk pengujian.

Tab PWA yang sudah terbuka sempat memakai bundle sebelumnya. Satu muat ulang normal menampilkan versi baru; pengguna dengan tab lama dapat memuat ulang halaman.

## Bukti dan rollback

- `output/archive-deployment-20260913/frontend-build-verification.json` dan `frontend-build.log`
- `output/archive-deployment-20260913/promotion-preflight.json`, `promotion.log`, dan `promoted.json`
- `output/archive-deployment-20260913/http-smoke/promoted-1789266637903-9628cc2a.json`
- `output/archive-deployment-20260913/browser-mobile.png` dan `browser-verification.json`

Jika pemulihan diperlukan, gunakan project frontend yang sama dan promosikan deployment sebelumnya:

```powershell
vercel promote dpl_aw3g2Dsrh73KEFCuUKzsCux9ctyy --yes --scope bayilaras-projects --cwd "D:\Projects\New folder\simsa-atrbpn\output\archive-deployment-20260913\cli-frontend"
```

Periksa kembali alias utama dan jalankan pemeriksaan layanan setelah rollback. Perintah rollback ini **belum dijalankan**.
