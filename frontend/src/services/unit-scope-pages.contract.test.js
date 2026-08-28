import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
    baseUrl: 'https://example.test',
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
}));

vi.mock('./api', () => ({ default: apiMock }));

import archiveLendingService from './archive-lending.service';
import { penyusutanService } from './penyusutan.service';
import reportService from './report.service';
import retentionService from './retention.service';
import storageLocationService from './storage-location.service';

const scopedPages = [
    '../pages/Laporan.jsx',
    '../pages/RetentionManagement.jsx',
    '../pages/PenyusutanArsip.jsx',
    '../pages/StorageLocations.jsx',
    '../pages/ArchiveLending.jsx',
];

describe('required unit scope page contracts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMock.get.mockResolvedValue({ success: true, data: [] });
        apiMock.put.mockResolvedValue({ success: true, data: {} });
    });

    it.each(scopedPages)('%s renders the shared fail-closed unit selector', (path) => {
        const source = readFileSync(new URL(path, import.meta.url), 'utf8');
        expect(source).toContain('useRequiredUnitKerjaScope');
        expect(source).toContain('<RequiredUnitKerjaScope');
        expect(source).toMatch(/if \(!unitKerjaId\)/);
    });

    it('sends the selected unit on every representative read and mutation', async () => {
        await reportService.getLendingReport({ unitKerjaId: 'unit-a', status: 'borrowed' });
        await retentionService.getSummary('unit-a');
        await penyusutanService.findById('batch-a', 'unit-a');
        await storageLocationService.getTree('unit-a');
        await archiveLendingService.getStats('unit-a');
        await penyusutanService.updateStatus('batch-a', 'unit-a');
        await storageLocationService.update('location-a', { name: 'Rak A' }, 'unit-a');
        await archiveLendingService.return('loan-a', 'unit-a', 'baik');

        expect(apiMock.get).toHaveBeenNthCalledWith(1, '/api/reports/lending', {
            unitKerjaId: 'unit-a', status: 'borrowed',
        });
        expect(apiMock.get).toHaveBeenNthCalledWith(2, '/api/retention/summary', { unitKerjaId: 'unit-a' });
        expect(apiMock.get).toHaveBeenNthCalledWith(3, '/api/penyusutan/batch-a', { unitKerjaId: 'unit-a' });
        expect(apiMock.get).toHaveBeenNthCalledWith(4, '/api/storage-locations/tree', { unitKerjaId: 'unit-a' });
        expect(apiMock.get).toHaveBeenNthCalledWith(5, '/api/archive-lending/stats', { unitKerjaId: 'unit-a' });
        expect(apiMock.put).toHaveBeenNthCalledWith(1, '/api/penyusutan/batch-a/status?unitKerjaId=unit-a', {});
        expect(apiMock.put).toHaveBeenNthCalledWith(2, '/api/storage-locations/location-a?unitKerjaId=unit-a', { name: 'Rak A' });
        expect(apiMock.put).toHaveBeenNthCalledWith(3, '/api/archive-lending/loan-a/return?unitKerjaId=unit-a', { notes: 'baik' });
    });

    it('rejects requests locally when no concrete unit is available', async () => {
        expect(() => reportService.getLendingReport({})).toThrow(/unitKerjaId wajib dipilih/);
        await expect(retentionService.getSummary('')).rejects.toThrow(/unitKerjaId wajib dipilih/);
        await expect(penyusutanService.findById('batch-a', '')).rejects.toThrow(/unitKerjaId wajib dipilih/);
        await expect(storageLocationService.getTree('')).rejects.toThrow(/unitKerjaId wajib dipilih/);
        await expect(archiveLendingService.getStats('')).rejects.toThrow(/unitKerjaId wajib dipilih/);
        expect(apiMock.get).not.toHaveBeenCalled();
    });
});
