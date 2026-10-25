import type { AuthRequest } from '../middlewares/auth.middleware';
import { auditLogService } from './audit-log.service';

export type ExportSource = 'export' | 'laporan';

export interface ExportAuditDetails {
    source: ExportSource;
    type: 'surat-masuk' | 'surat-keluar' | 'arsip';
    format: 'excel' | 'pdf';
    filters: Record<string, unknown>;
    formulirType?: string;
}

/**
 * Record a data export before any byte leaves the server. Like single-file
 * downloads, a failed audit write must block the export (the caller lets the
 * error reach its 500 handler before headers are set).
 */
export async function auditExport(req: AuthRequest, details: ExportAuditDetails): Promise<void> {
    const filters = Object.fromEntries(Object.entries(details.filters)
        .filter(([key, value]) => key !== 'securityClassifications' && value !== undefined && value !== null && value !== ''));
    await auditLogService.logActionOrThrow({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: 'export',
        entityType: details.type === 'surat-masuk' ? 'surat_masuk' : details.type === 'surat-keluar' ? 'surat_keluar' : 'arsip',
        changes: {
            source: details.source,
            format: details.format,
            ...(details.formulirType ? { formulirType: details.formulirType } : {}),
            filters,
        },
        ipAddress: req.ip,
    });
}
