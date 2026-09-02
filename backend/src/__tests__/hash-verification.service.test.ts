import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirst = vi.hoisted(() => vi.fn());

vi.mock('../config/database.js', () => ({
    db: { query: { arsipElektronik: { findFirst } } },
}));
vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({ error: vi.fn() }),
}));

const { HashVerificationService } = await import('../services/hash-verification.service.js');

function eligibleRecord(hash: string) {
    return {
        id: 'electronic-1',
        arsipId: 'archive-1',
        statusVerifikasi: 'verified',
        immutable: true,
        createdAt: new Date('2026-08-28T00:00:00Z'),
        arsip: { nomorBerkas: 'B-1', uraianBerkas: 'Arsip terverifikasi' },
        autentikasi: null,
        fileAttachment: {
            fileUrl: 'https://fixture.private.blob.vercel-storage.com/archive.pdf',
            sha256: hash,
            storageAccess: 'private',
            integrityStatus: 'verified',
            malwareScanStatus: 'clean',
        },
    };
}

describe('HashVerificationService in-memory verification', () => {
    beforeEach(() => vi.clearAllMocks());

    it('claims authenticity only when record, fixity, private storage, and malware gates pass', async () => {
        const bytes = Buffer.from('%PDF-authentic');
        const hash = crypto.createHash('sha256').update(bytes).digest('hex');
        findFirst.mockResolvedValueOnce(eligibleRecord(hash));

        const result = await HashVerificationService.verifyUploadedBuffer(bytes);

        expect(result).toMatchObject({
            status: 'AUTHENTIC',
            data: { arsipId: 'archive-1', nomorBerkas: 'B-1' },
        });
    });

    it.each([
        ['pending verification', { statusVerifikasi: 'pending' }],
        ['mutable record', { immutable: false }],
        ['public storage', { fileAttachment: { storageAccess: 'public' } }],
        ['unverified fixity', { fileAttachment: { integrityStatus: 'unverified' } }],
        ['unclean malware state', { fileAttachment: { malwareScanStatus: 'not_scanned' } }],
        ['attachment digest mismatch', { fileAttachment: { sha256: '0'.repeat(64) } }],
    ])('fails closed without record data for %s', async (_label, override) => {
        const bytes = Buffer.from('%PDF-not-eligible');
        const hash = crypto.createHash('sha256').update(bytes).digest('hex');
        const baseline = eligibleRecord(hash);
        const record = {
            ...baseline,
            ...override,
            fileAttachment: {
                ...baseline.fileAttachment,
                ...(override as any).fileAttachment,
            },
        };
        findFirst.mockResolvedValueOnce(record);

        const result = await HashVerificationService.verifyUploadedBuffer(bytes);

        expect(result).toEqual({
            status: 'NOT_VERIFIED',
            message: 'Arsip belum memenuhi seluruh pemeriksaan integritas dan keamanan.',
        });
        expect(result).not.toHaveProperty('data');
    });

    it('returns unknown without record metadata when the digest is absent', async () => {
        findFirst.mockResolvedValueOnce(undefined);

        const result = await HashVerificationService.verifyUploadedBuffer(Buffer.from('%PDF-unknown'));

        expect(result.status).toBe('UNKNOWN');
        expect(result).not.toHaveProperty('data');
    });
});
