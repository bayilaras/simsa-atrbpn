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

const { auditLogService } = await import('../services/audit-log.service');

describe('AuditLogService', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        auditLogService._consecutiveFailures = 0;
    });

    // ==================== Pure Functions (no DB) ====================

    describe('getActionLabel', () => {
        it('should return Indonesian labels for known actions', () => {
            expect(auditLogService.getActionLabel('create')).toBe('Membuat');
            expect(auditLogService.getActionLabel('update')).toBe('Mengubah');
            expect(auditLogService.getActionLabel('delete')).toBe('Menghapus');
            expect(auditLogService.getActionLabel('cancel')).toBe('Membatalkan');
            expect(auditLogService.getActionLabel('archive')).toBe('Mengarsipkan');
            expect(auditLogService.getActionLabel('restore')).toBe('Memulihkan');
            expect(auditLogService.getActionLabel('status_change')).toBe('Mengubah Status');
        });

        it('should return distribution labels', () => {
            expect(auditLogService.getActionLabel('distribute')).toBe('Mendistribusikan');
            expect(auditLogService.getActionLabel('receive_distribution')).toBe('Menerima Distribusi');
            expect(auditLogService.getActionLabel('process_distribution')).toBe('Memproses Distribusi');
            expect(auditLogService.getActionLabel('reject_distribution')).toBe('Menolak Distribusi');
        });

        it('should return raw action string for unknown actions', () => {
            expect(auditLogService.getActionLabel('unknown_action')).toBe('unknown_action');
            expect(auditLogService.getActionLabel('')).toBe('');
        });
    });

    describe('getEntityTypeLabel', () => {
        it('should return Indonesian labels for known entity types', () => {
            expect(auditLogService.getEntityTypeLabel('surat_masuk')).toBe('Surat Masuk');
            expect(auditLogService.getEntityTypeLabel('surat_keluar')).toBe('Surat Keluar');
            expect(auditLogService.getEntityTypeLabel('arsip')).toBe('Arsip');
            expect(auditLogService.getEntityTypeLabel('user')).toBe('User');
        });

        it('should return label for distribution entity type', () => {
            expect(auditLogService.getEntityTypeLabel('surat_distribution')).toBe('Distribusi Surat');
        });

        it('should return label for autentikasi type', () => {
            expect(auditLogService.getEntityTypeLabel('autentikasi')).toBe('Autentikasi Alih Media');
        });

        it('should return raw entity type for unknown types', () => {
            expect(auditLogService.getEntityTypeLabel('unknown_type')).toBe('unknown_type');
        });
    });

    // ==================== DB-dependent methods ====================

    describe('logAction', () => {
        it('should not throw on successful insert', async () => {
            enqueue(undefined); // insert returns void
            await expect(
                auditLogService.logAction({
                    userId: 'user-1',
                    userEmail: 'test@x.com',
                    action: 'create',
                    entityType: 'surat_masuk',
                    entityId: 'surat-1',
                })
            ).resolves.not.toThrow();
        });

        it('should reset failure counter on success', async () => {
            auditLogService._consecutiveFailures = 3;
            enqueue(undefined);
            await auditLogService.logAction({
                action: 'update',
                entityType: 'arsip',
            });
            expect(auditLogService._consecutiveFailures).toBe(0);
        });

        it('should handle missing optional fields gracefully', async () => {
            enqueue(undefined);
            await expect(
                auditLogService.logAction({
                    action: 'delete',
                    entityType: 'user',
                    // no userId, userEmail, entityId, changes, ipAddress
                })
            ).resolves.not.toThrow();
        });
    });

    describe('listLogs', () => {
        it('should return paginated results with default params', async () => {
            // First call: count query
            enqueue([{ count: 2 }]);
            // Second call: data query
            enqueue([
                { id: '1', action: 'create', entityType: 'surat_masuk', createdAt: new Date() },
                { id: '2', action: 'update', entityType: 'arsip', createdAt: new Date() },
            ]);

            const result = await auditLogService.listLogs();
            expect(result).toHaveProperty('data');
            expect(result).toHaveProperty('pagination');
            expect(result.pagination.page).toBe(1);
            expect(result.pagination.limit).toBe(50);
            expect(result.pagination.total).toBe(2);
        });

        it('should calculate totalPages correctly', async () => {
            enqueue([{ count: 150 }]);
            enqueue([]);

            const result = await auditLogService.listLogs({ limit: 50 });
            expect(result.pagination.totalPages).toBe(3);
        });

        it('should accept filter parameters', async () => {
            enqueue([{ count: 0 }]);
            enqueue([]);

            const result = await auditLogService.listLogs({
                entityType: 'surat_masuk',
                action: 'create',
                userId: 'user-1',
                search: 'test',
                page: 2,
                limit: 10,
            });
            expect(result.pagination.page).toBe(2);
            expect(result.pagination.limit).toBe(10);
        });

        it('should handle date range filters', async () => {
            enqueue([{ count: 0 }]);
            enqueue([]);

            const result = await auditLogService.listLogs({
                startDate: new Date('2025-01-01'),
                endDate: new Date('2025-12-31'),
            });
            expect(result.data).toEqual([]);
        });
    });

    describe('getEntityHistory', () => {
        it('should return history for a specific entity', async () => {
            const history = [
                { id: '1', action: 'create', createdAt: new Date() },
                { id: '2', action: 'update', createdAt: new Date() },
            ];
            enqueue(history);

            const result = await auditLogService.getEntityHistory('surat_masuk', 'surat-1');
            expect(result).toHaveLength(2);
        });

        it('should return empty array when no history', async () => {
            enqueue([]);
            const result = await auditLogService.getEntityHistory('arsip', 'nonexistent');
            expect(result).toHaveLength(0);
        });
    });
});
