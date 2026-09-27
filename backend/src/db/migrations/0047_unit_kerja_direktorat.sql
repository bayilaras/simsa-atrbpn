-- 0047: unit direktorat kanonik (dir_*) sebagai tujuan disposisi. Fail-closed
-- bila ada id lama berpola direktorat-* (rekonsiliasi operator). Nama resmi
-- dikoreksi lewat PUT /api/settings/unit-kerja/:id; parent_id/unit_type hanya
-- diisi bila masih NULL. deployment-unit-seed.sql dan bagian_* tidak diubah.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM unit_kerja WHERE id ~ '^direktorat-') THEN
        RAISE EXCEPTION '0047: unit_kerja berpola direktorat-* ditemukan; rekonsiliasi ke dir_* sebelum migrasi'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO unit_kerja (id, name, description, parent_id, unit_type, can_receive_distribution)
    VALUES
        ('dir_bppt', 'Direktorat BPPT', 'Direktorat Bina Pengembangan dan Pemanfaatan Tanah', 'ditjen', 'direktorat', true),
        ('dir_ptep', 'Direktorat PTEP', 'Direktorat Pengadaan Tanah untuk Kepentingan Pembangunan', 'ditjen', 'direktorat', true),
        ('dir_ktpp', 'Direktorat KTPP', 'Direktorat Konsolidasi Tanah dan Pengembangan Pertanahan', 'ditjen', 'direktorat', true),
        ('dir_plp', 'Direktorat PLP', 'Direktorat Pengendalian dan Penggunaan Tanah', 'ditjen', 'direktorat', true)
    ON CONFLICT (id) DO NOTHING;

    UPDATE unit_kerja
    SET parent_id = 'ditjen', updated_at = now()
    WHERE id IN ('sesditjen', 'dir_bppt', 'dir_ptep', 'dir_ktpp', 'dir_plp')
      AND parent_id IS NULL;

    UPDATE unit_kerja
    SET unit_type = CASE WHEN id = 'sesditjen' THEN 'sesditjen' ELSE 'direktorat' END,
        updated_at = now()
    WHERE id IN ('sesditjen', 'dir_bppt', 'dir_ptep', 'dir_ktpp', 'dir_plp')
      AND unit_type IS NULL;
END $$;
