import { Router, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { fileAttachments, suratKeluar, suratMasuk } from '../db/schema';
import { AuthRequest, authMiddleware } from '../middlewares/auth.middleware';
import { validateIdParam } from '../middlewares/validate.middleware';
import { auditLogService } from '../services/audit-log.service';
import { blobStorageService } from '../services/blob-storage.service';
import { recordAccessService, RecordEntityType } from '../services/record-access.service';
import { isFileReleased } from '../services/file-release-policy.js';
import { createLogger } from '../utils/logger';

const log = createLogger('FileAccessRoutes');
const router = Router();

router.use(authMiddleware);
router.use('/:entityType/:entityId', validateIdParam('entityId'));

function normalizeBlobLocator(value: string | null | undefined): string | null {
    if (!value) return null;
    const locator = value.startsWith('blob:') ? value.slice('blob:'.length) : value;
    try {
        const parsed = new URL(locator);
        if (
            parsed.protocol === 'https:' &&
            parsed.hostname.endsWith('.blob.vercel-storage.com')
        ) {
            return parsed.toString();
        }
    } catch {
        // Legacy local/Drive references are deliberately not treated as object URLs.
    }
    return null;
}

function safeFileName(value: string | null | undefined, fallback: string): string {
    return (value || fallback).replace(/[\r\n"\\/]/g, '_');
}

async function streamAuthorizedFile(
    req: AuthRequest,
    res: Response,
    details: {
        locator: string;
        fileName: string;
        auditEntityType: 'surat_masuk' | 'surat_keluar' | 'file_attachment';
        auditEntityId: string;
        parentType?: RecordEntityType;
        parentId?: string;
    },
) {
    const stored = await blobStorageService.downloadFile(details.locator);
    if (!stored) {
        return res.status(404).json({ error: 'File not found' });
    }

    const download = req.query.download === '1';
    const disposition = download ? 'attachment' : 'inline';
    const fileName = safeFileName(details.fileName, stored.fileName);

    res.setHeader('Content-Type', stored.mimeType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    await auditLogService.logAction({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: download ? 'download' : 'view',
        entityType: details.auditEntityType,
        entityId: details.auditEntityId,
        changes: details.parentType && details.parentId
            ? { parentType: details.parentType, parentId: details.parentId }
            : undefined,
        ipAddress: req.ip,
    });

    stored.stream.on('error', (error) => {
        log.error({ err: error, entityId: details.auditEntityId }, 'Blob stream failed');
        if (!res.headersSent) res.status(502).end();
        else res.destroy(error);
    });
    stored.stream.pipe(res);
}

router.get('/:entityType/:entityId', async (req: AuthRequest, res: Response) => {
    try {
        const entityType = String(req.params.entityType);
        const entityId = String(req.params.entityId);

        if (entityType === 'attachment') {
            const [attachment] = await db
                .select()
                .from(fileAttachments)
                .where(eq(fileAttachments.id, entityId))
                .limit(1);

            if (!attachment || !['surat_masuk', 'surat_keluar', 'arsip'].includes(attachment.entityType)) {
                return res.status(404).json({ error: 'File not found' });
            }

            const parentType = attachment.entityType as RecordEntityType;
            const access = await recordAccessService.check(req.user, parentType, attachment.entityId);
            if (!access.exists || !access.allowed) {
                return res.status(404).json({ error: 'File not found' });
            }

            if (!isFileReleased(attachment)) {
                return res.status(423).json({
                    error: 'File quarantined',
                    message: 'Bitstream belum dinyatakan bersih dan utuh oleh kontrol ingest.',
                });
            }

            const locator = normalizeBlobLocator(attachment.fileUrl || attachment.driveFileId);
            if (!locator) return res.status(404).json({ error: 'File not found' });

            return streamAuthorizedFile(req, res, {
                locator,
                fileName: attachment.fileName || 'lampiran',
                auditEntityType: 'file_attachment',
                auditEntityId: attachment.id,
                parentType,
                parentId: attachment.entityId,
            });
        }

        if (!['surat_masuk', 'surat_keluar'].includes(entityType)) {
            return res.status(400).json({ error: 'Unsupported entity type' });
        }

        const access = await recordAccessService.check(req.user, entityType as RecordEntityType, entityId);
        if (!access.exists || !access.allowed) {
            return res.status(404).json({ error: 'File not found' });
        }

        const [record] = entityType === 'surat_masuk'
            ? await db.select({ filePath: suratMasuk.filePath, fileName: suratMasuk.fileOriginalName })
                .from(suratMasuk).where(eq(suratMasuk.id, entityId)).limit(1)
            : await db.select({ filePath: suratKeluar.filePath, fileName: suratKeluar.fileOriginalName })
                .from(suratKeluar).where(eq(suratKeluar.id, entityId)).limit(1);

        const locator = normalizeBlobLocator(record?.filePath);
        if (!locator) return res.status(404).json({ error: 'File not found' });

        // Legacy surat locators did not carry malware/fixity state. They are
        // therefore not released merely because a URL exists: an ingest worker
        // must register the same bitstream and mark it clean first.
        const registrations = await db
            .select()
            .from(fileAttachments)
            .where(and(
                eq(fileAttachments.entityType, entityType),
                eq(fileAttachments.entityId, entityId),
            ));
        const releasedRegistration = registrations.find((registration) => {
            const registeredLocator = normalizeBlobLocator(
                registration.fileUrl || registration.driveFileId,
            );
            return registeredLocator === locator && isFileReleased(registration);
        });
        if (!releasedRegistration) {
            return res.status(423).json({
                error: 'File quarantined',
                message: 'Bitstream harus diregistrasi, dipindai malware, dan memiliki baseline hash.',
            });
        }

        return streamAuthorizedFile(req, res, {
            locator,
            fileName: record?.fileName || 'dokumen',
            auditEntityType: entityType as 'surat_masuk' | 'surat_keluar',
            auditEntityId: entityId,
        });
    } catch (error) {
        log.error({ err: error }, 'Authorized file retrieval failed');
        if (!res.headersSent) return res.status(500).json({ error: 'Failed to retrieve file' });
        return res.end();
    }
});

export default router;
