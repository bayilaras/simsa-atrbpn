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
vi.mock('../services/arsip.service', () => ({
    arsipService: {
        getExpiring: async () => resultQueue.shift() ?? [],
    },
}));

const { notificationService } = await import('../services/notification.service');
const UUID_1 = '550e8400-e29b-41d4-a716-446655440001';
const UUID_2 = '550e8400-e29b-41d4-a716-446655440002';
const NOTIFICATION_1 = `distribusi:${UUID_1}:awaiting_receipt:urgent`;
const NOTIFICATION_2 = `distribusi:${UUID_2}:awaiting_processing:warning`;

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
                    nomorBerkas: 'AR/001',
                    uraianBerkas: 'Arsip Test',
                    tanggalKadaluarsa: '2090-01-01',
                    retentionTriggerDate: '2085-01-01',
                    legalHold: false,
                    createdAt: new Date('2020-01-01'),
                },
            ]);
            enqueue([]);

            const result = await notificationService.getExpiringArchives('ditjen', 'user-1');
            expect(Array.isArray(result)).toBe(true);
        });

        it('should exclude held and missing-trigger archive notifications', async () => {
            enqueue([
                { id: 'eligible', tanggalKadaluarsa: '2090-01-01', retentionTriggerDate: '2085-01-01', legalHold: false, createdAt: new Date() },
                { id: 'held', tanggalKadaluarsa: '2090-01-01', retentionTriggerDate: '2085-01-01', legalHold: true, createdAt: new Date() },
                { id: 'missing-trigger', tanggalKadaluarsa: '2090-01-01', retentionTriggerDate: null, legalHold: false, createdAt: new Date() },
            ]);
            enqueue([]);

            const result = await notificationService.getExpiringArchives('ditjen', 'user-1');
            expect(result.map(item => item.referenceId)).toEqual(['eligible']);
        });

        it('should accept custom daysAhead parameter', async () => {
            enqueue([]);
            enqueue([]);

            const result = await notificationService.getExpiringArchives('ditjen', 'user-1', 180);
            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe('operational workflow notifications', () => {
        it('uses state and recalculated urgency in distribution notification IDs', async () => {
            enqueue([{
                id: UUID_1,
                status: 'sent',
                instruction: 'Mohon tindak lanjut',
                nomorSurat: 'SM-1',
                sentAt: new Date(Date.now() - 10 * 86_400_000),
                updatedAt: new Date(Date.now() - 10 * 86_400_000),
            }]);

            const result = await notificationService.getDistributionNotifications(
                'ditjen',
                'user-1',
                null,
                new Set(),
                'admin_dirjen',
            );
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                type: 'urgent',
                state: 'awaiting_receipt',
                category: 'distribusi',
            });
            expect(result[0].id).toContain(':awaiting_receipt:urgent');
        });

        it('does not emit workflow deep-links to a role that cannot open them', async () => {
            expect(await notificationService.getDistributionNotifications(
                'ditjen', 'staff-1', null, new Set(), 'staff',
            )).toEqual([]);
            expect(await notificationService.getRetentionVerificationNotifications(
                'ditjen', 'staff-1', null, new Set(), 'staff',
            )).toEqual([]);
            expect(await notificationService.getAppraisalNotifications(
                'ditjen', 'staff-1', 'staff', null, new Set(),
            )).toEqual([]);
        });

        it('honors the persisted application-notification opt-out', async () => {
            enqueue([], [{ notificationsEnabled: false }]);

            const result = await notificationService.getAllNotifications('ditjen', 'user-1');
            expect(result.notifications).toEqual([]);
            expect(result.counts.total).toBe(0);
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
                notificationService.markAsRead('user-1', NOTIFICATION_1)
            ).resolves.not.toThrow();
        });

        it('rejects malformed notification IDs before persistence', async () => {
            await expect(notificationService.markAsRead('user-1', 'arbitrary-key'))
                .rejects.toThrow('Format ID notifikasi');
        });
    });

    describe('markAllAsRead', () => {
        it('should not throw when marking multiple as read', async () => {
            enqueue(undefined);

            await expect(
                notificationService.markAllAsRead('user-1', [NOTIFICATION_1, NOTIFICATION_2])
            ).resolves.not.toThrow();
        });

        it('rejects a well-formed ID that is not emitted by the current producer state', async () => {
            enqueue([]); // no existing acknowledgement
            const allSpy = vi.spyOn(notificationService, 'getAllNotifications')
                .mockResolvedValueOnce({
                    notifications: [],
                    counts: {
                        total: 0, urgent: 0, warning: 0, info: 0,
                        suratMasuk: 0, arsipRetensi: 0, distribusi: 0,
                        verifikasiRetensi: 0, appraisal: 0, penyusutan: 0,
                        penyerahanPermanen: 0,
                    },
                });

            await expect(notificationService.markCurrentAsRead({
                unitKerjaId: 'ditjen',
                userId: 'user-1',
                userRole: 'admin_dirjen',
            }, [NOTIFICATION_1])).rejects.toThrow('tidak tersedia');
            allSpy.mockRestore();
        });

        it('should handle empty array gracefully', async () => {
            await expect(
                notificationService.markAllAsRead('user-1', [])
            ).resolves.not.toThrow();
        });
    });
});
