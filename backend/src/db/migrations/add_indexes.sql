-- Database Optimization: Add Indexes for SIMSA Application
-- Run this migration to improve query performance

-- ============================================
-- ARSIP TABLE INDEXES
-- ============================================

-- Index for filtering by unit kerja (very common query)
CREATE INDEX IF NOT EXISTS idx_arsip_unit_kerja 
ON arsip(unit_kerja_id);

-- Index for filtering by jenis arsip and tahun (common in archive listing)
CREATE INDEX IF NOT EXISTS idx_arsip_jenis_tahun 
ON arsip(jenis_arsip, tahun);

-- Index for filtering by klasifikasi (used in search and filtering)
CREATE INDEX IF NOT EXISTS idx_arsip_klasifikasi 
ON arsip(kode_klasifikasi);

-- Index for date-based queries
CREATE INDEX IF NOT EXISTS idx_arsip_tanggal 
ON arsip(tanggal_arsip);

-- Index for created_at (used in sorting and recent items)
CREATE INDEX IF NOT EXISTS idx_arsip_created_at 
ON arsip(created_at DESC);

-- Index for disposal status (used in penyusutan workflow)
CREATE INDEX IF NOT EXISTS idx_arsip_disposal_status 
ON arsip(disposal_status);

-- Index for lending status (used in archive lending)
CREATE INDEX IF NOT EXISTS idx_arsip_lending_status 
ON arsip(lending_status);

-- Index for storage location (used in physical tracking)
CREATE INDEX IF NOT EXISTS idx_arsip_storage_location 
ON arsip(storage_location_id);

-- Full-text search index for extracted text (PostgreSQL specific)
CREATE INDEX IF NOT EXISTS idx_arsip_fulltext 
ON arsip USING GIN(to_tsvector('indonesian', COALESCE(extracted_text, '')));

-- Composite index for common filter combinations
CREATE INDEX IF NOT EXISTS idx_arsip_unit_jenis_tahun 
ON arsip(unit_kerja_id, jenis_arsip, tahun);

-- ============================================
-- SURAT MASUK TABLE INDEXES
-- ============================================

-- Index for unit kerja
CREATE INDEX IF NOT EXISTS idx_surat_masuk_unit_kerja 
ON surat_masuk(unit_kerja_id);

-- Index for date queries
CREATE INDEX IF NOT EXISTS idx_surat_masuk_tanggal 
ON surat_masuk(tanggal_surat);

-- Index for created_at
CREATE INDEX IF NOT EXISTS idx_surat_masuk_created_at 
ON surat_masuk(created_at DESC);

-- Index for klasifikasi
CREATE INDEX IF NOT EXISTS idx_surat_masuk_klasifikasi 
ON surat_masuk(kode_klasifikasi);

-- Index for nomor surat (used in search)
CREATE INDEX IF NOT EXISTS idx_surat_masuk_nomor 
ON surat_masuk(nomor_surat);

-- ============================================
-- SURAT KELUAR TABLE INDEXES
-- ============================================

-- Index for unit kerja
CREATE INDEX IF NOT EXISTS idx_surat_keluar_unit_kerja 
ON surat_keluar(unit_kerja_id);

-- Index for date queries
CREATE INDEX IF NOT EXISTS idx_surat_keluar_tanggal 
ON surat_keluar(tanggal_surat);

-- Index for created_at
CREATE INDEX IF NOT EXISTS idx_surat_keluar_created_at 
ON surat_keluar(created_at DESC);

-- Index for klasifikasi
CREATE INDEX IF NOT EXISTS idx_surat_keluar_klasifikasi 
ON surat_keluar(kode_klasifikasi);

-- Index for nomor surat
CREATE INDEX IF NOT EXISTS idx_surat_keluar_nomor 
ON surat_keluar(nomor_surat);

-- ============================================
-- USERS TABLE INDEXES
-- ============================================

-- Index for email (already unique, but explicit index for lookups)
CREATE INDEX IF NOT EXISTS idx_users_email 
ON users(email);

-- Index for role (used in filtering users by role)
CREATE INDEX IF NOT EXISTS idx_users_role 
ON users(role);

-- Index for unit kerja
CREATE INDEX IF NOT EXISTS idx_users_unit_kerja 
ON users(unit_kerja_id);

-- Index for active status
CREATE INDEX IF NOT EXISTS idx_users_is_active 
ON users(is_active);

-- ============================================
-- SESSIONS TABLE INDEXES
-- ============================================

