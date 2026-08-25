import { db } from '../config/database';
import { auditLog, users } from '../db/schema';
import { eq, and, desc, sql, gte, lte, ilike, or } from 'drizzle-orm';
import { createLogger } from '../utils/logger';

const log = createLogger('AuditLogService');

export interface LogActionData {
    userId?: string;
    userEmail?: string;
    action: 'create' | 'update' | 'delete' | 'cancel' | 'archive' | 'restore' | 'status_change' | 'distribute' | 'receive_distribution' | 'process_distribution' | 'reject_distribution' | 'view' | 'download' | 'verify_integrity' | 'hold' | 'release_hold' | 'request_access' | 'approve_access' | 'deny_access' | 'revoke_access';
    entityType: 'surat_masuk' | 'surat_keluar' | 'arsip' | 'user' | 'storage_location' | 'archive_lending' | 'surat_distribution' | 'autentikasi' | 'layanan_arsip' | 'dosir' | 'penyusutan' | 'file_attachment' | 'arsip_elektronik' | 'tunjuk_silang' | 'record_access_grant';
    entityId?: string;
    changes?: {
        before?: Record<string, any>;
        after?: Record<string, any>;
        fields?: string[];
        [key: string]: any;
    };
    ipAddress?: string;
}

export interface AuditLogFilters {
    entityType?: string;
    entityId?: string;
    action?: string;
    userId?: string;
    search?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
}

export const auditLogService = {
    // Track consecutive audit failures for alerting
    _consecutiveFailures: 0 as number,

    /**
     * Log an action to audit trail
     */
    async logAction(data: LogActionData): Promise<void> {
        try {
            await db.insert(auditLog).values({
                userId: data.userId || null,
                userEmail: data.userEmail || null,
                action: data.action,
                entityType: data.entityType,
                entityId: data.entityId || null,
                changes: data.changes || null,
                ipAddress: data.ipAddress || null,
            });
            // Reset failure counter on success
            auditLogService._consecutiveFailures = 0;
        } catch (error) {
            log.error({ err: error }, 'Failed to log audit action:');
            // Track consecutive failures - alert if audit logging is persistently broken
            auditLogService._consecutiveFailures = (auditLogService._consecutiveFailures || 0) + 1;
            if (auditLogService._consecutiveFailures >= 5) {
                log.error('[CRITICAL] Audit logging has failed 5+ times consecutively. Investigate immediately.');
                // In production, this should trigger an alert/notification
            }
            // Don't throw - audit logging should not break main operations
        }
    },

    /**
     * List audit logs with filters and pagination
     */
    async listLogs(filters: AuditLogFilters = {}) {
        const { entityType, entityId, action, userId, search, startDate, endDate, page = 1, limit = 50 } = filters;
        const offset = (page - 1) * limit;

        // Build where conditions
        const conditions = [];

        if (entityType) {
            conditions.push(eq(auditLog.entityType, entityType));
        }

        if (entityId) {
            conditions.push(eq(auditLog.entityId, entityId));
        }

        if (action) {
            conditions.push(eq(auditLog.action, action));
        }

        if (userId) {
            conditions.push(eq(auditLog.userId, userId));
        }

        if (search) {
            conditions.push(
                or(
                    ilike(auditLog.userEmail, `%${search}%`),
                    ilike(auditLog.action, `%${search}%`),
                    ilike(auditLog.entityType, `%${search}%`)
                )
            );
        }

        if (startDate) {
            conditions.push(gte(auditLog.createdAt, startDate));
        }

        if (endDate) {
            conditions.push(lte(auditLog.createdAt, endDate));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // Get total count
        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(auditLog)
            .where(whereClause);

        // Get logs with user info
        const logs = await db
            .select({
                id: auditLog.id,
                userId: auditLog.userId,
                userEmail: auditLog.userEmail,
                userName: users.name,
                userImage: users.image,
                action: auditLog.action,
                entityType: auditLog.entityType,
                entityId: auditLog.entityId,
                changes: auditLog.changes,
                ipAddress: auditLog.ipAddress,
                createdAt: auditLog.createdAt,
            })
            .from(auditLog)
            .leftJoin(users, eq(auditLog.userId, users.id))
            .where(whereClause)
            .orderBy(desc(auditLog.createdAt))
            .limit(limit)
            .offset(offset);

        return {
            data: logs,
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit),
            },
        };
    },

    /**
     * Get audit history for a specific entity
     */
    async getEntityHistory(entityType: string, entityId: string) {
        return db
            .select({
                id: auditLog.id,
                userId: auditLog.userId,
                userEmail: auditLog.userEmail,
                userName: users.name,
                action: auditLog.action,
                changes: auditLog.changes,
                ipAddress: auditLog.ipAddress,
                createdAt: auditLog.createdAt,
            })
            .from(auditLog)
            .leftJoin(users, eq(auditLog.userId, users.id))
            .where(
                and(
                    eq(auditLog.entityType, entityType),
                    eq(auditLog.entityId, entityId)
                )
            )
            .orderBy(desc(auditLog.createdAt));
    },

    /**
     * Get action label in Indonesian
     */
    getActionLabel(action: string): string {
        const labels: Record<string, string> = {
            'create': 'Membuat',
            'update': 'Mengubah',
            'delete': 'Menghapus',
            'cancel': 'Membatalkan',
            'archive': 'Mengarsipkan',
            'restore': 'Memulihkan',
            'status_change': 'Mengubah Status',
            'distribute': 'Mendistribusikan',
            'receive_distribution': 'Menerima Distribusi',
            'process_distribution': 'Memproses Distribusi',
            'reject_distribution': 'Menolak Distribusi',
            'view': 'Melihat',
            'download': 'Mengunduh',
            'verify_integrity': 'Memeriksa Integritas',
            'hold': 'Menetapkan Legal Hold',
            'release_hold': 'Melepas Legal Hold',
            'request_access': 'Meminta Akses Rekod',
            'approve_access': 'Menyetujui Akses Rekod',
            'deny_access': 'Menolak Akses Rekod',
            'revoke_access': 'Mencabut Akses Rekod',
        };
        return labels[action] || action;
    },

    /**
     * Get entity type label in Indonesian
     */
    getEntityTypeLabel(entityType: string): string {
        const labels: Record<string, string> = {
            'surat_masuk': 'Surat Masuk',
            'surat_keluar': 'Surat Keluar',
            'arsip': 'Arsip',
            'user': 'User',
            'surat_distribution': 'Distribusi Surat',
            'autentikasi': 'Autentikasi Alih Media',
            'file_attachment': 'Lampiran Berkas',
            'arsip_elektronik': 'Arsip Elektronik',
            'tunjuk_silang': 'Tunjuk Silang',
            'record_access_grant': 'Persetujuan Akses Rekod',
        };
        return labels[entityType] || entityType;
    },
};

export default auditLogService;
