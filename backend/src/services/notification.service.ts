import { db } from '../config/database';
import { suratMasuk } from '../db/schema/surat-masuk';
import { notificationReads } from '../db/schema/notification-reads';
import {
    arsip,
    jraAppraisalCases,
    permanentTransferCancellationRequests,
    permanentTransferEvents,
    permanentTransferManifestItems,
    permanentTransferManifests,
    penyusutanArsip,
    retentionTriggerEvents,
    retentionTriggerVerifications,
    suratDistributions,
    userPreferences,
} from '../db/schema';
import { eq, and, desc, inArray, or, sql, type SQL, isNull, ne } from 'drizzle-orm';
import { arsipService } from './arsip.service';
import { ValidationError } from '../utils/errors.js';
import {
    isValidNotificationId,
    MAX_NOTIFICATION_READ_IDS,
} from '../utils/notification-id.js';

type SecurityClassScope = string[] | null | undefined;
const ADMIN_NOTIFICATION_ROLES = new Set(['super_admin', 'admin_dirjen', 'admin_sesditjen']);
const RETENTION_NOTIFICATION_ROLES = new Set([...ADMIN_NOTIFICATION_ROLES, 'auditor']);

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

function archiveSecurityCondition(classes: SecurityClassScope) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    return inArray(
        sql<string>`lower(replace(coalesce(${arsip.klasifikasiKeamanan}, 'biasa'), '-', '_'))`,
        classes,
    );
}

function batchSecurityCondition(classes: SecurityClassScope) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    const allowed = sql.join(classes.map(value => sql`${value}`), sql`, `);
    return sql`NOT EXISTS (
        SELECT 1
        FROM penyusutan_items notification_item
        INNER JOIN arsip notification_archive ON notification_archive.id = notification_item.arsip_id
        WHERE notification_item.penyusutan_id = ${penyusutanArsip.id}
          AND lower(replace(coalesce(notification_archive.klasifikasi_keamanan, 'biasa'), '-', '_'))
              NOT IN (${allowed})
    )`;
}

function manifestSecurityCondition(classes: SecurityClassScope) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    const allowed = sql.join(classes.map(value => sql`${value}`), sql`, `);
    return sql`NOT EXISTS (
        SELECT 1
        FROM permanent_transfer_manifest_items notification_item
        INNER JOIN arsip notification_archive ON notification_archive.id = notification_item.arsip_id
        WHERE notification_item.manifest_id = ${permanentTransferManifests.id}
          AND lower(replace(coalesce(notification_archive.klasifikasi_keamanan, 'biasa'), '-', '_'))
              NOT IN (${allowed})
    )`;
}

function ageUrgency(
    createdAt: Date | string,
    now = new Date(),
    warningAfterDays = 2,
    urgentAfterDays = 7,
): { type: 'urgent' | 'warning' | 'info'; ageDays: number } {
    const ageDays = Math.max(0, Math.floor(
        (now.getTime() - new Date(createdAt).getTime()) / 86_400_000,
    ));
    return {
        type: ageDays >= urgentAfterDays ? 'urgent' : ageDays >= warningAfterDays ? 'warning' : 'info',
        ageDays,
    };
}

function statefulId(
    category: Notification['category'],
    referenceId: string,
    state: string,
    type: Notification['type'],
): string {
    return `${category}:${referenceId}:${state}:${type}`;
}

function excerpt(value: string | null | undefined, length = 70): string {
    const text = value?.trim() || '-';
    return text.length > length ? `${text.slice(0, length)}...` : text;
}

export interface Notification {
    id: string;
    type: 'urgent' | 'warning' | 'info';
    category:
        | 'surat-masuk'
        | 'arsip-retensi'
        | 'distribusi'
        | 'verifikasi-retensi'
        | 'appraisal'
        | 'penyusutan'
        | 'penyerahan-permanen';
    title: string;
    message: string;
    daysLeft?: number;
    referenceId: string;
    createdAt: Date;
    isRead?: boolean;
    state: string;
}

export interface NotificationCounts {
    total: number;
    urgent: number;
    warning: number;
    info: number;
    suratMasuk: number;
    arsipRetensi: number;
    distribusi: number;
    verifikasiRetensi: number;
    appraisal: number;
    penyusutan: number;
    penyerahanPermanen: number;
}

