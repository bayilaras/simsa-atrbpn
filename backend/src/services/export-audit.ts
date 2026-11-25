import type { AuthRequest } from '../middlewares/auth.middleware';
import { auditLogService, type LogActionData } from './audit-log.service';

export type ExportSource = 'export' | 'laporan' | 'distribusi' | 'audit-log';
export type ExportType = 'surat-masuk' | 'surat-keluar' | 'arsip' | 'peminjaman' | 'disposisi' | 'audit-log';

export interface ExportAuditDetails {
    source: ExportSource;
    type: ExportType;
    format: 'excel' | 'pdf';
    filters: Record<string, unknown>;
    formulirType?: string;
}

const ENTITAS_EKSPOR: Record<ExportType, LogActionData['entityType']> = {
    'surat-masuk': 'surat_masuk',
    'surat-keluar': 'surat_keluar',
    arsip: 'arsip',
    peminjaman: 'archive_lending',
    disposisi: 'surat_distribution',
    'audit-log': 'audit_log',
};

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
        entityType: ENTITAS_EKSPOR[details.type],
        changes: {
            source: details.source,
            format: details.format,
            ...(details.formulirType ? { formulirType: details.formulirType } : {}),
            filters,
        },
        ipAddress: req.ip,
    });
}
