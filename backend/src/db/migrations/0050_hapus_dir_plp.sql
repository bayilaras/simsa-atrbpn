-- 0050: hapus unit dir_plp (Direktorat PLP) yang keliru dibuat 0047.
-- Ditjen PTPP tidak memiliki Direktorat PLP. 0047 tidak diubah (hash sudah
-- tercatat di produksi); migrasi ini menghapus barisnya bila masih ada.
-- Fail-closed: bila dir_plp sudah dirujuk data apa pun, migrasi berhenti dan
-- operator harus memindahkan rujukan itu lebih dulu. Di produksi baris ini
-- sudah dihapus manual pada 3 Oktober 2026, sehingga migrasi menjadi no-op.
DO $$
DECLARE
    r record;
    jumlah bigint;
    total bigint := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM unit_kerja WHERE id = 'dir_plp') THEN
        RETURN;
    END IF;

    FOR r IN
        SELECT c.conrelid::regclass AS tabel, a.attname AS kolom
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = 'unit_kerja'::regclass
    LOOP
        EXECUTE format('SELECT count(*) FROM %s WHERE %I = %L', r.tabel, r.kolom, 'dir_plp') INTO jumlah;
        total := total + jumlah;
    END LOOP;

    IF total > 0 THEN
        RAISE EXCEPTION '0050: unit dir_plp masih dirujuk % baris; pindahkan rujukan ke unit yang benar sebelum migrasi', total
            USING ERRCODE = '23503';
    END IF;

    DELETE FROM unit_kerja WHERE id = 'dir_plp';
END $$;
