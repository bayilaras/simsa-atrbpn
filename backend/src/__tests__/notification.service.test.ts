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
    query: {
        notificationReads: {
            findFirst: async () => resultQueue.shift() ?? null,
        },
    },
};

vi.mock('../config/database', () => ({ db: mockDb }));

const { notificationService } = await import('../services/notification.service');

describe('NotificationService', () => {
    beforeEach(() => {
        resultQueue.length = 0;
    });

    describe('getPendingSuratMasuk', () => {
        it('should return notifications for pending surat masuk', async () => {
            // Mock surat masuk query
            enqueue([
                {
                    id: 'sm-1',
                    noSurat: 'SM/001/2025',
                    perihal: 'Test Perihal',
                    tanggalSurat: new Date('2025-01-15'),
                    status: 'diterima',
                    diarsipkan: false,
                    sudahDibalas: false,
                },
            ]);
            // Mock read status query
            enqueue([]);

            const result = await notificationService.getPendingSuratMasuk('ditjen', 'user-1');
            expect(Array.isArray(result)).toBe(true);
        });

        it('should return empty when all surat processed', async () => {
            enqueue([]);
            enqueue([]);

            const result = await notificationService.getPendingSuratMasuk('ditjen', 'user-1');
            expect(result).toHaveLength(0);
        });
    });

    describe('getExpiringArchives', () => {
        it('should return notifications for expiring archives', async () => {
            enqueue([
                {
                    id: 'arsip-1',
                    noSurat: 'AR/001',
                    perihal: 'Arsip Test',
                    retensiAktif: 5,
                    retensiInaktif: 10,
                    createdAt: new Date('2020-01-01'),
                },
            ]);
            enqueue([]);

            const result = await notificationService.getExpiringArchives('ditjen', 'user-1');
            expect(Array.isArray(result)).toBe(true);
        });

        it('should accept custom daysAhead parameter', async () => {
            enqueue([]);
            enqueue([]);

            const result = await notificationService.getExpiringArchives('ditjen', 'user-1', 180);
            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe('getAllNotifications', () => {
        it('should return notifications and counts object', async () => {
            // getPendingSuratMasuk mocks
            enqueue([]);
            enqueue([]);
            // getExpiringArchives mocks
            enqueue([]);
            enqueue([]);

            const result = await notificationService.getAllNotifications('ditjen', 'user-1');
            expect(result).toHaveProperty('notifications');
            expect(result).toHaveProperty('counts');
            expect(Array.isArray(result.notifications)).toBe(true);
        });

        it('should include separate counts per category', async () => {
            enqueue([]);
            enqueue([]);
            enqueue([]);
            enqueue([]);

            const result = await notificationService.getAllNotifications('ditjen', 'user-1');
            expect(result.counts).toHaveProperty('total');
            expect(result.counts).toHaveProperty('urgent');
            expect(result.counts).toHaveProperty('warning');
            expect(result.counts).toHaveProperty('suratMasuk');
            expect(result.counts).toHaveProperty('arsipRetensi');
        });

        it('should accept limit parameter', async () => {
            enqueue([]);
            enqueue([]);
            enqueue([]);
            enqueue([]);

            const result = await notificationService.getAllNotifications('ditjen', 'user-1', 5);
            expect(result.notifications).toHaveLength(0);
        });
    });

    describe('getNotificationCount', () => {
        it('should return count summary', async () => {
            enqueue([]);
            enqueue([]);
            enqueue([]);
            enqueue([]);

            const result = await notificationService.getNotificationCount('ditjen', 'user-1');
            expect(result).toHaveProperty('total');
            expect(result).toHaveProperty('urgent');
            expect(result).toHaveProperty('warning');
            expect(result).toHaveProperty('suratMasuk');
            expect(result).toHaveProperty('arsipRetensi');
            expect(typeof result.total).toBe('number');
        });
    });

    describe('markAsRead', () => {
        it('should not throw when marking notification as read', async () => {
            enqueue(undefined);

            await expect(
                notificationService.markAsRead('user-1', 'notif-1')
            ).resolves.not.toThrow();
        });
    });

    describe('markAllAsRead', () => {
        it('should not throw when marking multiple as read', async () => {
            enqueue(undefined);
            enqueue(undefined);

            await expect(
                notificationService.markAllAsRead('user-1', ['notif-1', 'notif-2'])
            ).resolves.not.toThrow();
        });

        it('should handle empty array gracefully', async () => {
            await expect(
                notificationService.markAllAsRead('user-1', [])
            ).resolves.not.toThrow();
        });
    });
});
