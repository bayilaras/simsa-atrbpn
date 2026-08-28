-- A surat UUID is polymorphic: it belongs to surat_masuk or surat_keluar
-- according to arsip.jenis_arsip. Reconcile bad legacy links explicitly rather
-- than deleting or silently rewriting archival evidence during deployment.
DO $$
DECLARE
    duplicate_link text;
    invalid_archive uuid;
BEGIN
    SELECT format('%s/%s (%s rows)', jenis_arsip, source_surat_id, count(*))
    INTO duplicate_link
    FROM arsip
    WHERE source_surat_id IS NOT NULL
    GROUP BY jenis_arsip, source_surat_id
    HAVING count(*) > 1
    LIMIT 1;

    IF duplicate_link IS NOT NULL THEN
        RAISE EXCEPTION 'Duplicate surat-to-arsip link % must be reconciled before migration 0021', duplicate_link
            USING ERRCODE = '23505';
    END IF;

    WITH source_rows AS (
        SELECT
            'masuk'::text AS jenis_arsip,
            id,
            unit_kerja_id,
            tahun,
            nomor_surat,
            tanggal_surat,
            perihal,
            klasifikasi_kode AS klasifikasi_1,
            NULL::varchar AS klasifikasi_2
        FROM surat_masuk
        UNION ALL
        SELECT
            'keluar'::text,
            id,
            unit_kerja_id,
            tahun,
            nomor_surat,
            tanggal_surat,
            perihal,
            klasifikasi_fasilitatif_kode,
            klasifikasi_substantif_kode
        FROM surat_keluar
    )
    SELECT a.id
    INTO invalid_archive
    FROM arsip a
    LEFT JOIN source_rows s
      ON s.jenis_arsip = a.jenis_arsip
     AND s.id = a.source_surat_id
    WHERE a.source_surat_id IS NOT NULL
      AND (
          a.jenis_arsip NOT IN ('masuk', 'keluar')
          OR s.id IS NULL
          OR a.unit_kerja_id IS DISTINCT FROM s.unit_kerja_id
          OR a.tahun IS DISTINCT FROM s.tahun
          OR a.nomor_surat_original IS DISTINCT FROM s.nomor_surat
          OR a.tanggal_surat_original IS DISTINCT FROM s.tanggal_surat
          OR a.perihal_original IS DISTINCT FROM s.perihal
          OR (
              (NULLIF(trim(s.klasifikasi_1), '') IS NOT NULL
               OR NULLIF(trim(s.klasifikasi_2), '') IS NOT NULL)
              AND a.kode_klasifikasi IS DISTINCT FROM NULLIF(trim(s.klasifikasi_1), '')
              AND a.kode_klasifikasi IS DISTINCT FROM NULLIF(trim(s.klasifikasi_2), '')
          )
      )
    LIMIT 1;

    IF invalid_archive IS NOT NULL THEN
        RAISE EXCEPTION 'Archive % has an invalid polymorphic source or source metadata; reconcile it before migration 0021', invalid_archive
            USING ERRCODE = '23514';
    END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "arsip_source_surat_kind_unique"
    ON "arsip" ("jenis_arsip", "source_surat_id")
    WHERE "source_surat_id" IS NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'arsip_source_surat_kind_check'
          AND conrelid = 'public.arsip'::regclass
    ) THEN
        ALTER TABLE "arsip"
            ADD CONSTRAINT "arsip_source_surat_kind_check"
            CHECK ("source_surat_id" IS NULL OR "jenis_arsip" IN ('masuk', 'keluar'));
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_arsip_source_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    source_row record;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.source_surat_id IS NOT NULL THEN
            RAISE EXCEPTION 'A source-linked archive cannot be deleted; use an audited archival reconciliation workflow'
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.source_surat_id IS NOT NULL
       AND (
           NEW.source_surat_id IS DISTINCT FROM OLD.source_surat_id
           OR NEW.jenis_arsip IS DISTINCT FROM OLD.jenis_arsip
       ) THEN
        RAISE EXCEPTION 'Archive source linkage is immutable; use an audited archival reconciliation workflow'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.source_surat_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.jenis_arsip = 'masuk' THEN
        SELECT
            id,
            unit_kerja_id,
            tahun,
            nomor_surat,
            tanggal_surat,
            perihal,
            klasifikasi_kode AS klasifikasi_1,
            NULL::varchar AS klasifikasi_2
        INTO source_row
        FROM surat_masuk
        WHERE id = NEW.source_surat_id;
    ELSIF NEW.jenis_arsip = 'keluar' THEN
        SELECT
            id,
            unit_kerja_id,
            tahun,
            nomor_surat,
            tanggal_surat,
            perihal,
            klasifikasi_fasilitatif_kode AS klasifikasi_1,
            klasifikasi_substantif_kode AS klasifikasi_2
        INTO source_row
        FROM surat_keluar
        WHERE id = NEW.source_surat_id;
    ELSE
        RAISE EXCEPTION 'A linked archive must have jenis_arsip masuk or keluar'
            USING ERRCODE = '23514';
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source % % does not exist', NEW.jenis_arsip, NEW.source_surat_id
            USING ERRCODE = '23503';
    END IF;

    IF NEW.unit_kerja_id IS DISTINCT FROM source_row.unit_kerja_id
       OR NEW.tahun IS DISTINCT FROM source_row.tahun
       OR NEW.nomor_surat_original IS DISTINCT FROM source_row.nomor_surat
       OR NEW.tanggal_surat_original IS DISTINCT FROM source_row.tanggal_surat
       OR NEW.perihal_original IS DISTINCT FROM source_row.perihal THEN
        RAISE EXCEPTION 'Archive source metadata does not match % %', NEW.jenis_arsip, NEW.source_surat_id
            USING ERRCODE = '23514';
    END IF;

    IF (NULLIF(trim(source_row.klasifikasi_1), '') IS NOT NULL
        OR NULLIF(trim(source_row.klasifikasi_2), '') IS NOT NULL)
       AND NEW.kode_klasifikasi IS DISTINCT FROM NULLIF(trim(source_row.klasifikasi_1), '')
       AND NEW.kode_klasifikasi IS DISTINCT FROM NULLIF(trim(source_row.klasifikasi_2), '') THEN
        RAISE EXCEPTION 'Archive classification does not match source % %', NEW.jenis_arsip, NEW.source_surat_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_archived_surat_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    source_kind text;
    linked_archive arsip%ROWTYPE;
    klasifikasi_1 text;
    klasifikasi_2 text;
