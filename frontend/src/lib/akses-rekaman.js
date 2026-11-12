// Kode jawaban 403 detail rekaman berkelas terkendali yang sudah tampil di
// daftar pengguna tetapi belum punya persetujuan akses (backend:
// services/access/perlu-persetujuan.ts).
export const KODE_PERLU_PERSETUJUAN_AKSES = 'ACCESS_APPROVAL_REQUIRED'

export const JENIS_REKAMAN_AKSES = Object.freeze(['surat_masuk', 'surat_keluar', 'arsip'])

export const LABEL_JENIS_REKAMAN = Object.freeze({
    surat_masuk: 'Surat Masuk',
    surat_keluar: 'Surat Keluar',
    arsip: 'Arsip',
})

const LABEL_KELAS = Object.freeze({
    terbatas: 'Terbatas',
    rahasia: 'Rahasia',
    sangat_rahasia: 'Sangat Rahasia',
})

export function labelKelasTerkendali(kelas) {
    return LABEL_KELAS[kelas] || 'terkendali'
}

const teks = (nilai) => (typeof nilai === 'string' && nilai.trim() ? nilai.trim() : null)

/**
 * Rekaman yang ditolak hanya karena belum ada persetujuan akses, atau null
 * untuk galat lain. `jenis` dan `id` berasal dari halaman pemanggil (rute),
 * bukan dari badan galat.
 */
export function rekamanPerluPersetujuan(error, jenis, id) {
    if (error?.status !== 403 || error?.data?.code !== KODE_PERLU_PERSETUJUAN_AKSES) return null
    const rekaman = error.data.rekaman || {}
    return {
        entityType: jenis,
        entityId: id,
        nomor: teks(rekaman.nomor),
        perihal: teks(rekaman.perihal),
        klasifikasi: teks(rekaman.klasifikasi),
    }
}

/** Rekaman yang dititipkan lewat state navigasi ke halaman permohonan akses. */
export function rekamanDariNavigasi(state) {
    const rekaman = state?.mintaAkses
    if (!rekaman || !JENIS_REKAMAN_AKSES.includes(rekaman.entityType) || !teks(rekaman.entityId)) return null
    return {
        entityType: rekaman.entityType,
        entityId: rekaman.entityId.trim(),
        nomor: teks(rekaman.nomor),
        perihal: teks(rekaman.perihal),
    }
}
