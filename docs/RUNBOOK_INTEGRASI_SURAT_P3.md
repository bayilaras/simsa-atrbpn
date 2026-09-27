# Runbook Deploy P3: Integrasi Surat Masuk-Keluar (Rangkaian)

Runbook ini mengatur migrasi data dan urutan deploy untuk P3 (rangkaian
surat, disposisi eksplisit). Ikuti urutan di bawah persis; jangan
melompati langkah verifikasi.

## 1. Pre-flight

1. **Backup** basis data produksi sebelum langkah apa pun di bawah ini.
2. Bila P2 belum melakukannya, jalankan kueri FRa berikut dan rekonsiliasi
   setiap baris yang muncul sebelum melanjutkan:

   ```sql
   SELECT count(*) FROM arsip
   WHERE trim(klasifikasi_keamanan) = '' AND klasifikasi_keamanan <> '';
   ```

3. Konfirmasi bahwa flag `RANGKAIAN_AJUKAN_AKSES` **tidak** diset (unset),
   bukan `false` secara eksplisit — hanya string `true` yang menyalakannya.
4. **[C-10] Disposisi terbuka pada surat kelas terkendali.** Jalankan
   kueri berikut dengan role baca-saja:

   ```sql
   SELECT lower(regexp_replace(btrim(sm.sifat_surat), '[[:space:]-]+', '_', 'g')) AS kelas, d.status, count(*)
     FROM surat_distributions d JOIN surat_masuk sm ON sm.id = d.surat_masuk_id
    WHERE d.status IN ('sent', 'received') AND sm.is_deleted IS NOT TRUE
    GROUP BY 1, 2 ORDER BY 1, 2;
   ```

   Jika ada baris dengan `kelas IN ('terbatas','rahasia','sangat_rahasia')`,
   **tahan deploy** sampai salah satu keputusan berikut dicatat (tertulis)
   di hasil menjalankan runbook ini:
   - (i) sign-off keamanan diperoleh, lalu `RANGKAIAN_AJUKAN_AKSES`
     dinyalakan segera setelah deploy;
   - (ii) TU/pengawas menutup (Tutup) atau menerbitkan ulang disposisi
     tersebut sebelum atau segera setelah deploy;
   - (iii) diterima bahwa target akan menolaknya (Tolak).

   Catatan rilis untuk TU: "selama flag Ajukan Akses mati, surat
   Terbatas/Rahasia tidak dapat didisposisikan (409)."

## 2. Urutan

```
npm run db:migrate
npm run db:grants:converge      # tidak ada migrasi baru di P3
npm run db:backfill:rangkaian-disposisi
# --- deploy kode P3 ---
npm run db:backfill:rangkaian-disposisi   # dijalankan LAGI, segera setelah deploy
```

Penulis P2 (`POST /api/distributions`, lihat `distribution.routes.ts:206-213`)
masih aktif sampai kode P3 benar-benar live, sehingga baris
`surat_distributions` baru dengan `rangkaian_id` NULL bisa tetap tercipta
selama jendela deploy. Karena itu skrip backfill (idempoten) dijalankan
lagi persis setelah deploy P3, bukan hanya sekali sebelum deploy. [T2-2]

## 3. Kriteria keluar (diverifikasi SESUDAH deploy)

Skrip backfill kedua (langkah 2, setelah deploy) harus melapor:
- `sisaTanpaRangkaian: 0`
- `dilewati` kosong (`[]`) — bila tidak kosong, setiap surat yang
  tercantum adalah anggota rangkaian yang sudah `diberkaskan`/`digabung`;
  putuskan secara manual per baris sebelum menganggap migrasi selesai. [C-6]

Dan secara independen:

```sql
SELECT count(*) FROM surat_distributions WHERE rangkaian_id IS NULL;
-- harus 0
```

## 4. Peran

Jalankan skrip backfill sebagai role runtime `simsa_api` lewat
`NEON_RUNTIME_DATABASE_URL`, memakai pola prompt tersembunyi
`docs/RUNBOOK_INTEGRASI_SURAT_P1.md:7-27`. Role itu sudah memegang grant
yang diperlukan (`backend/src/db/grants/0002_converge_application_grants.sql`).
**Jangan** memakai role maintenance terpisah — itu mengubah hash
grants/0002 dan pin Neon. [T2-3]

## 5. Flag

`RANGKAIAN_AJUKAN_AKSES` tetap mati sampai sign-off keamanan (lihat §1.4
dan gerbang rilis C-12).

## 6. Rollback

Redeploy P2. Data rangkaian P3 tetap dapat dibaca oleh kode P2 (kolom
`rangkaian_id` di `surat_distributions` diabaikan oleh P2, tabel
`rangkaian_*` tidak dihapus).
