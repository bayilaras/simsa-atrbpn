-- Langkah privileged satu kali untuk index trigram Lacak Surat (migrasi 0049).
--
-- Dijalankan oleh administrator grant (pemilik database / identitas yang juga
-- menjalankan 0001), BUKAN oleh migrator, dan WAJIB sebelum db:migrate yang
-- membawa 0049_lacak_trgm:
--   psql "$GRANT_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/src/db/grants/0003_optional_pg_trgm.sql
--
-- Ini SATU-SATUNYA jalur pemasangan pg_trgm di lingkungan yang dikelola:
--   - GCP (maintenance/preview): `npm run db:roles:bootstrap` menjalankan 0001
--     lalu berkas ini sebagai administrator grant yang sama;
--   - CI dan profil backup-upgrade: langkah psql eksplisit sebelum db:migrate;
--   - Neon: bootstrap kosong memasangnya sebagai administrator; Neon yang sudah
--     berjalan menjalankan berkas ini sebelum `migrate --apply`.
-- 0001 sengaja TIDAK memasang pg_trgm: drill restore Cloud SQL menjalankan
-- ulang 0001 setelah pg_restore lalu membandingkan bukti secara persis, dan
-- arsip pre_migration / pre_upgrade_0038 tidak memuat pg_trgm.
-- Idempoten: aman dijalankan ulang.
--
-- Rollback: DROP INDEX untuk enam index *_trgm_idx aman (Lacak tetap benar,
-- hanya kinerjanya turun); extension dibiarkan terpasang. 0049 tetap tercatat
-- di journal, jadi index harus dibuat ulang sebelum migrasi berikutnya.
\set ON_ERROR_STOP on
BEGIN;
DO $trgm_actor$
BEGIN
    -- Hak minimum: extension tidak boleh dimiliki atau dipasang oleh migrator.
    -- USAGE (bukan MEMBER) agar keanggotaan SET-only administrator grant tetap
    -- diterima; superuser lokal/CI selalu "anggota" semua peran.
    IF current_user = 'simsa_migrator'
       OR (NOT (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user)
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'simsa_migrator')
           AND pg_catalog.pg_has_role(current_user, 'simsa_migrator', 'USAGE')) THEN
        RAISE EXCEPTION 'pg_trgm must be installed by the grant administrator, never by simsa_migrator (current_user=%)', current_user;
    END IF;
END
$trgm_actor$;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
DO $trgm_preflight$
DECLARE
    extension_record record;
BEGIN
    SELECT e.extversion,
           available.default_version,
           n.nspname AS schema_name,
           pg_catalog.pg_get_userbyid(e.extowner) AS owner_name
    INTO extension_record
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
    JOIN pg_catalog.pg_available_extensions available ON available.name = e.extname
    WHERE e.extname = 'pg_trgm';

    IF NOT FOUND
       OR extension_record.extversion <> extension_record.default_version
       OR extension_record.schema_name <> 'public'
       OR extension_record.owner_name <> current_user THEN
        RAISE EXCEPTION 'pg_trgm must use the engine default version in public and be owned by the grant administrator';
    END IF;
END
$trgm_preflight$;
COMMIT;