export interface NotificationReadContext {
    unitKerjaId: string;
    userId: string;
    securityClassifications?: string[] | null;
    userRole?: string;
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
        knownReadIds?: Set<string>,
    ): Promise<Notification[]> {
        const readIds = knownReadIds || await this.getReadIds(userId);

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
                id: statefulId('surat-masuk', surat.id, surat.status || 'pending', type),
                type,
                category: 'surat-masuk' as const,
                title: `Surat ${sifatLabel} belum diproses`,
                message: `${surat.nomorSurat || 'Surat'} dari ${surat.dari || 'Unknown'} - ${(surat.perihal || '').substring(0, 50)}${(surat.perihal || '').length > 50 ? '...' : ''}`,
                daysLeft: daysSince,
                referenceId: surat.id,
                createdAt: surat.createdAt,
                isRead: false,
                state: surat.status || 'pending',
            };
        });

        // Filter out read notifications
        return notifications.filter(n => !readIds.has(n.id));
    }

    /**
     * Get arsip yang akan kadaluarsa dalam N hari (jadwal retensi)
     */
    async getExpiringArchives(
        unitKerjaId: string,
        userId: string,
        daysAhead: number = 90,
        securityClassifications?: string[] | null,
        knownReadIds?: Set<string>,
    ): Promise<Notification[]> {
        const currentDate = new Date();
        // Reuse the canonical, hash-verified snapshot evaluator. Cached expiry
        // and outcome columns are display caches and must never trigger alerts.
        const expiringArchives = (await arsipService.getExpiring(
            unitKerjaId,
            daysAhead,
            securityClassifications,
        )).slice(0, 50);

        const readIds = knownReadIds || await this.getReadIds(userId);

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
                    id: statefulId(
                        'arsip-retensi',
                        arc.id,
                        `${arc.tanggalKadaluarsa}:${arc.hasilAkhir || 'pending'}`,
                        type,
                    ),
                    type,
                    category: 'arsip-retensi' as const,
                    title: `Arsip ${label}${hasilLabel}`,
                    message: `${arc.nomorBerkas || arc.kodeKlasifikasi || 'Arsip'} - ${(arc.uraianBerkas || '').substring(0, 50)}${(arc.uraianBerkas || '').length > 50 ? '...' : ''}`,
                    daysLeft,
                    referenceId: arc.id,
                    createdAt: arc.createdAt,
                    isRead: false,
                    state: arc.hasilAkhir || 'retention_due',
                };
            });

        // Filter out read notifications
        return notifications.filter(n => !readIds.has(n.id));
    }

    private async getReadIds(userId: string): Promise<Set<string>> {
        const rows = await db
            .select({ notificationId: notificationReads.notificationId })
            .from(notificationReads)
            .where(eq(notificationReads.userId, userId));
        return new Set(rows.map(row => row.notificationId));
    }

    async getDistributionNotifications(
        unitKerjaId: string,
        userId: string,
        securityClassifications?: string[] | null,
        knownReadIds?: Set<string>,
        userRole = 'user',
    ): Promise<Notification[]> {
        if (!ADMIN_NOTIFICATION_ROLES.has(userRole)) return [];
        const readIds = knownReadIds || await this.getReadIds(userId);
        const rows = await db.select({
            id: suratDistributions.id,
            status: suratDistributions.status,
            instruction: suratDistributions.instruction,
            sentAt: suratDistributions.sentAt,
            updatedAt: suratDistributions.updatedAt,
            nomorSurat: suratMasuk.nomorSurat,
            perihal: suratMasuk.perihal,
        })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .where(and(
                eq(suratDistributions.targetUnitId, unitKerjaId),
                inArray(suratDistributions.status, ['sent', 'received']),
                incomingSecurityCondition(securityClassifications),
            ))
            .orderBy(desc(suratDistributions.updatedAt))
            .limit(50);

        return rows.map(row => {
            const urgency = ageUrgency(row.updatedAt || row.sentAt, new Date(), 1, 3);
            const state = row.status === 'sent' ? 'awaiting_receipt' : 'awaiting_processing';
            const notification: Notification = {
                id: statefulId('distribusi', row.id, state, urgency.type),
                type: urgency.type,
                category: 'distribusi',
                title: row.status === 'sent'
                    ? 'Distribusi menunggu penerimaan'
                    : 'Distribusi menunggu tindak lanjut',
                message: `${row.nomorSurat || 'Surat'} - ${excerpt(row.instruction || row.perihal)}`,
                daysLeft: urgency.ageDays,
                referenceId: row.id,
                createdAt: row.updatedAt || row.sentAt,
                isRead: false,
                state,
            };
            return notification;
        }).filter(item => !readIds.has(item.id));
    }

    async getRetentionVerificationNotifications(
        unitKerjaId: string,
        userId: string,
        securityClassifications?: string[] | null,
        knownReadIds?: Set<string>,
        userRole = 'user',
    ): Promise<Notification[]> {
        if (!RETENTION_NOTIFICATION_ROLES.has(userRole)) return [];
        const readIds = knownReadIds || await this.getReadIds(userId);
        const rows = await db.select({
            id: retentionTriggerEvents.id,
            archiveId: retentionTriggerEvents.arsipId,
            revision: retentionTriggerEvents.revision,
            label: retentionTriggerEvents.label,
            actorId: retentionTriggerEvents.actorId,
            createdAt: retentionTriggerEvents.createdAt,
            nomorBerkas: arsip.nomorBerkas,
            uraianBerkas: arsip.uraianBerkas,
        })
            .from(retentionTriggerEvents)
            .innerJoin(arsip, eq(retentionTriggerEvents.arsipId, arsip.id))
            .leftJoin(
                retentionTriggerVerifications,
                eq(retentionTriggerEvents.id, retentionTriggerVerifications.eventId),
            )
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                isNull(retentionTriggerVerifications.id),
                ne(retentionTriggerEvents.actorId, userId),
                archiveSecurityCondition(securityClassifications),
            ))
            .orderBy(desc(retentionTriggerEvents.createdAt))
            .limit(50);

        return rows.map(row => {
            const urgency = ageUrgency(row.createdAt, new Date(), 2, 7);
            const state = `revision_${row.revision}_pending`;
            const notification: Notification = {
                id: statefulId('verifikasi-retensi', row.id, state, urgency.type),
                type: urgency.type,
                category: 'verifikasi-retensi',
                title: 'Pemicu retensi perlu diverifikasi',
                message: `${row.nomorBerkas || 'Arsip'} - ${excerpt(row.label || row.uraianBerkas)}`,
                daysLeft: urgency.ageDays,
                referenceId: row.archiveId,
                createdAt: row.createdAt,
                isRead: false,
                state,
            };
            return notification;
        }).filter(item => !readIds.has(item.id));
    }

    async getAppraisalNotifications(
        unitKerjaId: string,
        userId: string,
        userRole = 'user',
        securityClassifications?: string[] | null,
        knownReadIds?: Set<string>,
    ): Promise<Notification[]> {
        if (!RETENTION_NOTIFICATION_ROLES.has(userRole)) return [];
        const readIds = knownReadIds || await this.getReadIds(userId);
        const reviewer = ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor']
            .includes(userRole);
        const actionable = reviewer
            ? or(
                and(eq(jraAppraisalCases.status, 'open'), eq(jraAppraisalCases.assessorId, userId)),
                and(eq(jraAppraisalCases.status, 'in_review'), ne(jraAppraisalCases.assessorId, userId)),
            )
            : and(
                eq(jraAppraisalCases.status, 'open'),
                eq(jraAppraisalCases.assessorId, userId),
            );
        const rows = await db.select({
            id: jraAppraisalCases.id,
            archiveId: jraAppraisalCases.arsipId,
            status: jraAppraisalCases.status,
            reason: jraAppraisalCases.reason,
            createdAt: jraAppraisalCases.createdAt,
            updatedAt: jraAppraisalCases.updatedAt,
            nomorBerkas: arsip.nomorBerkas,
        })
            .from(jraAppraisalCases)
            .innerJoin(arsip, eq(jraAppraisalCases.arsipId, arsip.id))
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                actionable,
                archiveSecurityCondition(securityClassifications),
            ))
            .orderBy(desc(jraAppraisalCases.updatedAt))
            .limit(50);

        return rows.map(row => {
            const urgency = ageUrgency(row.updatedAt || row.createdAt, new Date(), 3, 7);
            const state = row.status === 'open' ? 'prepare_submission' : 'review_required';
            const notification: Notification = {
                id: statefulId('appraisal', row.id, state, urgency.type),
                type: urgency.type,
                category: 'appraisal',
                title: row.status === 'open'
                    ? 'Appraisal perlu diajukan'
                    : 'Appraisal menunggu keputusan',
                message: `${row.nomorBerkas || 'Arsip'} - ${excerpt(row.reason)}`,
                daysLeft: urgency.ageDays,
                referenceId: row.id,
                createdAt: row.updatedAt || row.createdAt,
                isRead: false,
                state,
            };
            return notification;
        }).filter(item => !readIds.has(item.id));
    }

    async getDispositionNotifications(
        unitKerjaId: string,
        userId: string,
        userRole = 'user',
        securityClassifications?: string[] | null,
        knownReadIds?: Set<string>,
    ): Promise<Notification[]> {
        const reviewer = ['super_admin', 'admin_dirjen', 'admin_sesditjen'].includes(userRole);
        if (!reviewer) return [];
        const readIds = knownReadIds || await this.getReadIds(userId);
        const statuses = userRole === 'super_admin'
            ? ['proposed', 'reviewed', 'approved']
            : ['proposed'];
        const rows = await db.select({
            id: penyusutanArsip.id,
            status: penyusutanArsip.status,
            jenisPenyusutan: penyusutanArsip.jenisPenyusutan,
            nomorBA: penyusutanArsip.nomorBA,
            totalBerkas: penyusutanArsip.totalBerkas,
            createdBy: penyusutanArsip.createdBy,
            proposedBy: penyusutanArsip.proposedBy,
            reviewedBy: penyusutanArsip.reviewedBy,
            approvedBy: penyusutanArsip.approvedBy,
            createdAt: penyusutanArsip.createdAt,
            updatedAt: penyusutanArsip.updatedAt,
        })
            .from(penyusutanArsip)
            .where(and(
                eq(penyusutanArsip.unitKerjaId, unitKerjaId),
                inArray(penyusutanArsip.status, statuses),
                batchSecurityCondition(securityClassifications),
            ))
            .orderBy(desc(penyusutanArsip.updatedAt))
            .limit(50);

        return rows.filter(row => {
            const priorActors = [row.createdBy, row.proposedBy];
            if (row.status === 'reviewed') priorActors.push(row.reviewedBy);
            if (row.status === 'approved') priorActors.push(row.reviewedBy, row.approvedBy);
            return !priorActors.filter(Boolean).includes(userId);
        }).map(row => {
            const urgency = ageUrgency(row.updatedAt || row.createdAt, new Date(), 2, 5);
            const state = row.status === 'proposed'
                ? 'review_required'
                : row.status === 'reviewed' ? 'approval_required' : 'execution_required';
            const title = row.status === 'proposed'
                ? 'Usulan penyusutan perlu direview'
                : row.status === 'reviewed'
                    ? 'Penyusutan perlu disetujui'
                    : 'Penyusutan siap dieksekusi';
            const notification: Notification = {
                id: statefulId('penyusutan', row.id, state, urgency.type),
                type: urgency.type,
                category: 'penyusutan',
                title,
                message: `${row.nomorBA || row.jenisPenyusutan} - ${row.totalBerkas || 0} berkas`,
                daysLeft: urgency.ageDays,
                referenceId: row.id,
                createdAt: row.updatedAt || row.createdAt,
                isRead: false,
                state,
            };
            return notification;
        }).filter(item => !readIds.has(item.id));
    }

    async getPermanentTransferNotifications(
        unitKerjaId: string,
        userId: string,
        userRole = 'user',
        securityClassifications?: string[] | null,
        knownReadIds?: Set<string>,
    ): Promise<Notification[]> {
        if (!['super_admin', 'admin_dirjen', 'admin_sesditjen'].includes(userRole)) return [];
        const readIds = knownReadIds || await this.getReadIds(userId);
        const rows = await db.select({
            id: permanentTransferManifests.id,
            manifestNumber: permanentTransferManifests.manifestNumber,
            destination: permanentTransferManifests.destination,
            createdAt: permanentTransferManifests.createdAt,
            hasHandover: sql<boolean>`EXISTS (
                SELECT 1 FROM permanent_transfer_events handover_event
                WHERE handover_event.manifest_id = ${permanentTransferManifests.id}
                  AND handover_event.event_type = 'handover'
            )`,
            hasAcknowledgement: sql<boolean>`EXISTS (
                SELECT 1 FROM permanent_transfer_events acknowledgement_event
                WHERE acknowledgement_event.manifest_id = ${permanentTransferManifests.id}
                  AND acknowledgement_event.event_type = 'acknowledgement'
            )`,
            pendingCancellationRequestedBy: sql<string | null>`(
                SELECT cancellation.requested_by::text
                FROM permanent_transfer_cancellation_requests cancellation
                WHERE cancellation.manifest_id = ${permanentTransferManifests.id}
                  AND cancellation.status = 'pending'
                ORDER BY cancellation.requested_at DESC
                LIMIT 1
            )`,
        })
            .from(permanentTransferManifests)
            .where(and(
                eq(permanentTransferManifests.unitKerjaId, unitKerjaId),
                manifestSecurityCondition(securityClassifications),
            ))
            .orderBy(desc(permanentTransferManifests.createdAt))
            .limit(50);

        return rows.filter(row => !row.hasAcknowledgement).map(row => {
            const pendingCancellation = Boolean(row.pendingCancellationRequestedBy);
            if (pendingCancellation && row.pendingCancellationRequestedBy === userId) return null;
            const state = pendingCancellation
                ? 'cancellation_review_required'
                : row.hasHandover ? 'acknowledgement_required' : 'handover_required';
            const urgency = ageUrgency(row.createdAt, new Date(), 3, 7);
            const notification: Notification = {
                id: statefulId('penyerahan-permanen', row.id, state, urgency.type),
                type: urgency.type,
                category: 'penyerahan-permanen',
                title: pendingCancellation
                    ? 'Pembatalan penyerahan perlu direview'
                    : row.hasHandover
                        ? 'Penyerahan menunggu tanda terima'
                        : 'Manifest penyerahan siap diserahterimakan',
                message: `${row.manifestNumber} - ${excerpt(row.destination)}`,
                daysLeft: urgency.ageDays,
                referenceId: row.id,
                createdAt: row.createdAt,
                isRead: false,
                state,
            };
            return notification;
        }).filter((item): item is Notification => Boolean(item) && !readIds.has(item!.id));
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
        userRole = 'user',
    ): Promise<{
        notifications: Notification[];
        counts: NotificationCounts;
    }> {
        const [readIds, [preference]] = await Promise.all([
            this.getReadIds(userId),
            db.select({ notificationsEnabled: userPreferences.notificationsEnabled })
                .from(userPreferences)
                .where(eq(userPreferences.userId, userId))
                .limit(1),
        ]);
        const emptyCounts: NotificationCounts = {
            total: 0, urgent: 0, warning: 0, info: 0,
            suratMasuk: 0, arsipRetensi: 0, distribusi: 0,
            verifikasiRetensi: 0, appraisal: 0, penyusutan: 0,
            penyerahanPermanen: 0,
        };
        if (preference?.notificationsEnabled === false) {
            return { notifications: [], counts: emptyCounts };
        }

        const [
            pendingSurat,
            expiringArchives,
            distributions,
            verifications,
            appraisals,
            dispositions,
            permanentTransfers,
        ] = await Promise.all([
            this.getPendingSuratMasuk(unitKerjaId, userId, securityClassifications, readIds),
            this.getExpiringArchives(unitKerjaId, userId, 90, securityClassifications, readIds),
            this.getDistributionNotifications(
                unitKerjaId, userId, securityClassifications, readIds, userRole,
            ),
            this.getRetentionVerificationNotifications(
                unitKerjaId, userId, securityClassifications, readIds, userRole,
            ),
            this.getAppraisalNotifications(
                unitKerjaId, userId, userRole, securityClassifications, readIds,
            ),
            this.getDispositionNotifications(
                unitKerjaId, userId, userRole, securityClassifications, readIds,
            ),
            this.getPermanentTransferNotifications(
                unitKerjaId, userId, userRole, securityClassifications, readIds,
            ),
        ]);

        // Combine all notifications
        const allNotifications = [
            ...pendingSurat,
            ...expiringArchives,
            ...distributions,
            ...verifications,
            ...appraisals,
            ...dispositions,
            ...permanentTransfers,
        ];

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
            distribusi: distributions.length,
            verifikasiRetensi: verifications.length,
            appraisal: appraisals.length,
            penyusutan: dispositions.length,
            penyerahanPermanen: permanentTransfers.length,
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
        userRole = 'user',
    ): Promise<{
        total: number;
        urgent: number;
        warning: number;
        suratMasuk: number;
        arsipRetensi: number;
        distribusi: number;
        verifikasiRetensi: number;
        appraisal: number;
        penyusutan: number;
        penyerahanPermanen: number;
    }> {
        const { counts } = await this.getAllNotifications(
            unitKerjaId,
            userId,
            100,
            securityClassifications,
            userRole,
        );
        return {
            total: counts.total,
            urgent: counts.urgent,
            warning: counts.warning,
            suratMasuk: counts.suratMasuk,
            arsipRetensi: counts.arsipRetensi,
            distribusi: counts.distribusi,
            verifikasiRetensi: counts.verifikasiRetensi,
            appraisal: counts.appraisal,
            penyusutan: counts.penyusutan,
            penyerahanPermanen: counts.penyerahanPermanen,
        };
    }

    /**
     * Mark notification as read
     */
    async markAsRead(userId: string, notificationId: string): Promise<void> {
        if (!isValidNotificationId(notificationId)) {
            throw new ValidationError('Format ID notifikasi tidak valid');
        }
        await db.insert(notificationReads).values({
            userId,
            notificationId
        }).onConflictDoNothing({
            target: [notificationReads.userId, notificationReads.notificationId],
        });
    }

    /**
     * Mark all as read
     */
    async markAllAsRead(userId: string, notificationIds: string[]): Promise<void> {
        if (notificationIds.length === 0) return;
        const uniqueIds = [...new Set(notificationIds)];
        if (
            uniqueIds.length > MAX_NOTIFICATION_READ_IDS
            || uniqueIds.some(id => !isValidNotificationId(id))
        ) {
            throw new ValidationError('Daftar ID notifikasi tidak valid');
        }

        await db.insert(notificationReads).values(uniqueIds.map(notificationId => ({
            userId,
            notificationId,
        }))).onConflictDoNothing({
            target: [notificationReads.userId, notificationReads.notificationId],
        });
    }

    /**
     * Persist acknowledgements only for IDs emitted by the current producer
     * state (or IDs already acknowledged by this user). This prevents the read
     * table from becoming an arbitrary user-controlled key/value store.
     */
    async markCurrentAsRead(
        context: NotificationReadContext,
        notificationIds: string[],
    ): Promise<void> {
        const uniqueIds = [...new Set(notificationIds)];
        if (
            uniqueIds.length === 0
            || uniqueIds.length > MAX_NOTIFICATION_READ_IDS
            || uniqueIds.some(id => !isValidNotificationId(id))
        ) {
            throw new ValidationError('Daftar ID notifikasi tidak valid');
        }

        const existingRows = await db
            .select({ notificationId: notificationReads.notificationId })
            .from(notificationReads)
            .where(and(
                eq(notificationReads.userId, context.userId),
                inArray(notificationReads.notificationId, uniqueIds),
            ));
        const existing = new Set(existingRows.map(row => row.notificationId));
        const unresolved = uniqueIds.filter(id => !existing.has(id));
        if (unresolved.length === 0) return;

        const current = await this.getAllNotifications(
            context.unitKerjaId,
            context.userId,
            350,
            context.securityClassifications,
            context.userRole || 'user',
        );
        const currentIds = new Set(current.notifications.map(item => item.id));
        if (unresolved.some(id => !currentIds.has(id))) {
            throw new ValidationError('Notifikasi tidak tersedia atau statusnya telah berubah');
        }

        await this.markAllAsRead(context.userId, unresolved);
    }
}

export const notificationService = new NotificationService();
