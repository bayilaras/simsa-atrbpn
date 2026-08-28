import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
}));

vi.mock('./api', () => ({ default: apiMock }));

import bulkUploadService from './bulk-upload.service';
import dosirService from './dosir.service';
import { penyusutanService } from './penyusutan.service';
import { layananArsipService } from './layanan-arsip.service';
import { autentikasiService } from './autentikasi.service';
import { arsipVitalService } from './arsip-vital.service';
import { arsipTerjagaService } from './arsip-terjaga.service';
import { arsipElektronikService } from './arsip-elektronik.service';
import settingsService, { PREFERENCES_CHANGED_EVENT } from './settings.service';
import { notificationService } from './notification.service';
import { suratMasukService } from './surat-masuk.service';
import { suratKeluarService } from './surat-keluar.service';
import { distributionService } from './distribution.service';
import approvalService from './approval.service';

describe('frontend/API integration contracts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uploads PDF files to the mounted API prefix as browser FormData', async () => {
        const domain = { batchId: 'batch-1', totalFiles: 1, status: 'pending' };
        apiMock.post.mockResolvedValue({ success: true, data: domain });
        const file = new File(['pdf'], 'arsip.pdf', { type: 'application/pdf' });

        await expect(bulkUploadService.uploadFiles([file], 'unit-1')).resolves.toEqual(domain);

        expect(apiMock.post).toHaveBeenCalledWith('/api/bulk-upload', expect.any(FormData));
        const formData = apiMock.post.mock.calls[0][1];
        expect(formData.get('files')).toBe(file);
        expect(formData.get('unitKerjaId')).toBe('unit-1');
    });

    it('uses the POST processor and omits blank optional confirmation fields', async () => {
        apiMock.post.mockResolvedValue({ success: true, data: { status: 'completed' } });

        await bulkUploadService.processBatch('batch-1');
        await bulkUploadService.confirmBatch('batch-1', [{
            itemId: 'item-1',
            nomorBerkas: '  ',
            uraianBerkas: '',
            kodeKlasifikasi: '',
            tahun: 2026,
            jenisArsip: 'masuk',
        }]);

        expect(apiMock.post).toHaveBeenNthCalledWith(
            1,
            '/api/bulk-upload/batch-1/process',
            {},
        );
        expect(apiMock.post).toHaveBeenNthCalledWith(
            2,
            '/api/bulk-upload/batch-1/confirm',
            { items: [{ itemId: 'item-1', tahun: 2026, jenisArsip: 'masuk' }] },
        );
    });

    it('cancels a persisted batch through the authenticated API', async () => {
        const cleanup = { batchesExpired: 1, blobsDeleted: 1, blobsFailed: 0 };
        apiMock.delete.mockResolvedValue({ success: true, data: cleanup });

        await expect(bulkUploadService.cancelBatch('batch-1')).resolves.toEqual(cleanup);
        expect(apiMock.delete).toHaveBeenCalledWith('/api/bulk-upload/batch-1');
    });

    it('looks up the latest active batch in the selected owner/unit scope', async () => {
        const active = { batchId: 'batch-active', status: 'completed' };
        apiMock.get.mockResolvedValue({ success: true, data: active });

        await expect(bulkUploadService.getLatestActiveBatch('unit-1')).resolves.toEqual(active);
        expect(apiMock.get).toHaveBeenCalledWith('/api/bulk-upload/active', {
            unitKerjaId: 'unit-1',
        });
    });

    it('passes query parameters directly for OCR search and dosir filters', async () => {
        apiMock.get.mockResolvedValue({ success: true, data: [] });

        await bulkUploadService.searchFullText('tanah', 'unit-1', { page: 2 });
        await dosirService.getAll({ search: 'perkara', status: 'open', unitKerjaId: 'unit-1' });
        await dosirService.getStats('unit-1');

        expect(apiMock.get).toHaveBeenNthCalledWith(1, '/api/arsip/search/fulltext', {
            q: 'tanah', unitKerjaId: 'unit-1', page: 2,
        });
        expect(apiMock.get).toHaveBeenNthCalledWith(2, '/api/dosir', {
            search: 'perkara', status: 'open', unitKerjaId: 'unit-1',
        });
        expect(apiMock.get).toHaveBeenNthCalledWith(3, '/api/dosir/stats', {
            unitKerjaId: 'unit-1',
        });
    });

    it('returns one normalized domain layer for list and detail services', async () => {
        const rows = [{ id: 'one' }];
        const detail = { id: 'one', status: 'draft' };
        apiMock.get
            .mockResolvedValueOnce({ success: true, data: rows })
            .mockResolvedValueOnce({ success: true, data: detail })
            .mockResolvedValueOnce({ success: true, data: rows })
            .mockResolvedValueOnce({ success: true, data: rows });

        await expect(penyusutanService.findAll({ unitKerjaId: 'unit-1' })).resolves.toEqual(rows);
        await expect(penyusutanService.findById('one', 'unit-1')).resolves.toEqual(detail);
        await expect(layananArsipService.getAll({ status: 'diajukan' })).resolves.toEqual(rows);
        await expect(autentikasiService.getAll({ page: 1 })).resolves.toEqual(rows);
    });

    it('downloads the authentication PDF with credentials through the API transport', async () => {
        const pdf = new Blob(['pdf'], { type: 'application/pdf' });
        apiMock.get.mockResolvedValue(pdf);

        await expect(autentikasiService.getPdf('record-1')).resolves.toBe(pdf);
        expect(apiMock.get).toHaveBeenCalledWith(
            '/api/autentikasi/record-1/pdf',
            {},
            { responseType: 'blob' },
        );
    });

    it('requests only server-qualified records for the authentication picker', async () => {
        const result = { data: [], total: 0 };
        apiMock.get.mockResolvedValue(result);

        await expect(arsipElektronikService.getAll({
            limit: 100,
            eligibleForAutentikasi: true,
        })).resolves.toEqual(result);
        expect(apiMock.get).toHaveBeenCalledWith('/api/arsip-elektronik', {
            limit: 100,
            eligibleForAutentikasi: true,
        });
    });

    it.each([
        ['vital', arsipVitalService, '/api/arsip-vital/print/daftar'],
        ['terjaga', arsipTerjagaService, '/api/arsip-terjaga/print/daftar'],
    ])('requests the %s PDF as a blob', async (_name, service, endpoint) => {
        const pdf = new Blob(['pdf'], { type: 'application/pdf' });
        apiMock.get.mockResolvedValue(pdf);

        await expect(service.printDaftar('unit-1')).resolves.toBe(pdf);
        expect(apiMock.get).toHaveBeenCalledWith(endpoint, { unitKerjaId: 'unit-1' }, { responseType: 'blob' });
    });

    it('publishes updated account preferences to live consumers', async () => {
        const preferences = {
            theme: 'dark', language: 'id', notificationsEnabled: false, emailNotifications: false,
        };
        apiMock.put.mockResolvedValue(preferences);
        const listener = vi.fn();
        window.addEventListener(PREFERENCES_CHANGED_EVENT, listener);

        await expect(settingsService.updatePreferences({ theme: 'dark' })).resolves.toEqual(preferences);

        expect(apiMock.put).toHaveBeenCalledWith('/api/settings/preferences', { theme: 'dark' });
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: preferences }));
        window.removeEventListener(PREFERENCES_CHANGED_EVENT, listener);
    });

    it('can request only units editable by the current settings administrator', async () => {
        apiMock.get.mockResolvedValue([{ id: 'unit-1', name: 'Unit 1' }]);

        await settingsService.getAllUnitKerja({ editable: true });

        expect(apiMock.get).toHaveBeenCalledWith('/api/settings/unit-kerja', {
            editable: true,
        });
    });

    it('scopes template reads and writes to one concrete unit', async () => {
        const templates = { masukFormat: '{noUrut}/SM/{tahun}', keluarFormat: '{noUrut}/SK/{tahun}' };
        apiMock.get.mockResolvedValue(templates);
        apiMock.put.mockResolvedValue(templates);

        await settingsService.getSuratTemplates('unit-a');
        await settingsService.updateSuratTemplates('unit-a', templates);

        expect(apiMock.get).toHaveBeenCalledWith('/api/settings/surat-templates', {
            unitKerjaId: 'unit-a',
        });
        expect(apiMock.put).toHaveBeenCalledWith('/api/settings/surat-templates', {
            ...templates,
            unitKerjaId: 'unit-a',
        });
    });

    it('normalizes distribution data once and sends unit scope on every action', async () => {
        const rows = [{ id: 'dist-1' }];
        const stats = { inbox: { total: 1 }, outbox: { total: 0 } };
        apiMock.get
            .mockResolvedValueOnce({ success: true, data: rows })
            .mockResolvedValueOnce({ success: true, data: rows })
            .mockResolvedValueOnce({ success: true, data: stats });
        apiMock.put.mockResolvedValue({ success: true, data: { id: 'dist-1' } });

        await expect(distributionService.getInbox('unit-a')).resolves.toEqual(rows);
        await expect(distributionService.getOutbox('unit-a')).resolves.toEqual(rows);
        await expect(distributionService.getStats('unit-a')).resolves.toEqual(stats);
        await distributionService.receive('dist-1', 'unit-a');
        await distributionService.process('dist-1', 'unit-a');
        await distributionService.reject('dist-1', 'Alasan', 'unit-a');

        expect(apiMock.get).toHaveBeenNthCalledWith(1, '/api/distributions/inbox', { unitKerjaId: 'unit-a' });
        expect(apiMock.get).toHaveBeenNthCalledWith(2, '/api/distributions/outbox', { unitKerjaId: 'unit-a' });
        expect(apiMock.get).toHaveBeenNthCalledWith(3, '/api/distributions/stats', { unitKerjaId: 'unit-a' });
        expect(apiMock.put).toHaveBeenNthCalledWith(1, '/api/distributions/dist-1/receive?unitKerjaId=unit-a');
        expect(apiMock.put).toHaveBeenNthCalledWith(2, '/api/distributions/dist-1/process?unitKerjaId=unit-a');
        expect(apiMock.put).toHaveBeenNthCalledWith(3, '/api/distributions/dist-1/reject?unitKerjaId=unit-a', { reason: 'Alasan' });
    });

    it('connects the outgoing-letter approval workflow without a signature endpoint', async () => {
        const approvers = [{ id: 'approver-1', name: 'Penyetuju' }];
        apiMock.get
            .mockResolvedValueOnce({ success: true, data: approvers })
            .mockResolvedValueOnce({ success: true, data: [] });
        apiMock.post.mockResolvedValue({ success: true, data: { id: 'request-1' } });

        await expect(approvalService.getEligibleApprovers('surat 1')).resolves.toEqual(approvers);
        await expect(approvalService.getHistory('surat 1')).resolves.toEqual([]);
        await approvalService.submit('surat-1', 'approver-1', ' Mohon telaah ');
        await approvalService.approve('surat-1', ' Layak ');
        await approvalService.reject('surat-1', ' Perlu koreksi ');

        expect(apiMock.get).toHaveBeenNthCalledWith(1, '/api/approval/approvers/surat%201');
        expect(apiMock.get).toHaveBeenNthCalledWith(2, '/api/approval/history/surat%201');
        expect(apiMock.post).toHaveBeenNthCalledWith(1, '/api/approval/submit', {
            suratId: 'surat-1', nextApproverId: 'approver-1', notes: 'Mohon telaah',
        });
        expect(apiMock.post).toHaveBeenNthCalledWith(2, '/api/approval/approve', {
            suratId: 'surat-1', notes: 'Layak',
        });
        expect(apiMock.post).toHaveBeenNthCalledWith(3, '/api/approval/reject', {
            suratId: 'surat-1', notes: 'Perlu koreksi',
        });
        expect(apiMock.post.mock.calls.some(([endpoint]) => endpoint.includes('/sign'))).toBe(false);
    });

    it('encodes structured notification IDs before placing them in a route path', async () => {
        apiMock.request.mockResolvedValue({ success: true });

        await notificationService.markAsRead('workflow:item:state with space', 'unit-a');

        expect(apiMock.request).toHaveBeenCalledWith(
            '/api/notifications/workflow%3Aitem%3Astate%20with%20space/read?unitKerjaId=unit-a',
            { method: 'PATCH' },
        );
    });

    it('returns formatted surat-number previews with their template context intact', async () => {
        const masukPreview = {
            nextNumber: 8,
            nomorSurat: '008/SM/08/2026',
            template: '{noUrut}/SM/{bulan}/{tahun}',
            tahun: 2026,
            bulan: 8,
            preview: true,
        };
        const keluarPreview = {
            nextNumber: 9,
            nomorSurat: '009/ND/08/2026',
            template: '{noUrut}/{naskahDinas}/{bulan}/{tahun}',
            tahun: 2026,
            bulan: 8,
            preview: true,
        };
        apiMock.get
            .mockResolvedValueOnce({ success: true, data: masukPreview })
            .mockResolvedValueOnce({ success: true, data: keluarPreview });

        await expect(suratMasukService.getNextNumber({
            unitKerjaId: 'unit-1', tahun: 2026, tanggalSurat: '2026-08-17',
        })).resolves.toEqual(masukPreview);
        await expect(suratKeluarService.getNextNumber({
            unitKerjaId: 'unit-1', tahun: 2026, tanggalSurat: '2026-08-17', naskahDinas: 'ND',
        })).resolves.toEqual(keluarPreview);

        expect(apiMock.get).toHaveBeenNthCalledWith(1, '/api/surat-masuk/next-number', {
            unitKerjaId: 'unit-1', tahun: 2026, tanggalSurat: '2026-08-17',
        });
        expect(apiMock.get).toHaveBeenNthCalledWith(2, '/api/surat-keluar/next-number', {
            unitKerjaId: 'unit-1', tahun: 2026, tanggalSurat: '2026-08-17', naskahDinas: 'ND',
        });
    });
});
