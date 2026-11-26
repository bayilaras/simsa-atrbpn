import { describe, expect, it } from 'vitest'
import { KUNCI_BERLABEL, labelIsianAudit } from './label-isian-audit'

// Kunci berbahasa Inggris atau campuran yang tercatat di changes.before/after
// Audit Log produksi pada 25 November 2026.
const KUNCI_INGGRIS_DI_PRODUKSI = [
    'accessMode', 'borrowerName', 'canReceiveDistribution', 'cancellationReason', 'cancelledAt', 'cancelledBy', 'capacity', 'code',
    'createdAt', 'createdBy', 'currentAppraisalDecisionId', 'currentCount', 'currentRetentionTriggerEventId', 'currentRuleSnapshotId',
    'deletedBy', 'description', 'diimporAt', 'disposalBatchId', 'disposalStatus', 'disposisiUnitIds', 'driveFolderId', 'driveUploadFolderId',
    'dueDate', 'emailNotifications', 'entityId', 'entityType', 'evidence', 'expiresAt', 'extractedText', 'fileAttachmentId', 'fileName',
    'fileOriginalName', 'filePath', 'hasFile', 'id', 'identityProvider', 'immutable', 'inactiveTransferBatchId', 'inactiveTransferredAt',
    'instruction', 'integrityStatus', 'isActive', 'isArchived', 'isDeleted', 'isUnitPengawas', 'jraItemId', 'jraKode', 'jraReference',
    'jraRuleSetId', 'jraUraian', 'jraVersion', 'klasifikasiItemId', 'klasifikasiReference', 'klasifikasiRuleSetId', 'klasifikasiSnapshotHash',
    'klasifikasiVersion', 'language', 'legalHold', 'legalHoldPlacedAt', 'legalHoldPlacedBy', 'legalHoldReason', 'legalHoldReleaseReason',
    'legalHoldReleasedAt', 'legalHoldReleasedBy', 'lendingStatus', 'lendingType', 'level', 'linkDokumen', 'lokasiFc', 'lokasiFolder',
    'lokasiLaci', 'malwareScanStatus', 'mediaType', 'mimeType', 'name', 'nip', 'nomorSuratOriginal', 'notificationsEnabled', 'ocrProcessedAt',
    'ocrStatus', 'parentEntityId', 'parentEntityType', 'parentId', 'perihalOriginal', 'personInCharge', 'purpose', 'reason',
    'registrationCode', 'retentionDecisionHash', 'retentionTriggerDate', 'retentionTriggerEvidence', 'retentionTriggerLabel',
    'retentionTriggerType', 'returnDate', 'role', 'ruleProvenanceStatus', 'selesaiBy', 'sha256', 'sizeBytes', 'sourceId', 'sourceSuratId',
    'sourceType', 'sourceUnitId', 'storageAccess', 'storageLocationId', 'tanggalSuratOriginal', 'targetId', 'targetType', 'targetUnitId',
    'targetUserId', 'theme', 'unitKerjaId', 'unitType', 'updatedAt',
]

// Kata Inggris yang tidak boleh tersisa di label. Istilah yang memang dipakai
// aplikasi (Legal Hold, OCR, Filing Cabinet, Google Drive, malware, email,
// metadata, label, status) tidak termasuk.
const KATA_INGGRIS = /\b(date|name|type|reason|created|updated|deleted|cancelled|source|target|file|path|size|level|code|is|has|can|current|rule|trigger|evidence|access|mode|purpose|language|theme)\b/i

describe('labelIsianAudit', () => {
    it('memberi label Indonesia untuk setiap kunci berbahasa Inggris yang tercatat di produksi', () => {
        for (const kunci of KUNCI_INGGRIS_DI_PRODUKSI) {
            expect(KUNCI_BERLABEL, kunci).toContain(kunci)
            expect(labelIsianAudit(kunci), kunci).not.toMatch(KATA_INGGRIS)
        }
    })

    it('tidak menyisakan kata Inggris, garis bawah, atau label kosong di tabel', () => {
        for (const kunci of KUNCI_BERLABEL) {
            const label = labelIsianAudit(kunci)
            expect(label.trim(), kunci).not.toBe('')
            expect(label, kunci).not.toMatch(/_/)
            expect(label, kunci).not.toMatch(KATA_INGGRIS)
        }
    })

    it('memakai istilah yang sama dengan halaman lain', () => {
        expect(labelIsianAudit('dueDate')).toBe('Jatuh tempo')
        expect(labelIsianAudit('borrowerName')).toBe('Peminjam')
        expect(labelIsianAudit('canReceiveDistribution')).toBe('Dapat menerima distribusi')
        expect(labelIsianAudit('isUnitPengawas')).toBe('Unit Pengawas')
        expect(labelIsianAudit('notificationsEnabled')).toBe('Notifikasi dalam aplikasi')
        expect(labelIsianAudit('language')).toBe('Bahasa antarmuka')
        expect(labelIsianAudit('lokasiFc')).toBe('No. Filing Cabinet')
        expect(labelIsianAudit('linkDokumen')).toBe('Tautan dokumen')
        expect(labelIsianAudit('expiresAt')).toBe('Masa berlaku')
        expect(labelIsianAudit('diimporAt')).toBe('Penanda impor')
    })

    it('menulis akhiran teknis pada kunci yang tidak terdaftar sebagai kata-kata', () => {
        expect(labelIsianAudit('suratMasukId')).toBe('ID surat Masuk')
        expect(labelIsianAudit('rangkaian_id')).toBe('ID rangkaian')
        expect(labelIsianAudit('unitPenerimaIds')).toBe('ID unit Penerima')
        expect(labelIsianAudit('selesaiAt')).toBe('Waktu selesai')
        expect(labelIsianAudit('diajukan_at')).toBe('Waktu diajukan')
        expect(labelIsianAudit('berakhirBy')).toBe('berakhir oleh')
        expect(labelIsianAudit('diputuskan_by')).toBe('diputuskan oleh')
    })

    it('mendahulukan label terdaftar daripada aturan akhiran', () => {
        expect(labelIsianAudit('createdAt')).toBe('Waktu dibuat')
        expect(labelIsianAudit('unitKerjaId')).toBe('Unit kerja')
        expect(labelIsianAudit('cancelledBy')).toBe('Dibatalkan oleh')
        expect(labelIsianAudit('selesaiBy')).toBe('Diselesaikan oleh')
    })

    it('membiarkan kunci biasa: hanya dipisah menjadi kata-kata', () => {
        expect(labelIsianAudit('nomorSurat')).toBe('nomor Surat')
        expect(labelIsianAudit('tanggal_surat_baru')).toBe('tanggal surat baru')
        expect(labelIsianAudit('kata_sandi')).toBe('kata sandi')
        expect(labelIsianAudit('perihal')).toBe('perihal')
        // Akhiran huruf kecil bukan akhiran teknis.
        expect(labelIsianAudit('format')).toBe('format')
        expect(labelIsianAudit('standby')).toBe('standby')
        expect(labelIsianAudit('valid')).toBe('valid')
        expect(labelIsianAudit('Id')).toBe('Id')
        expect(labelIsianAudit('toString')).toBe('to String')
    })
})
