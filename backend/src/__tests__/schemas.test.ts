import { describe, it, expect } from 'vitest';
import {
    createDosirSchema,
    updateDosirSchema,
    linkSuratToDosirSchema,
    createDistributionSchema,
    rejectDistributionSchema,
    createPenyusutanSchema,
    updatePenyusutanStatusSchema,
    removePenyusutanItemsSchema,
    legalHoldActionSchema,
    updateArsipSchema,
    calculateRetentionDatesSchema,
    createStorageLocationSchema,
    updateStorageLocationSchema,
    borrowArchiveSchema,
    extendLendingSchema,
    createLayananArsipSchema,
    updateLayananStatusSchema,
    markAllReadSchema,
} from '../validators/schemas';

const validUUID = '550e8400-e29b-41d4-a716-446655440000';

// ==================== Dosir Schemas ====================

describe('createDosirSchema', () => {
    it('accepts valid input', () => {
        const result = createDosirSchema.safeParse({
            judul: 'Dosir Pengadaan Tanah',
            kategori: 'Pengadaan',
            tanggalMulai: '2026-01-15',
        });
        expect(result.success).toBe(true);
    });

    it('accepts minimal input (judul only)', () => {
        const result = createDosirSchema.safeParse({ judul: 'Test' });
        expect(result.success).toBe(true);
    });

    it('rejects empty judul', () => {
        const result = createDosirSchema.safeParse({ judul: '' });
        expect(result.success).toBe(false);
    });

    it('rejects missing judul', () => {
        const result = createDosirSchema.safeParse({});
        expect(result.success).toBe(false);
    });

    it('rejects judul exceeding max length', () => {
        const result = createDosirSchema.safeParse({ judul: 'a'.repeat(501) });
        expect(result.success).toBe(false);
    });
});

describe('updateDosirSchema', () => {
    it('accepts partial updates', () => {
        const result = updateDosirSchema.safeParse({ status: 'closed' });
        expect(result.success).toBe(true);
    });

    it('rejects invalid status', () => {
        const result = updateDosirSchema.safeParse({ status: 'invalid' });
        expect(result.success).toBe(false);
    });

    it('accepts nullable fields', () => {
        const result = updateDosirSchema.safeParse({ deskripsi: null, kategori: null });
        expect(result.success).toBe(true);
    });
});

