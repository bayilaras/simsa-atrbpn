/**
 * Hook create/update/delete surat. Dipisah ke modul ini agar test berbasis
 * Proxy mock cukup `vi.mock('.../tindak-lanjut.hook.js')` (§11, churn test create).
 */
import { ValidationError } from '../../utils/errors.js';
import type { CriticalAuditContext } from '../audit-log.service.js';
import { recomputeForSuratKeluar, type RecordUser, type Tx } from './deps.js';
import { tindakLanjutService, type TindakLanjutInput } from './tindak-lanjut.service.js';

export async function afterSuratKeluarInsert(tx: Tx, ctx: {
    user?: RecordUser | null;
    inserted: { id: string; unitKerjaId: string };
    tindakLanjut?: TindakLanjutInput;
    audit?: CriticalAuditContext;
}) {
    if (!ctx.tindakLanjut) return null;
    if (!ctx.user?.id) throw new ValidationError('Tindak lanjut memerlukan pengguna yang terautentikasi.');
    return tindakLanjutService.attachSuratKeluar(tx, {
        user: ctx.user, suratKeluar: ctx.inserted, tindakLanjut: ctx.tindakLanjut, audit: ctx.audit,
    });
}

export async function afterSuratKeluarChanged(tx: Tx, suratKeluarId: string, audit?: CriticalAuditContext) {
    return recomputeForSuratKeluar(tx, suratKeluarId, audit);
}