-- Index for user_id (used in session lookups)
CREATE INDEX IF NOT EXISTS idx_sessions_user_id 
ON sessions(user_id);

-- Index for token (already unique, but explicit for fast lookups)
CREATE INDEX IF NOT EXISTS idx_sessions_token 
ON sessions(token);

-- Index for expires_at (used in cleanup queries)
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at 
ON sessions(expires_at);

-- ============================================
-- AUDIT LOG TABLE INDEXES
-- ============================================

-- Index for user_id (who did the action)
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id 
ON audit_log(user_id);

-- Index for action type
CREATE INDEX IF NOT EXISTS idx_audit_log_action 
ON audit_log(action);

-- Index for timestamp (used in sorting and filtering)
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp 
ON audit_log(timestamp DESC);

-- Index for entity type and ID (used in entity history)
CREATE INDEX IF NOT EXISTS idx_audit_log_entity 
ON audit_log(entity_type, entity_id);

-- ============================================
-- NOTIFICATIONS TABLE INDEXES
-- ============================================

-- Index for user_id (recipient)
CREATE INDEX IF NOT EXISTS idx_notifications_user_id 
ON notifications(user_id);

-- Index for created_at
CREATE INDEX IF NOT EXISTS idx_notifications_created_at 
ON notifications(created_at DESC);

-- Index for type
CREATE INDEX IF NOT EXISTS idx_notifications_type 
ON notifications(type);

-- ============================================
-- NOTIFICATION READS TABLE INDEXES
-- ============================================

-- Index for user_id
CREATE INDEX IF NOT EXISTS idx_notification_reads_user_id 
ON notification_reads(user_id);

-- Index for notification_id
CREATE INDEX IF NOT EXISTS idx_notification_reads_notification_id 
ON notification_reads(notification_id);

-- Composite index for checking read status
CREATE INDEX IF NOT EXISTS idx_notification_reads_user_notification 
ON notification_reads(user_id, notification_id);

-- ============================================
-- DOSIR TABLE INDEXES
-- ============================================

-- Index for unit kerja
CREATE INDEX IF NOT EXISTS idx_dosir_unit_kerja 
ON dosir(unit_kerja_id);

-- Index for created_at
CREATE INDEX IF NOT EXISTS idx_dosir_created_at 
ON dosir(created_at DESC);

-- Index for klasifikasi
CREATE INDEX IF NOT EXISTS idx_dosir_klasifikasi 
ON dosir(kode_klasifikasi);

-- ============================================
-- STORAGE LOCATIONS TABLE INDEXES
-- ============================================

-- Index for location type
CREATE INDEX IF NOT EXISTS idx_storage_locations_type 
ON storage_locations(location_type);

-- Index for parent location (for hierarchical queries)
CREATE INDEX IF NOT EXISTS idx_storage_locations_parent 
ON storage_locations(parent_location_id);

-- ============================================
-- ARCHIVE LENDING TABLE INDEXES
-- ============================================

-- Index for arsip_id
CREATE INDEX IF NOT EXISTS idx_archive_lending_arsip_id 
ON archive_lending(arsip_id);

-- Index for borrower
CREATE INDEX IF NOT EXISTS idx_archive_lending_borrower 
ON archive_lending(borrower_id);

-- Index for status
CREATE INDEX IF NOT EXISTS idx_archive_lending_status 
ON archive_lending(status);

-- Index for due date (for overdue checks)
CREATE INDEX IF NOT EXISTS idx_archive_lending_due_date 
ON archive_lending(due_date);

-- ============================================
-- PENYUSUTAN TABLE INDEXES
-- ============================================

-- Index for batch status
CREATE INDEX IF NOT EXISTS idx_penyusutan_status 
ON penyusutan(status);

-- Index for created_at
CREATE INDEX IF NOT EXISTS idx_penyusutan_created_at 
ON penyusutan(created_at DESC);

-- Index for jenis penyusutan
CREATE INDEX IF NOT EXISTS idx_penyusutan_jenis 
ON penyusutan(jenis_penyusutan);

-- ============================================
-- VERIFICATION
-- ============================================

-- Query to check all indexes
-- SELECT 
--     schemaname,
--     tablename,
--     indexname,
--     indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
-- ORDER BY tablename, indexname;

-- Query to check index usage
-- SELECT 
--     schemaname,
--     tablename,
--     indexname,
--     idx_scan as index_scans,
--     idx_tup_read as tuples_read,
--     idx_tup_fetch as tuples_fetched
-- FROM pg_stat_user_indexes
-- WHERE schemaname = 'public'
-- ORDER BY idx_scan DESC;
