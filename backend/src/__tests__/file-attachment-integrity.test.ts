import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), download: vi.fn(), returned: vi.fn() }));
vi.mock('../config/database', () => ({ db: { select: mocks.select, update: mocks.update } }));
vi.mock('../services/blob-storage.service', () => ({ blobStorageService: { downloadFile: mocks.download } }));
import { fileAttachmentService } from '../services/file-attachment.service.js';

const content = Buffer.from('original');
const record = {
    id: '00000000-0000-4000-8000-000000000001',
    fileUrl: 'gs://private/record.pdf', driveFileId: null, objectGeneration: '12',
    storageAccess: 'private', sizeBytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
};

describe('attachment integrity state updates', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [record] }) }) });
        mocks.update.mockReturnValue({ set: () => ({ where: () => ({ returning: mocks.returned }) }) });
        mocks.returned.mockResolvedValue([{ ...record, integrityStatus: 'verified' }]);
        mocks.download.mockImplementation(async () => ({ stream: Readable.from([content]) }));
    });

    it('rejects a result whose baseline changed before it could be committed', async () => {
        mocks.returned.mockResolvedValue([]);
        await expect(fileAttachmentService.verifyIntegrity(record.id)).rejects.toThrow(/berubah/i);
    });

    it('does not verify matching content against an inconsistent size baseline', async () => {
        mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ ...record, sizeBytes: 100 }] }) }) });
        const result = await fileAttachmentService.verifyIntegrity(record.id);
        expect(result?.matches).toBe(false);
    });
});
