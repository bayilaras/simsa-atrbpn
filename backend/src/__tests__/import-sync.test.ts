import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('../services/record-access.service.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../services/record-access.service.js')>()),
    recordAccessService: { check: mocks.check },
}));
import { SYNC_REASONS, syncImportedLetter, type ImportSyncTarget } from '../services/import-sync.js';
import { updateSuratKeluarSchema } from '../validators/schemas.js';
import { ConflictError } from '../utils/errors.js';

const actor = { id: 'admin', role: 'admin_unit', unitKerjaId: 'unit-a' };
const audit = { userId: 'admin' };
const letter = (fields: Record<string, unknown> = {}) => ({ id: 'letter-1', isDeleted: false, isArchived: false, approvalStatus: 'draft',
    classification: 'biasa', values: { perihal: 'Lama', sifatSurat: 'biasa' }, ...fields });
const update = vi.fn();
const target: ImportSyncTarget = { entityType: 'surat_keluar', updateSchema: updateSuratKeluarSchema, update };
const sync = (matches: ReturnType<typeof letter>[], source: Record<string, string>) =>
    syncImportedLetter(target, matches, source, { actor }, 'unit-a', audit);

beforeEach(() => {
    vi.clearAllMocks();
    mocks.check.mockResolvedValue({ allowed: true, mutable: true });
    update.mockResolvedValue({ id: 'letter-1' });
});

describe('sinkron of one recorded letter', () => {
    it('sends only the changed fields with their earlier values for the audit trail', async () => {
        expect(await sync([letter()], { perihal: 'Baru', sifatSurat: 'biasa' })).toEqual({ status: 'updated',
            changes: [{ field: 'perihal', label: 'Perihal', before: 'Lama', after: 'Baru' }] });
        expect(update).toHaveBeenCalledWith('letter-1', { perihal: 'Baru' }, 'unit-a', audit, { sumber: 'impor_sinkron', before: { perihal: 'Lama' } });
    });

    it('leaves an identity matching several letters alone', async () => {
        expect(await sync([letter(), letter({ id: 'letter-2' })], { perihal: 'Baru' }))
            .toEqual({ status: 'locked', reason: SYNC_REASONS.ambiguous(2) });
        expect(update).not.toHaveBeenCalled();
    });

    it('applies the update schema of the PUT route', async () => {
        const outcome = await sync([letter()], { perihal: 'x'.repeat(2001) });
        expect(outcome).toMatchObject({ status: 'locked', reason: expect.stringMatching(/^Tidak diperbarui: /) });
        expect(update).not.toHaveBeenCalled();
    });

    it('reports a letter whose state changed after the lookup', async () => {
        update.mockResolvedValueOnce(undefined);
        expect(await sync([letter()], { perihal: 'Baru' })).toMatchObject({ status: 'locked', reason: SYNC_REASONS.changedMeanwhile });
    });

    it('reports a rejection by the canonical update with its public message', async () => {
        update.mockRejectedValueOnce(new ConflictError('Surat ini bagian dari berkas rangkaian yang sudah diberkaskan.'));
        expect(await sync([letter()], { perihal: 'Baru' })).toMatchObject({ status: 'locked',
            reason: 'Tidak diperbarui: Surat ini bagian dari berkas rangkaian yang sudah diberkaskan.' });
        update.mockRejectedValueOnce(new Error('connection reset by peer'));
        expect(await sync([letter()], { perihal: 'Baru' })).toMatchObject({ reason: 'Tidak diperbarui: Terjadi kesalahan pada server.' });
    });

    it('neither compares nor reports a letter of a classification the user may not read', async () => {
        mocks.check.mockResolvedValueOnce({ allowed: false, mutable: false });
        expect(await sync([letter({ classification: 'terbatas' })], { perihal: 'Lama' })).toEqual({ status: 'locked', reason: SYNC_REASONS.noAccess });
        expect(mocks.check).toHaveBeenCalledWith(actor, 'surat_keluar', 'letter-1');
        expect(update).not.toHaveBeenCalled();
    });

    it('checks access only for a changed letter of an ordinary classification', async () => {
        expect(await sync([letter()], { perihal: 'Lama' })).toEqual({ status: 'duplicate', reason: SYNC_REASONS.unchanged });
        expect(mocks.check).not.toHaveBeenCalled();
    });
});
