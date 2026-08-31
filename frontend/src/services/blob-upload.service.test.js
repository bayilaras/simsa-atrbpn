import { describe, expect, it, vi } from 'vitest';
import {
    assertTrustedGcsSessionUrl,
    resolveGcsUploadPurpose,
    uploadFileToGcs,
    waitForPendingUpload,
} from './blob-upload.service';

describe('GCS direct upload bridge', () => {
    it('maps existing business folders to backend upload purposes', () => {
        expect(resolveGcsUploadPurpose({ folder: 'surat-masuk' })).toBe('surat_masuk');
        expect(resolveGcsUploadPurpose({ folder: 'surat-keluar' })).toBe('surat_keluar');
        expect(resolveGcsUploadPurpose({ purpose: 'regulatory_source' })).toBe('regulatory_source');
        expect(() => resolveGcsUploadPurpose({ folder: 'misc' })).toThrow(/tidak didukung/);
    });

    it('accepts only HTTPS Google Storage resumable session hosts', () => {
        expect(assertTrustedGcsSessionUrl('https://storage.googleapis.com/upload/storage/v1/b/x'))
            .toMatch(/^https:\/\/storage\.googleapis\.com/);
        expect(() => assertTrustedGcsSessionUrl('https://storage.googleapis.com.evil.example/upload'))
            .toThrow(/tidak dipercaya/);
        expect(() => assertTrustedGcsSessionUrl('http://storage.googleapis.com/upload'))
            .toThrow(/tidak dipercaya/);
    });

    it('creates an intent, uploads directly, and returns only a pending lease', async () => {
        const apiClient = {
            post: vi.fn().mockResolvedValue({
                uploadId: 'upload-id',
                locator: 'gcs://private-bucket/object.pdf#1',
                resumableSessionUri: 'https://storage.googleapis.com/upload/storage/v1/b/private-bucket',
                requiredHeaders: { 'Content-Type': 'application/pdf' },
            }),
        };
        const uploadTransport = vi.fn().mockResolvedValue(undefined);
        const waitForPending = vi.fn().mockResolvedValue({ status: 'pending' });
        const file = new File(['pdf'], 'source.pdf', { type: 'application/pdf' });

        await expect(uploadFileToGcs(file, {
            purpose: 'regulatory_source',
            ruleSetId: 'rule-set-id',
            apiClient,
            uploadTransport,
            waitForPending,
        })).resolves.toEqual({
            url: 'gcs://private-bucket/object.pdf#1',
            downloadUrl: 'gcs://private-bucket/object.pdf#1',
            pathname: 'gcs://private-bucket/object.pdf#1',
            uploadId: 'upload-id',
            status: 'pending',
        });
        expect(apiClient.post).toHaveBeenCalledWith('/api/object-uploads', {
            purpose: 'regulatory_source',
            fileName: 'source.pdf',
            contentType: 'application/pdf',
            sizeBytes: file.size,
            ruleSetId: 'rule-set-id',
        });
        expect(uploadTransport).toHaveBeenCalledOnce();
        expect(waitForPending).toHaveBeenCalledWith('upload-id', {
            apiClient,
            signal: undefined,
        });
    });

    it('polls until Eventarc marks an authorized upload pending', async () => {
        const apiClient = {
            get: vi.fn()
                .mockResolvedValueOnce({ status: 'authorized' })
                .mockResolvedValueOnce({ status: 'pending' }),
        };
        const sleepFn = vi.fn().mockResolvedValue(undefined);

        await expect(waitForPendingUpload('upload-id', {
            apiClient,
            sleepFn,
            now: () => 1,
        })).resolves.toEqual({ status: 'pending' });
        expect(apiClient.get).toHaveBeenCalledTimes(2);
        expect(sleepFn).toHaveBeenCalledOnce();
    });
});
