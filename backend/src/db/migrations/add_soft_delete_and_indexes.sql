-- Migration: Add soft delete columns and performance indexes
-- Run this migration against your PostgreSQL database

-- ============================================================
-- 1. Soft Delete Columns
-- ============================================================

-- Add soft delete columns to surat_masuk
ALTER TABLE surat_masuk ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
ALTER TABLE surat_masuk ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE surat_masuk ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES "user"(id);

-- Add soft delete columns to surat_keluar
ALTER TABLE surat_keluar ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
ALTER TABLE surat_keluar ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE surat_keluar ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES "user"(id);

-- ============================================================
-- 2. Performance Indexes
-- ============================================================

-- === surat_masuk indexes ===
CREATE INDEX IF NOT EXISTS idx_surat_masuk_unit_kerja ON surat_masuk(unit_kerja_id);
CREATE INDEX IF NOT EXISTS idx_surat_masuk_tahun ON surat_masuk(tahun);
CREATE INDEX IF NOT EXISTS idx_surat_masuk_unit_tahun ON surat_masuk(unit_kerja_id, tahun);
CREATE INDEX IF NOT EXISTS idx_surat_masuk_status ON surat_masuk(status);
CREATE INDEX IF NOT EXISTS idx_surat_masuk_tanggal ON surat_masuk(tanggal_surat);
CREATE INDEX IF NOT EXISTS idx_surat_masuk_nomor ON surat_masuk(nomor_surat);
CREATE INDEX IF NOT EXISTS idx_surat_masuk_created_at ON surat_masuk(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_surat_masuk_is_deleted ON surat_masuk(is_deleted) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_surat_masuk_no_urut ON surat_masuk(unit_kerja_id, tahun, no_urut DESC);

-- === surat_keluar indexes ===
CREATE INDEX IF NOT EXISTS idx_surat_keluar_unit_kerja ON surat_keluar(unit_kerja_id);
CREATE INDEX IF NOT EXISTS idx_surat_keluar_tahun ON surat_keluar(tahun);
CREATE INDEX IF NOT EXISTS idx_surat_keluar_unit_tahun ON surat_keluar(unit_kerja_id, tahun);
CREATE INDEX IF NOT EXISTS idx_surat_keluar_tanggal ON surat_keluar(tanggal_surat);
CREATE INDEX IF NOT EXISTS idx_surat_keluar_nomor ON surat_keluar(nomor_surat);
CREATE INDEX IF NOT EXISTS idx_surat_keluar_created_at ON surat_keluar(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_surat_keluar_is_deleted ON surat_keluar(is_deleted) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_surat_keluar_no_urut ON surat_keluar(unit_kerja_id, tahun, no_urut DESC);
CREATE INDEX IF NOT EXISTS idx_surat_keluar_approval ON surat_keluar(approval_status);
CREATE INDEX IF NOT EXISTS idx_surat_keluar_balasan ON surat_keluar(balasan_untuk) WHERE balasan_untuk IS NOT NULL;

-- === arsip indexes ===
CREATE INDEX IF NOT EXISTS idx_arsip_unit_kerja ON arsip(unit_kerja_id);
CREATE INDEX IF NOT EXISTS idx_arsip_jenis ON arsip(jenis_arsip);
CREATE INDEX IF NOT EXISTS idx_arsip_klasifikasi ON arsip(klasifikasi_id);
CREATE INDEX IF NOT EXISTS idx_arsip_source_surat ON arsip(source_surat_id) WHERE source_surat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_arsip_kode_surat ON arsip(kode_surat);
CREATE INDEX IF NOT EXISTS idx_arsip_created_at ON arsip(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_arsip_disposal_status ON arsip(disposal_status);
CREATE INDEX IF NOT EXISTS idx_arsip_tanggal_berakhir ON arsip(tanggal_berakhir);

-- === audit_log indexes ===
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

-- === user indexes ===
CREATE INDEX IF NOT EXISTS idx_user_email ON "user"(email);
CREATE INDEX IF NOT EXISTS idx_user_role ON "user"(role);
CREATE INDEX IF NOT EXISTS idx_user_unit_kerja ON "user"(unit_kerja_id);

-- === file_attachments indexes ===
CREATE INDEX IF NOT EXISTS idx_file_attachments_entity ON file_attachments(entity_type, entity_id);

-- === klasifikasi indexes ===
CREATE INDEX IF NOT EXISTS idx_klasifikasi_kode ON klasifikasi(kode);
CREATE INDEX IF NOT EXISTS idx_klasifikasi_parent ON klasifikasi(parent_id);

-- === surat_distribution indexes ===
CREATE INDEX IF NOT EXISTS idx_distribution_surat ON surat_distribution(surat_id);
CREATE INDEX IF NOT EXISTS idx_distribution_to_unit ON surat_distribution(to_unit_kerja_id);
CREATE INDEX IF NOT EXISTS idx_distribution_status ON surat_distribution(status);

-- ============================================================
-- 3. Full-Text Search Support (GIN indexes for tsvector)
-- ============================================================

-- Add tsvector column for surat_masuk full-text search
ALTER TABLE surat_masuk ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS idx_surat_masuk_search ON surat_masuk USING GIN(search_vector);

-- Trigger to auto-update search_vector on insert/update
CREATE OR REPLACE FUNCTION surat_masuk_search_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('indonesian', COALESCE(NEW.nomor_surat, '')), 'A') ||
        setweight(to_tsvector('indonesian', COALESCE(NEW.perihal, '')), 'B') ||
        setweight(to_tsvector('indonesian', COALESCE(NEW.dari, '')), 'C') ||
        setweight(to_tsvector('indonesian', COALESCE(NEW.keterangan, '')), 'D');
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_surat_masuk_search ON surat_masuk;
CREATE TRIGGER trig_surat_masuk_search
    BEFORE INSERT OR UPDATE OF nomor_surat, perihal, dari, keterangan
    ON surat_masuk
    FOR EACH ROW
    EXECUTE FUNCTION surat_masuk_search_update();

-- Backfill existing records
UPDATE surat_masuk SET search_vector =
    setweight(to_tsvector('indonesian', COALESCE(nomor_surat, '')), 'A') ||
    setweight(to_tsvector('indonesian', COALESCE(perihal, '')), 'B') ||
    setweight(to_tsvector('indonesian', COALESCE(dari, '')), 'C') ||
    setweight(to_tsvector('indonesian', COALESCE(keterangan, '')), 'D');

-- ============================================================
-- 4. Auto-update updatedAt trigger
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Apply auto-updated_at to all main tables
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY['surat_masuk', 'surat_keluar', 'arsip']) LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS trig_updated_at ON %I;
            CREATE TRIGGER trig_updated_at
                BEFORE UPDATE ON %I
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();
        ', t, t);
    END LOOP;
END
$$;
