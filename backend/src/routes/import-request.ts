import type { Response } from 'express';
import type { AuthRequest } from '../middlewares/auth.middleware';
import { canAccessUnit, type Role } from '../config/permissions.js';
import { resolveEffectiveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import type { GoogleSheetsRequestOptions } from '../services/google-sheets-source.js';

/** The unit an import writes into; answers 400/403 and returns null when it cannot. */
export function resolveImportUnit(req: AuthRequest, res: Response): string | null {
    const requestedUnit = typeof req.body?.unitKerjaId === 'string' ? req.body.unitKerjaId.trim() : '';
    const role = (req.user?.role || 'user') as Role;
    const unitKerjaId = resolveEffectiveUnitKerjaId(role, req.user?.unitKerjaId, requestedUnit);
    if (!unitKerjaId) { res.status(400).json({ error: 'unitKerjaId is required' }); return null; }
    if (!canAccessUnit(role, req.user?.unitKerjaId || null, unitKerjaId)) {
        res.status(403).json({ error: 'Anda tidak berwenang mengimpor data untuk unit kerja tersebut' });
        return null;
    }
    return unitKerjaId;
}

/** The response close event detects disconnects after the request body is read. */
export async function withImportRequest<T>(
    req: AuthRequest, res: Response, action: (options: GoogleSheetsRequestOptions) => Promise<T>,
): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const onClose = () => { if (!res.writableEnded) abort(); };
    req.once('aborted', abort);
    res.once('close', onClose);
    if (req.aborted || res.destroyed) abort();
    try { return await action({ signal: controller.signal }); }
    finally { req.off('aborted', abort); res.off('close', onClose); }
}
