import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
function enqueue(...results: any[]) { resultQueue.push(...results); }

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const val = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(val);
        }
        return (..._args: any[]) => mockChain;
    },
});

const mockDb = {
    select: (..._a: any[]) => mockChain,
    insert: (..._a: any[]) => mockChain,
    update: (..._a: any[]) => mockChain,
    delete: (..._a: any[]) => mockChain,
};

vi.mock('../config/database', () => ({ db: mockDb }));

const { dashboardService } = await import('../services/dashboard.service');

describe('DashboardService', () => {
    beforeEach(() => {
        resultQueue.length = 0;
    });

    describe('getStats', () => {
        it('should return dashboard stats object', async () => {
            // Mock the parallel count queries
            // totalMasuk, totalKeluar, totalArsip, arsipMasuk, arsipKeluar, segmenKadaluarsa
            // masukBulanIni, keluarBulanIni, monthlyTrend, statusBreakdown
            enqueue([{ count: 50 }]);   // totalMasuk
            enqueue([{ count: 30 }]);   // totalKeluar
            enqueue([{ count: 25 }]);   // totalArsip
            enqueue([{ count: 15 }]);   // arsipMasuk
            enqueue([{ count: 10 }]);   // arsipKeluar
            enqueue([{ count: 5 }]);    // segmenKadaluarsa
            enqueue([{ count: 8 }]);    // masukBulanIni
            enqueue([{ count: 4 }]);    // keluarBulanIni
            enqueue([]);                 // monthly trend
            enqueue([]);                 // masuk status breakdown
            enqueue([]);                 // keluar status breakdown

            const result = await dashboardService.getStats();
            expect(result).toHaveProperty('totalMasuk');
            expect(result).toHaveProperty('totalKeluar');
            expect(result).toHaveProperty('totalArsip');
            expect(result).toHaveProperty('masukBulanIni');
            expect(result).toHaveProperty('keluarBulanIni');
            expect(result).toHaveProperty('monthlyTrend');
        });

        it('should accept optional unitKerjaId filter', async () => {
            // Same mock pattern, filtered by unitKerjaId
            for (let i = 0; i < 11; i++) {
                enqueue(i < 8 ? [{ count: 0 }] : []);
            }

            const result = await dashboardService.getStats('ditjen');
            expect(result).toHaveProperty('totalMasuk');
            expect(result.totalMasuk).toBe(0);
        });

        it('should accept optional tahun parameter', async () => {
            for (let i = 0; i < 11; i++) {
                enqueue(i < 8 ? [{ count: 0 }] : []);
            }

            const result = await dashboardService.getStats(null, 2024);
            expect(result).toHaveProperty('totalMasuk');
        });
    });

    describe('getRecentActivity', () => {
        it('should return an array of recent activities', async () => {
            const activities = [
                { id: '1', type: 'surat_masuk', createdAt: new Date() },
                { id: '2', type: 'surat_keluar', createdAt: new Date() },
            ];
            enqueue(activities); // masuk query
            enqueue([]);         // keluar query

            const result = await dashboardService.getRecentActivity();
            expect(Array.isArray(result)).toBe(true);
        });

        it('should accept limit parameter', async () => {
            enqueue([]);
            enqueue([]);

            const result = await dashboardService.getRecentActivity(null, 5);
            expect(Array.isArray(result)).toBe(true);
        });

        it('should accept unitKerjaId filter', async () => {
            enqueue([]);
            enqueue([]);

            const result = await dashboardService.getRecentActivity('ditjen');
            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe('getExpiringArchives', () => {
        it('should return expiring archives array', async () => {
            enqueue([
                { id: 'arsip-1', retentionDate: new Date('2025-06-01') },
            ]);

            const result = await dashboardService.getExpiringArchives();
            expect(Array.isArray(result)).toBe(true);
        });

        it('should accept daysAhead parameter', async () => {
            enqueue([]);

            const result = await dashboardService.getExpiringArchives(null, 90);
            expect(Array.isArray(result)).toBe(true);
        });

        it('should return empty array when no expiring archives', async () => {
            enqueue([]);

            const result = await dashboardService.getExpiringArchives();
            expect(result).toHaveLength(0);
        });
    });

    describe('getUnitKerjaComparison', () => {
        it('should return comparison data', async () => {
            // Mock unit kerja list + count queries
            enqueue([
                { id: 'ditjen', name: 'Ditjen PTPP' },
                { id: 'sesditjen', name: 'Sesditjen' },
            ]);
            // Count queries for each unit kerja
            enqueue([{ count: 10 }]); // ditjen masuk
            enqueue([{ count: 5 }]);  // ditjen keluar
            enqueue([{ count: 3 }]);  // ditjen arsip
            enqueue([{ count: 8 }]);  // sesditjen masuk
            enqueue([{ count: 4 }]);  // sesditjen keluar
            enqueue([{ count: 2 }]);  // sesditjen arsip

            const result = await dashboardService.getUnitKerjaComparison();
            expect(Array.isArray(result)).toBe(true);
        });

        it('should accept unitKerjaId filter', async () => {
            enqueue([{ id: 'ditjen', name: 'Ditjen PTPP' }]);
            enqueue([{ count: 10 }]);
            enqueue([{ count: 5 }]);
            enqueue([{ count: 3 }]);

            const result = await dashboardService.getUnitKerjaComparison('ditjen');
            expect(Array.isArray(result)).toBe(true);
        });
    });
});