BEGIN
    source_kind := CASE TG_TABLE_NAME
        WHEN 'surat_masuk' THEN 'masuk'
        WHEN 'surat_keluar' THEN 'keluar'
        ELSE NULL
    END;

    SELECT a.*
    INTO linked_archive
    FROM arsip a
    WHERE a.jenis_arsip = source_kind
      AND a.source_surat_id = OLD.id
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Cannot delete % % while archive % references it', source_kind, OLD.id, linked_archive.id
            USING ERRCODE = '23503';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.is_archived IS DISTINCT FROM true
       OR NEW.is_deleted IS TRUE THEN
        RAISE EXCEPTION 'Archived source % % cannot be detached, deleted, or re-keyed', source_kind, OLD.id
            USING ERRCODE = '23514';
    END IF;

    IF source_kind = 'masuk' THEN
        klasifikasi_1 := NEW.klasifikasi_kode;
        klasifikasi_2 := NULL;
    ELSE
        klasifikasi_1 := NEW.klasifikasi_fasilitatif_kode;
        klasifikasi_2 := NEW.klasifikasi_substantif_kode;
    END IF;

    IF linked_archive.unit_kerja_id IS DISTINCT FROM NEW.unit_kerja_id
       OR linked_archive.tahun IS DISTINCT FROM NEW.tahun
       OR linked_archive.nomor_surat_original IS DISTINCT FROM NEW.nomor_surat
       OR linked_archive.tanggal_surat_original IS DISTINCT FROM NEW.tanggal_surat
       OR linked_archive.perihal_original IS DISTINCT FROM NEW.perihal
       OR (
           (NULLIF(trim(klasifikasi_1), '') IS NOT NULL
            OR NULLIF(trim(klasifikasi_2), '') IS NOT NULL)
           AND linked_archive.kode_klasifikasi IS DISTINCT FROM NULLIF(trim(klasifikasi_1), '')
           AND linked_archive.kode_klasifikasi IS DISTINCT FROM NULLIF(trim(klasifikasi_2), '')
       ) THEN
        RAISE EXCEPTION 'Archived source metadata cannot diverge from archive %', linked_archive.id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_arsip_source_archived_flag()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.source_surat_id IS NOT NULL
       AND (TG_OP = 'DELETE'
            OR OLD.source_surat_id IS DISTINCT FROM NEW.source_surat_id
            OR OLD.jenis_arsip IS DISTINCT FROM NEW.jenis_arsip) THEN
        IF OLD.jenis_arsip = 'masuk' THEN
            UPDATE surat_masuk
            SET is_archived = EXISTS (
                SELECT 1 FROM arsip
                WHERE jenis_arsip = 'masuk' AND source_surat_id = OLD.source_surat_id
            ), updated_at = now()
            WHERE id = OLD.source_surat_id;
        ELSIF OLD.jenis_arsip = 'keluar' THEN
            UPDATE surat_keluar
            SET is_archived = EXISTS (
                SELECT 1 FROM arsip
                WHERE jenis_arsip = 'keluar' AND source_surat_id = OLD.source_surat_id
            ), updated_at = now()
            WHERE id = OLD.source_surat_id;
        END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.source_surat_id IS NOT NULL THEN
        IF NEW.jenis_arsip = 'masuk' THEN
            UPDATE surat_masuk SET is_archived = true, updated_at = now()
            WHERE id = NEW.source_surat_id;
        ELSIF NEW.jenis_arsip = 'keluar' THEN
            UPDATE surat_keluar SET is_archived = true, updated_at = now()
            WHERE id = NEW.source_surat_id;
        END IF;
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS arsip_source_integrity_guard ON arsip;
--> statement-breakpoint
CREATE TRIGGER arsip_source_integrity_guard
BEFORE INSERT OR UPDATE OR DELETE ON arsip
FOR EACH ROW EXECUTE FUNCTION enforce_arsip_source_integrity();
--> statement-breakpoint
DROP TRIGGER IF EXISTS arsip_source_flag_sync ON arsip;
--> statement-breakpoint
CREATE TRIGGER arsip_source_flag_sync
AFTER INSERT OR UPDATE OR DELETE ON arsip
FOR EACH ROW EXECUTE FUNCTION sync_arsip_source_archived_flag();
--> statement-breakpoint
DROP TRIGGER IF EXISTS surat_masuk_archived_source_guard ON surat_masuk;
--> statement-breakpoint
CREATE TRIGGER surat_masuk_archived_source_guard
BEFORE UPDATE OR DELETE ON surat_masuk
FOR EACH ROW EXECUTE FUNCTION protect_archived_surat_source();
--> statement-breakpoint
DROP TRIGGER IF EXISTS surat_keluar_archived_source_guard ON surat_keluar;
--> statement-breakpoint
CREATE TRIGGER surat_keluar_archived_source_guard
BEFORE UPDATE OR DELETE ON surat_keluar
FOR EACH ROW EXECUTE FUNCTION protect_archived_surat_source();
--> statement-breakpoint
UPDATE surat_masuk sm
SET is_archived = EXISTS (
    SELECT 1 FROM arsip a
    WHERE a.jenis_arsip = 'masuk' AND a.source_surat_id = sm.id
), updated_at = now()
WHERE is_archived IS DISTINCT FROM EXISTS (
    SELECT 1 FROM arsip a
    WHERE a.jenis_arsip = 'masuk' AND a.source_surat_id = sm.id
);
--> statement-breakpoint
UPDATE surat_keluar sk
SET is_archived = EXISTS (
    SELECT 1 FROM arsip a
    WHERE a.jenis_arsip = 'keluar' AND a.source_surat_id = sk.id
), updated_at = now()
WHERE is_archived IS DISTINCT FROM EXISTS (
    SELECT 1 FROM arsip a
    WHERE a.jenis_arsip = 'keluar' AND a.source_surat_id = sk.id
);