describe('linkSuratToDosirSchema', () => {
    it('accepts valid link', () => {
        const result = linkSuratToDosirSchema.safeParse({
            type: 'masuk',
            suratId: validUUID,
        });
        expect(result.success).toBe(true);
    });

    it('rejects invalid type', () => {
        const result = linkSuratToDosirSchema.safeParse({
            type: 'internal',
            suratId: validUUID,
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid UUID', () => {
        const result = linkSuratToDosirSchema.safeParse({
            type: 'masuk',
            suratId: 'not-a-uuid',
        });
        expect(result.success).toBe(false);
    });
});

// ==================== Distribution Schemas ====================

describe('createDistributionSchema', () => {
    it('accepts valid distribution', () => {
        const result = createDistributionSchema.safeParse({
            suratMasukId: validUUID,
            sourceUnitId: 'unit-a',
            targetUnitId: 'unit-b',
        });
        expect(result.success).toBe(true);
    });

    it('accepts with optional fields', () => {
        const result = createDistributionSchema.safeParse({
            suratMasukId: validUUID,
            sourceUnitId: 'unit-a',
            targetUnitId: 'unit-b',
            instruction: 'Segera tindak lanjuti',
            ccUnits: ['unit-c', 'unit-d'],
        });
        expect(result.success).toBe(true);
    });

    it('rejects missing required fields', () => {
        const result = createDistributionSchema.safeParse({
            suratMasukId: validUUID,
        });
        expect(result.success).toBe(false);
    });
});

describe('rejectDistributionSchema', () => {
    it('accepts valid reason', () => {
        const result = rejectDistributionSchema.safeParse({ reason: 'Bukan untuk unit ini' });
        expect(result.success).toBe(true);
    });

    it('rejects empty reason', () => {
        const result = rejectDistributionSchema.safeParse({ reason: '' });
        expect(result.success).toBe(false);
    });
});

// ==================== Penyusutan Schemas ====================

describe('createPenyusutanSchema', () => {
    it('accepts valid batch', () => {
        const result = createPenyusutanSchema.safeParse({
            unitKerjaId: 'ditjen',
            jenisPenyusutan: 'pemusnahan',
            arsipIds: [validUUID],
        });
        expect(result.success).toBe(true);
    });

    it('rejects invalid jenis', () => {
        const result = createPenyusutanSchema.safeParse({
            unitKerjaId: 'ditjen',
            jenisPenyusutan: 'invalid',
            arsipIds: [validUUID],
        });
        expect(result.success).toBe(false);
    });

    it('rejects empty arsipIds', () => {
        const result = createPenyusutanSchema.safeParse({
            unitKerjaId: 'ditjen',
            jenisPenyusutan: 'pemindahan',
            arsipIds: [],
        });
        expect(result.success).toBe(false);
    });
});

describe('updatePenyusutanStatusSchema', () => {
    it('accepts empty catatan', () => {
        const result = updatePenyusutanStatusSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it('accepts catatan', () => {
        const result = updatePenyusutanStatusSchema.safeParse({ catatan: 'OK' });
        expect(result.success).toBe(true);
    });
});

describe('removePenyusutanItemsSchema', () => {
    it('accepts valid arsipIds', () => {
        const result = removePenyusutanItemsSchema.safeParse({ arsipIds: [validUUID] });
        expect(result.success).toBe(true);
    });

    it('rejects empty arsipIds', () => {
        const result = removePenyusutanItemsSchema.safeParse({ arsipIds: [] });
        expect(result.success).toBe(false);
    });
});

describe('retention and legal hold schemas', () => {
    it('accepts a fully documented retention trigger', () => {
        const result = updateArsipSchema.safeParse({
            retentionTriggerType: 'serah_terima',
            retentionTriggerLabel: 'BAST final',
            retentionTriggerDate: '2026-08-20',
            retentionTriggerEvidence: 'BAST Nomor 12/2026 tanggal 20 Agustus 2026',
            jraVersion: 'JRA 2026',
            jraReference: 'Kode AT.02',
        });
        expect(result.success).toBe(true);
    });

    it('rejects a trigger date without supporting evidence', () => {
        const result = updateArsipSchema.safeParse({
            retentionTriggerType: 'serah_terima',
            retentionTriggerLabel: 'BAST final',
            retentionTriggerDate: '2026-08-20',
        });
        expect(result.success).toBe(false);
    });

    it('allows legacy updates without a trigger and keeps them non-actionable', () => {
        expect(updateArsipSchema.safeParse({ catatan: 'Koreksi metadata' }).success).toBe(true);
    });

    it('requires a unit and a meaningful legal-hold reason', () => {
        expect(legalHoldActionSchema.safeParse({
            unitKerjaId: 'ditjen',
            reason: 'Pemeriksaan masih berlangsung',
        }).success).toBe(true);
        expect(legalHoldActionSchema.safeParse({
            unitKerjaId: 'ditjen',
            reason: 'singkat',
        }).success).toBe(false);
    });

    it('requires an explicit trigger date for retention calculations', () => {
        expect(calculateRetentionDatesSchema.safeParse({
            retentionTriggerDate: '2026-08-20',
            retensiAktif: '2 tahun',
            retensiInaktif: '3 tahun',
        }).success).toBe(true);
        expect(calculateRetentionDatesSchema.safeParse({
            tanggalArsip: '2026-08-20',
            retensiAktif: '2 tahun',
            retensiInaktif: '3 tahun',
        }).success).toBe(false);
    });

    it('rejects impossible calendar dates instead of relying on database coercion', () => {
        expect(calculateRetentionDatesSchema.safeParse({
            retentionTriggerDate: '2026-02-31',
            retensiAktif: '2 tahun',
            retensiInaktif: '3 tahun',
        }).success).toBe(false);
    });

    it('rejects a future retention trigger on generic archive updates', () => {
        expect(updateArsipSchema.safeParse({
            retentionTriggerType: 'serah_terima',
            retentionTriggerLabel: 'BAST final',
            retentionTriggerDate: '9999-01-01',
            retentionTriggerEvidence: 'BAST yang belum terjadi',
        }).success).toBe(false);
    });
});

// ==================== Storage Location Schemas ====================

describe('createStorageLocationSchema', () => {
    it('accepts valid location', () => {
        const result = createStorageLocationSchema.safeParse({
            unitKerjaId: 'ditjen',
            code: 'G1-R2-RAK3',
            name: 'Rak 3',
            level: 'rak',
        });
        expect(result.success).toBe(true);
    });

    it('rejects invalid level', () => {
        const result = createStorageLocationSchema.safeParse({
            unitKerjaId: 'ditjen',
            code: 'G1',
            name: 'Invalid',
            level: 'lantai',
        });
        expect(result.success).toBe(false);
    });

    it('accepts optional parentId and capacity', () => {
        const result = createStorageLocationSchema.safeParse({
            unitKerjaId: 'ditjen',
            code: 'G1-R2-RAK3-B1',
            name: 'Box 1',
            level: 'box',
            parentId: validUUID,
            capacity: 50,
        });
        expect(result.success).toBe(true);
    });
});

describe('updateStorageLocationSchema', () => {
    it('accepts partial update', () => {
        const result = updateStorageLocationSchema.safeParse({ name: 'New Name' });
        expect(result.success).toBe(true);
    });
});

// ==================== Archive Lending Schemas ====================

describe('borrowArchiveSchema', () => {
    it('accepts arsip lending', () => {
        const result = borrowArchiveSchema.safeParse({
            lendingType: 'arsip',
            arsipId: validUUID,
            borrowerName: 'John Doe',
            dueDate: '2026-03-15',
        });
        expect(result.success).toBe(true);
    });

    it('accepts box lending', () => {
        const result = borrowArchiveSchema.safeParse({
            lendingType: 'box',
            storageLocationId: validUUID,
            borrowerName: 'Jane Doe',
            dueDate: '2026-03-15',
        });
        expect(result.success).toBe(true);
    });

    it('rejects arsip lending without arsipId', () => {
        const result = borrowArchiveSchema.safeParse({
            lendingType: 'arsip',
            borrowerName: 'John Doe',
            dueDate: '2026-03-15',
        });
        expect(result.success).toBe(false);
    });

    it('rejects box lending without storageLocationId', () => {
        const result = borrowArchiveSchema.safeParse({
            lendingType: 'box',
            borrowerName: 'Jane Doe',
            dueDate: '2026-03-15',
        });
        expect(result.success).toBe(false);
    });
});

describe('extendLendingSchema', () => {
    it('accepts valid date', () => {
        const result = extendLendingSchema.safeParse({ newDueDate: '2026-06-30' });
        expect(result.success).toBe(true);
    });

    it('rejects missing date', () => {
        const result = extendLendingSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

// ==================== Layanan Arsip Schemas ====================

describe('createLayananArsipSchema', () => {
    it('accepts valid request', () => {
        const result = createLayananArsipSchema.safeParse({
            jenisLayanan: 'penggandaan',
            arsipId: validUUID,
            keperluan: 'Untuk keperluan sidang',
        });
        expect(result.success).toBe(true);
    });

    it('accepts with jumlahRangkap', () => {
        const result = createLayananArsipSchema.safeParse({
            jenisLayanan: 'legalisasi',
            arsipId: validUUID,
            keperluan: 'Legalisasi dokumen',
            jumlahRangkap: 3,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.jumlahRangkap).toBe(3);
        }
    });

    it('rejects invalid jenis layanan', () => {
        const result = createLayananArsipSchema.safeParse({
            jenisLayanan: 'fotokopi',
            arsipId: validUUID,
            keperluan: 'Test',
        });
        expect(result.success).toBe(false);
    });

    it('rejects missing keperluan', () => {
        const result = createLayananArsipSchema.safeParse({
            jenisLayanan: 'penggandaan',
            arsipId: validUUID,
        });
        expect(result.success).toBe(false);
    });
});

describe('updateLayananStatusSchema', () => {
    it('accepts valid status', () => {
        const result = updateLayananStatusSchema.safeParse({ status: 'selesai' });
        expect(result.success).toBe(true);
    });

    it('rejects invalid status', () => {
        const result = updateLayananStatusSchema.safeParse({ status: 'diajukan' });
        expect(result.success).toBe(false);
    });

    it('accepts with notes', () => {
        const result = updateLayananStatusSchema.safeParse({
            status: 'ditolak',
            notes: 'Arsip tidak tersedia',
        });
        expect(result.success).toBe(true);
    });
});

// ==================== Notification Schemas ====================

describe('markAllReadSchema', () => {
    it('accepts valid notification IDs', () => {
        const result = markAllReadSchema.safeParse({
            notificationIds: ['notif-1', 'notif-2'],
        });
        expect(result.success).toBe(true);
    });

    it('rejects empty array', () => {
        const result = markAllReadSchema.safeParse({ notificationIds: [] });
        expect(result.success).toBe(false);
    });

    it('rejects missing notificationIds', () => {
        const result = markAllReadSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});
