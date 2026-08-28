import { db } from '../config/database';
import { suratMasuk } from '../db/schema/surat-masuk';
import { notificationReads } from '../db/schema/notification-reads';
import { eq, and, desc, inArray, or, sql, type SQL } from 'drizzle-orm';
import { arsipService } from './arsip.service';

type SecurityClassScope = string[] | null | undefined;

function incomingSecurityCondition(classes: SecurityClassScope) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;

    const normalized = sql<string>`lower(replace(coalesce(${suratMasuk.sifatSurat}, 'biasa'), '-', '_'))`;
    const predicates: SQL[] = [];
    if (classes.includes('biasa')) {
        predicates.push(inArray(normalized, [
            'biasa',
            'biasa/terbuka',
            'terbuka',
            'segera',
            'sangat_segera',
            'undangan',
            'penting',
        ]));
    }
    for (const classification of classes.filter(value => value !== 'biasa')) {
        predicates.push(eq(normalized, classification));
    }
    return predicates.length > 0 ? or(...predicates) : sql`false`;
}

export interface Notification {
    id: string;
    type: 'urgent' | 'warning' | 'info';
    category: 'surat-masuk' | 'arsip-retensi';
    title: string;
    message: string;
    daysLeft?: number;
    referenceId: string;
    createdAt: Date;
    isRead?: boolean;
}

export interface NotificationCounts {
    total: number;
    urgent: number;
    warning: number;
    info: number;
    suratMasuk: number;
    arsipRetensi: number;
}

export class NotificationService {
    /**
     * Get surat masuk yang belum diproses (belum diarsipkan dan belum dibalas)
     * Surat dianggap "sudah diproses" jika sudah diarsipkan ATAU sudah dibalas
     */
    async getPendingSuratMasuk(
        unitKerjaId: string,
        userId: string,
        securityClassifications?: string[] | null,
    ): Promise<Notification[]> {
        // Get read notifications for this user
        const readNotifications = await db
            .select({ notificationId: notificationReads.notificationId })
            .from(notificationReads)
            .where(eq(notificationReads.userId, userId));

        const readIds = readNotifications.map(n => n.notificationId);

        // Surat masuk yang belum diproses = belum diarsipkan DAN status bukan sudah_dibalas
        const pendingSurat = await db
            .select({
                id: suratMasuk.id,
                nomorSurat: suratMasuk.nomorSurat,
                perihal: suratMasuk.perihal,
                dari: suratMasuk.dari,
                sifatSurat: suratMasuk.sifatSurat,
                tanggalSurat: suratMasuk.tanggalSurat,
                status: suratMasuk.status,
                createdAt: suratMasuk.createdAt,
            })
            .from(suratMasuk)
            .where(and(
                eq(suratMasuk.unitKerjaId, unitKerjaId),
                eq(suratMasuk.isArchived, false),
                eq(suratMasuk.isDeleted, false),
                incomingSecurityCondition(securityClassifications),
            ))
            .orderBy(desc(suratMasuk.createdAt))
            .limit(50);

        // Filter: hanya tampilkan yang belum dibalas (belum diproses)
        const unprocessedSurat = pendingSurat.filter(s => s.status !== 'sudah_dibalas');

        const currentDate = new Date();

        const notifications = unprocessedSurat.map(surat => {
            // Calculate days since received
            const tanggalSurat = surat.tanggalSurat ? new Date(surat.tanggalSurat) : new Date(surat.createdAt);
            const daysSince = Math.floor((currentDate.getTime() - tanggalSurat.getTime()) / (1000 * 60 * 60 * 24));

            // Determine priority based on sifat surat and age
            let type: 'urgent' | 'warning' | 'info' = 'info';
            if (surat.sifatSurat === 'sangat_segera' || daysSince > 7) {
                type = 'urgent';
            } else if (surat.sifatSurat === 'segera' || daysSince > 3) {
                type = 'warning';
            }

            const sifatLabel = surat.sifatSurat === 'sangat_segera' ? 'Sangat Segera' :
                surat.sifatSurat === 'segera' ? 'Segera' : 'Biasa';

            return {
                id: `surat-${surat.id}`,
                type,
                category: 'surat-masuk' as const,
                title: `Surat ${sifatLabel} belum diproses`,
                message: `${surat.nomorSurat || 'Surat'} dari ${surat.dari || 'Unknown'} - ${(surat.perihal || '').substring(0, 50)}${(surat.perihal || '').length > 50 ? '...' : ''}`,
                daysLeft: daysSince,
                referenceId: surat.id,
                createdAt: surat.createdAt,
                isRead: false
            };
        });

        // Filter out read notifications
        return notifications.filter(n => !readIds.includes(n.id));
    }

