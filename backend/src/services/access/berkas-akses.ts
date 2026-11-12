/**
 * Akses lewat izin (grant) selain mode unduh hanya untuk penayangan berkas.
 * GET /api/files menolak `?download=1` untuk akses ini, dan detail surat
 * mengirim tanda yang sama agar penampil berkas di klien menyesuaikan diri.
 */
export function berkasHanyaTayang(access: { grantId?: string | null; grantAccessMode?: string | null }): boolean {
    return Boolean(access.grantId) && access.grantAccessMode !== 'download';
}
