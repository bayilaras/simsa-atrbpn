-- Seed script for unit_kerja hierarchy
-- Run this in your PostgreSQL database to set up the distribution hierarchy

-- First, update existing unit_kerja or insert if not exists
-- Ditjen (top level)
INSERT INTO unit_kerja (id, name, description, parent_id, unit_type, can_receive_distribution, created_at, updated_at)
VALUES ('ditjen', 'Direktorat Jenderal', 'Direktorat Jenderal PTEP', NULL, 'ditjen', true, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
    parent_id = NULL,
    unit_type = 'ditjen',
    can_receive_distribution = true,
    updated_at = NOW();

-- Sesditjen (reports to Ditjen)
INSERT INTO unit_kerja (id, name, description, parent_id, unit_type, can_receive_distribution, created_at, updated_at)
VALUES ('sesditjen', 'Sekretariat Ditjen', 'Sekretariat Direktorat Jenderal', 'ditjen', 'sesditjen', true, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
    parent_id = 'ditjen',
    unit_type = 'sesditjen',
    can_receive_distribution = true,
    updated_at = NOW();

-- Bagian di bawah Sesditjen (tidak bisa terima distribusi)
INSERT INTO unit_kerja (id, name, description, parent_id, unit_type, can_receive_distribution, created_at, updated_at)
VALUES 
    ('bagian_keuangan', 'Bagian Keuangan', 'Bagian Keuangan Sesditjen', 'sesditjen', 'bagian', false, NOW(), NOW()),
    ('bagian_kepegawaian', 'Bagian Kepegawaian', 'Bagian Kepegawaian Sesditjen', 'sesditjen', 'bagian', false, NOW(), NOW()),
    ('bagian_umum', 'Bagian Umum', 'Bagian Umum Sesditjen', 'sesditjen', 'bagian', false, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
    parent_id = 'sesditjen',
    unit_type = 'bagian',
    can_receive_distribution = false,
    updated_at = NOW();

-- Direktorat Teknis (reports to Ditjen)
INSERT INTO unit_kerja (id, name, description, parent_id, unit_type, can_receive_distribution, created_at, updated_at)
VALUES 
    ('dir_bppt', 'Direktorat BPPT', 'Direktorat Bina Pengembangan dan Pemanfaatan Tanah', 'ditjen', 'direktorat', true, NOW(), NOW()),
    ('dir_ptep', 'Direktorat PTEP', 'Direktorat Pengadaan Tanah untuk Kepentingan Pembangunan', 'ditjen', 'direktorat', true, NOW(), NOW()),
    ('dir_ktpp', 'Direktorat KTPP', 'Direktorat Konsolidasi Tanah dan Pengembangan Pertanahan', 'ditjen', 'direktorat', true, NOW(), NOW()),
    ('dir_plp', 'Direktorat PLP', 'Direktorat Pengendalian dan Penggunaan Tanah', 'ditjen', 'direktorat', true, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
    parent_id = 'ditjen',
    unit_type = 'direktorat',
    can_receive_distribution = true,
    updated_at = NOW();

-- Verify the hierarchy
SELECT 
    uk.id,
    uk.name,
    uk.parent_id,
    uk.unit_type,
    uk.can_receive_distribution,
    parent.name as parent_name
FROM unit_kerja uk
LEFT JOIN unit_kerja parent ON uk.parent_id = parent.id
ORDER BY 
    CASE uk.unit_type 
        WHEN 'ditjen' THEN 1 
        WHEN 'sesditjen' THEN 2 
        WHEN 'direktorat' THEN 3 
        WHEN 'bagian' THEN 4 
        ELSE 5 
    END,
    uk.name;