    /**
     * Get arsip yang akan kadaluarsa dalam N hari (jadwal retensi)
     */
    async getExpiringArchives(
        unitKerjaId: string,
        userId: string,
        daysAhead: number = 90,
        securityClassifications?: string[] | null,
    ): Promise<Notification[]> {
        const currentDate = new Date();
        // Reuse the canonical, hash-verified snapshot evaluator. Cached expiry
        // and outcome columns are display caches and must never trigger alerts.
        const expiringArchives = (await arsipService.getExpiring(
            unitKerjaId,
            daysAhead,
            securityClassifications,
        )).slice(0, 50);

        // Get read notifications for this user
        const readNotifications = await db
            .select({ notificationId: notificationReads.notificationId })
            .from(notificationReads)
            .where(eq(notificationReads.userId, userId));

        const readIds = readNotifications.map(n => n.notificationId);

        // getExpiring exposes canonical compatibility fields sourced from the
        // verified event/evaluator. Keep this final defensive filter so a
        // malformed adapter or stale test double cannot emit a notification.
        const notifications = expiringArchives
            .filter(arc => !arc.legalHold && arc.retentionTriggerDate && arc.tanggalKadaluarsa)
            .map(arc => {
                const tanggalKadaluarsa = new Date(arc.tanggalKadaluarsa as string);
                const daysLeft = Math.ceil((tanggalKadaluarsa.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));

                // Determine priority based on days left - tiered urgency
                let type: 'urgent' | 'warning' | 'info' = 'info';
                let label = 'akan kadaluarsa';
                if (daysLeft <= 7) {
                    type = 'urgent';
                    label = 'segera kadaluarsa';
                } else if (daysLeft <= 30) {
                    type = 'warning';
                    label = 'mendekati kadaluarsa';
                }

                const hasilLabel = arc.hasilAkhir ? ` (${arc.hasilAkhir})` : '';

                return {
                    id: `arsip-${arc.id}`,
                    type,
                    category: 'arsip-retensi' as const,
                    title: `Arsip ${label}${hasilLabel}`,
                    message: `${arc.nomorBerkas || arc.kodeKlasifikasi || 'Arsip'} - ${(arc.uraianBerkas || '').substring(0, 50)}${(arc.uraianBerkas || '').length > 50 ? '...' : ''}`,
                    daysLeft,
                    referenceId: arc.id,
                    createdAt: arc.createdAt,
                    isRead: false
                };
            });

        // Filter out read notifications
        return notifications.filter(n => !readIds.includes(n.id));
    }

    /**
     * Get all notifications combined and sorted by priority
     * Returns separate category counts for tab-based UI
     */
    async getAllNotifications(
        unitKerjaId: string,
        userId: string,
        limit: number = 20,
        securityClassifications?: string[] | null,
    ): Promise<{
        notifications: Notification[];
        counts: NotificationCounts;
    }> {
        const [pendingSurat, expiringArchives] = await Promise.all([
            this.getPendingSuratMasuk(unitKerjaId, userId, securityClassifications),
            this.getExpiringArchives(unitKerjaId, userId, 90, securityClassifications),
        ]);

        // Combine all notifications
        const allNotifications = [...pendingSurat, ...expiringArchives];

        // Sort by priority (urgent > warning > info) and then by createdAt
        const priorityOrder = { urgent: 0, warning: 1, info: 2 };
        allNotifications.sort((a, b) => {
            const priorityDiff = priorityOrder[a.type] - priorityOrder[b.type];
            if (priorityDiff !== 0) return priorityDiff;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        // Calculate counts with category separation
        const counts: NotificationCounts = {
            total: allNotifications.length,
            urgent: allNotifications.filter(n => n.type === 'urgent').length,
            warning: allNotifications.filter(n => n.type === 'warning').length,
            info: allNotifications.filter(n => n.type === 'info').length,
            suratMasuk: pendingSurat.length,
            arsipRetensi: expiringArchives.length,
        };

        return {
            notifications: allNotifications.slice(0, limit),
            counts,
        };
    }

    /**
     * Get notification count only (for badge)
     */
    async getNotificationCount(
        unitKerjaId: string,
        userId: string,
        securityClassifications?: string[] | null,
    ): Promise<{
        total: number;
        urgent: number;
        warning: number;
        suratMasuk: number;
        arsipRetensi: number;
    }> {
        const { counts } = await this.getAllNotifications(
            unitKerjaId,
            userId,
            100,
            securityClassifications,
        );
        return {
            total: counts.total,
            urgent: counts.urgent,
            warning: counts.warning,
            suratMasuk: counts.suratMasuk,
            arsipRetensi: counts.arsipRetensi,
        };
    }

    /**
     * Mark notification as read
     */
    async markAsRead(userId: string, notificationId: string): Promise<void> {
        // Check if already read
        const existing = await db.query.notificationReads.findFirst({
            where: and(
                eq(notificationReads.userId, userId),
                eq(notificationReads.notificationId, notificationId)
            )
        });

        if (existing) return;

        await db.insert(notificationReads).values({
            userId,
            notificationId
        });
    }

    /**
     * Mark all as read
     */
    async markAllAsRead(userId: string, notificationIds: string[]): Promise<void> {
        if (notificationIds.length === 0) return;

        for (const id of notificationIds) {
            await this.markAsRead(userId, id);
        }
    }
}

export const notificationService = new NotificationService();
