-- 0048 (P5): pengerasan rangkaian. Hanya dijalankan setelah backfill langkah 1 P3
-- (`npm run db:backfill:rangkaian-disposisi`) melaporkan sisaTanpaRangkaian: 0 dan daftar
-- `dilewati` (P3 C-6) kosong atau sudah diputuskan. Catatan: migrasi yang MENAMBAH kolom
-- rangkaian_surat wajib CREATE OR REPLACE FUNCTION rangkaian_guard_status() (RB P1 butir 4).
-- Bila daftar `dilewati` tidak kosong, migrasi ini DITAHAN (gerbang rilis f); tidak ada
-- prelude yang mematikan trigger surat_distributions_closed_guard.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM surat_distributions WHERE rangkaian_id IS NULL) THEN
    RAISE EXCEPTION '0048: surat_distributions.rangkaian_id masih NULL; jalankan npm run db:backfill:rangkaian-disposisi dan selesaikan daftar dilewati (rangkaian diberkaskan) dulu';
  END IF;
  IF EXISTS (SELECT 1 FROM rangkaian_koreksi_berkas WHERE status IN ('pending', 'approved')
             GROUP BY rangkaian_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION '0048: lebih dari satu Koreksi Berkas terbuka per rangkaian, rekonsiliasi dulu';
  END IF;
  IF EXISTS (SELECT 1 FROM rangkaian_koreksi_berkas
             WHERE (status = 'pending') <> (diputuskan_by IS NULL)
                OR (diputuskan_by IS NULL) <> (diputuskan_at IS NULL)
                OR (unit_pengolah_baru = unit_pengolah_lama AND klasifikasi_baru = klasifikasi_lama)) THEN
    RAISE EXCEPTION '0048: baris rangkaian_koreksi_berkas tidak konsisten, rekonsiliasi dulu';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE surat_distributions ALTER COLUMN rangkaian_id SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX rangkaian_koreksi_berkas_terbuka_uidx
  ON rangkaian_koreksi_berkas (rangkaian_id) WHERE status IN ('pending', 'approved');
--> statement-breakpoint
ALTER TABLE rangkaian_koreksi_berkas
  ADD CONSTRAINT rangkaian_koreksi_berkas_putusan_check
    CHECK ((status = 'pending') = (diputuskan_by IS NULL)
       AND (diputuskan_by IS NULL) = (diputuskan_at IS NULL)),
  ADD CONSTRAINT rangkaian_koreksi_berkas_berubah_check
    CHECK (unit_pengolah_baru <> unit_pengolah_lama OR klasifikasi_baru <> klasifikasi_lama);
