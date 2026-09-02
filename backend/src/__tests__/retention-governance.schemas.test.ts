import { describe, expect, it } from 'vitest';
import {
    createAppraisalCaseSchema,
    createPermanentTransferManifestSchema,
    createRetentionTriggerEventSchema,
    permanentTransferEventSchema,
    requestPermanentTransferCancellationSchema,
    reviewPermanentTransferCancellationSchema,
    verifyRetentionTriggerEventSchema,
} from '../validators/retention-governance.schemas';

const ARSIP_ID = '550e8400-e29b-41d4-a716-446655440001';
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440002';
const DECISION_ID = '550e8400-e29b-41d4-a716-446655440003';
const ATTACHMENT_ID = '550e8400-e29b-41d4-a716-446655440004';
const HASH = 'a'.repeat(64);

describe('retention governance validation', () => {
    it('accepts a Musnah appraisal with a Permanen child exception', () => {
        const result = createAppraisalCaseSchema.safeParse({
            arsipId: ARSIP_ID,
            caseType: 'conditional_exception',
            reason: 'Ketentuan JRA membedakan keputusan dari lampiran biasa.',
            proposedOutcome: 'musnah',
            proposedRationale: 'Dokumen operasional habis nilai guna setelah masa retensi berakhir.',
            itemDecisions: [{
                arsipItemId: ITEM_ID,
                outcome: 'permanen',
                basis: 'Berita acara merupakan bukti keputusan yang bernilai permanen.',
            }],
        });
        expect(result.success).toBe(true);
    });

    it('rejects a destructive child downgrade from a Permanen parent', () => {
        const result = createAppraisalCaseSchema.safeParse({
            arsipId: ARSIP_ID,
            caseType: 'dinilai_kembali',
            reason: 'Penilaian kembali diperlukan untuk menjamin nilai guna sekunder.',
            proposedOutcome: 'permanen',
            proposedRationale: 'Keseluruhan berkas menjadi memori kelembagaan permanen.',
            itemDecisions: [{
                arsipItemId: ITEM_ID,
                outcome: 'musnah',
                basis: 'Usulan yang semestinya ditolak oleh pengaman konservatif.',
            }],
        });
        expect(result.success).toBe(false);
    });

    it('requires a complete linked correction and normalizes checksums', () => {
        expect(createRetentionTriggerEventSchema.safeParse({
            arsipId: ARSIP_ID,
            eventType: 'berkas_ditutup',
            eventDate: '2026-08-20',
            label: 'Penutupan berkas final',
            evidenceUri: 'attachment:550e8400-e29b-41d4-a716-446655440099',
            evidenceSha256: HASH.toUpperCase(),
            correctionReason: 'Tanggal pada bukti sebelumnya salah ketik.',
        }).success).toBe(false);

        const valid = createRetentionTriggerEventSchema.safeParse({
            arsipId: ARSIP_ID,
            eventType: 'berkas_ditutup',
            eventDate: '2026-08-20',
            label: 'Penutupan berkas final',
            evidenceUri: 'attachment:550e8400-e29b-41d4-a716-446655440099',
            evidenceSha256: HASH.toUpperCase(),
        });
        expect(valid.success).toBe(true);
        if (valid.success) expect(valid.data.evidenceSha256).toBe(HASH);
    });

    it('requires meaningful independent verification notes', () => {
        expect(verifyRetentionTriggerEventSchema.safeParse({
            verdict: 'verified',
            note: 'ok',
        }).success).toBe(false);
        expect(verifyRetentionTriggerEventSchema.safeParse({
            verdict: 'verified',
            note: 'Bukti cocok dengan berita acara penutupan.',
        }).success).toBe(true);
    });

    it('rejects duplicate archive entries in a permanent-transfer manifest', () => {
        const item = {
            arsipId: ARSIP_ID,
            appraisalDecisionId: DECISION_ID,
            objectUri: `attachment:${ATTACHMENT_ID}`,
            objectSha256: HASH,
        };
        expect(createPermanentTransferManifestSchema.safeParse({
            manifestNumber: 'MANIFEST-001',
            destination: 'Unit Kearsipan Kementerian ATR/BPN',
            items: [item, item],
        }).success).toBe(false);
    });

    it('requires controlled attachment locators for transfer objects and events', () => {
        expect(createPermanentTransferManifestSchema.safeParse({
            manifestNumber: 'MANIFEST-001',
            destination: 'Unit Kearsipan Kementerian ATR/BPN',
            items: [{
                arsipId: ARSIP_ID,
                appraisalDecisionId: DECISION_ID,
                objectUri: 'urn:simsa:archive:object-1',
                objectSha256: HASH,
            }],
        }).success).toBe(false);
        expect(permanentTransferEventSchema.safeParse({
            eventAt: '2026-08-20T04:00:00.000Z',
            referenceNumber: 'BAST-001/2026',
            counterparty: 'Unit Kearsipan Kementerian ATR/BPN',
            documentUri: `attachment:${ATTACHMENT_ID}`,
            documentSha256: HASH,
        }).success).toBe(true);
    });

    it('validates complete maker-checker cancellation evidence', () => {
        expect(requestPermanentTransferCancellationSchema.safeParse({
            reason: 'salah',
        }).success).toBe(false);
        expect(requestPermanentTransferCancellationSchema.safeParse({
            reason: 'Manifest salah menyertakan berkas dan wajib disusun ulang.',
        }).success).toBe(true);
        expect(reviewPermanentTransferCancellationSchema.safeParse({
            verdict: 'approved',
            note: 'Bukti pembatalan sudah diperiksa.',
        }).success).toBe(true);
    });
});
