import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { suratMasukService } from '../services/surat-masuk.service';
import { suratKeluarService } from '../services/surat-keluar.service';

const mocked = vi.hoisted(() => ({ upload: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../services/blob-upload.service', () => ({ uploadFileToBlob: mocked.upload }));
vi.mock('../services/api', () => ({ default: { post: mocked.post, put: mocked.put } }));

describe('surat upload picker contract', () => {
    it.each(['TambahSuratMasuk', 'TambahSuratKeluar'])('%s advertises only the supported file formats', (page) => {
        const sourcePath = `../pages/${page}.jsx`;
        const source = readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
        expect(source).toContain('accept=".pdf,application/pdf"');
        expect(source).toContain('PDF (maks. 10 MiB)');
        expect(source).not.toContain('PNG, ZIP, RAR');
    });
});

describe('surat upload failure propagation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it.each([
        ['masuk create', (data, file) => suratMasukService.create(data, file)],
        ['masuk update', (data, file) => suratMasukService.update('record-id', data, file)],
        ['keluar create', (data, file) => suratKeluarService.create(data, file)],
        ['keluar update', (data, file) => suratKeluarService.update('record-id', data, file)],
    ])('%s preserves actionable upload errors and never saves incomplete metadata', async (_name, save) => {
        const error = Object.assign(new Error('Unggah berkas melewati batas waktu. Periksa koneksi internet, lalu coba unggah kembali.'), { code: 'UPLOAD_TIMEOUT' });
        mocked.upload.mockRejectedValueOnce(error);
        await expect(save({ perihal: 'Surat' }, new File(['pdf'], 'surat.pdf', { type: 'application/pdf' })))
            .rejects.toBe(error);
        expect(mocked.post).not.toHaveBeenCalled();
        expect(mocked.put).not.toHaveBeenCalled();
    });

    it.each([
        ['masuk create', (data, file) => suratMasukService.create(data, file), 'post', '/api/surat-masuk'],
        ['masuk update', (data, file) => suratMasukService.update('record-id', data, file), 'put', '/api/surat-masuk/record-id'],
        ['keluar create', (data, file) => suratKeluarService.create(data, file), 'post', '/api/surat-keluar'],
        ['keluar update', (data, file) => suratKeluarService.update('record-id', data, file), 'put', '/api/surat-keluar/record-id'],
    ])('%s allows sixty seconds for file registration and keeps the metadata-only default', async (_name, save, method, endpoint) => {
        mocked[method].mockResolvedValue({ data: { id: 'record-id' } });
        mocked.upload.mockResolvedValue({ url: 'https://private.blob.vercel-storage.com/surat.pdf' });
        const data = { perihal: 'Surat' };
        await save(data, null);
        expect(mocked[method]).toHaveBeenLastCalledWith(endpoint, data);
        expect(mocked.upload).not.toHaveBeenCalled();

        await save(data, new File(['pdf'], 'surat.pdf', { type: 'application/pdf' }));
        expect(mocked[method]).toHaveBeenLastCalledWith(endpoint, {
            ...data, filePath: 'https://private.blob.vercel-storage.com/surat.pdf', fileOriginalName: 'surat.pdf',
        }, { timeoutMs: 60_000 });

        await save({ ...data, filePath: 'https://private.blob.vercel-storage.com/already-uploaded.pdf' }, null);
        expect(mocked[method]).toHaveBeenLastCalledWith(endpoint, expect.objectContaining({ filePath: expect.stringContaining('already-uploaded.pdf') }), { timeoutMs: 60_000 });
        expect(mocked.upload).toHaveBeenCalledOnce();
    });
});
