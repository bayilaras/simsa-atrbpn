import { LACAK_MAX_CHARS, LACAK_MIN_CHARS } from './lacak-cache'

// global-search.service.ts memakai `SM-${noUrut}/${tahun}`/`SK-…` bila nomor kosong.
// Catatan: nomor surat nyata berbentuk sama (SM-12/2026) langsung diperlakukan sebagai
// judul cadangan dan diganti excerpt -- diterima, lihat Self-Review P4-C-9 Task 8.
const JUDUL_CADANGAN = /^S[MK]-\d+\/\d{4}$/

export function lacakQueryForResult(result) {
    const title = String(result?.title ?? '').trim()
    const dasar = title && !JUDUL_CADANGAN.test(title) ? title : String(result?.excerpt ?? '').trim()
    const q = dasar.slice(0, LACAK_MAX_CHARS).trim()
    return q.length >= LACAK_MIN_CHARS ? q : ''
}

export function lacakHref({ q = '', rangkaianId = '' } = {}) {
    const params = new URLSearchParams()
    const trimmed = String(q).trim().slice(0, LACAK_MAX_CHARS)
    if (trimmed) params.set('q', trimmed)
    if (rangkaianId) params.set('rangkaian', rangkaianId)
    const search = params.toString()
    return search ? `/surat/lacak?${search}` : '/surat/lacak'
}
