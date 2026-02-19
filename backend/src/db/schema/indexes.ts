/**
 * Database Indexes — Performance Optimization
 *
 * These indexes target the most frequently queried columns
 * based on filter patterns in services and routes.
 */
import { index } from 'drizzle-orm/pg-core';
import { suratMasuk } from './surat-masuk';
import { suratKeluar } from './surat-keluar';
import { arsip } from './arsip';
import { auditLog } from './audit-log';

// ============== SURAT MASUK ==============
// Most queries filter by unitKerjaId + tahun
export const smUnitKerjaIdx = index('idx_surat_masuk_unit_kerja')
    .on(suratMasuk.unitKerjaId);

export const smTahunIdx = index('idx_surat_masuk_tahun')
    .on(suratMasuk.tahun);

export const smStatusIdx = index('idx_surat_masuk_status')
    .on(suratMasuk.status);

export const smTanggalSuratIdx = index('idx_surat_masuk_tanggal_surat')
    .on(suratMasuk.tanggalSurat);

export const smCompositeIdx = index('idx_surat_masuk_unit_tahun')
    .on(suratMasuk.unitKerjaId, suratMasuk.tahun);

export const smIsArchivedIdx = index('idx_surat_masuk_is_archived')
    .on(suratMasuk.isArchived);

// ============== SURAT KELUAR ==============
export const skUnitKerjaIdx = index('idx_surat_keluar_unit_kerja')
    .on(suratKeluar.unitKerjaId);

export const skTahunIdx = index('idx_surat_keluar_tahun')
    .on(suratKeluar.tahun);

export const skTanggalSuratIdx = index('idx_surat_keluar_tanggal_surat')
    .on(suratKeluar.tanggalSurat);

export const skCompositeIdx = index('idx_surat_keluar_unit_tahun')
    .on(suratKeluar.unitKerjaId, suratKeluar.tahun);

// ============== ARSIP ==============
export const arsipUnitKerjaIdx = index('idx_arsip_unit_kerja')
    .on(arsip.unitKerjaId);

export const arsipJenisIdx = index('idx_arsip_jenis')
    .on(arsip.jenisArsip);

export const arsipTahunIdx = index('idx_arsip_tahun')
    .on(arsip.tahun);

export const arsipDisposalIdx = index('idx_arsip_disposal_status')
    .on(arsip.disposalStatus);

export const arsipCompositeIdx = index('idx_arsip_unit_jenis')
    .on(arsip.unitKerjaId, arsip.jenisArsip);

export const arsipSourceSuratIdx = index('idx_arsip_source_surat')
    .on(arsip.sourceSuratId);

// ============== AUDIT LOG ==============
export const auditUserIdx = index('idx_audit_log_user')
    .on(auditLog.userId);

export const auditCreatedAtIdx = index('idx_audit_log_created_at')
    .on(auditLog.createdAt);

export const auditEntityTypeIdx = index('idx_audit_log_entity_type')
    .on(auditLog.entityType);

export const auditEntityIdx = index('idx_audit_log_entity')
    .on(auditLog.entityType, auditLog.entityId);
