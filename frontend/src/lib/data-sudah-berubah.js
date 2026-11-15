// Suntingan yang ditolak server karena data sudah diubah orang lain sejak
// formulir dimuat (backend utils/errors.ts DataSudahBerubahError).
export const KODE_DATA_SUDAH_BERUBAH = 'DATA_SUDAH_BERUBAH'
export const PESAN_DATA_SUDAH_BERUBAH = 'Data ini sudah diubah pengguna lain sejak Anda membukanya. Muat ulang halaman untuk melihat perubahan terbaru, lalu ulangi perubahan Anda.'

export function dataSudahBerubah(err) {
    return err?.status === 409 && (err?.data?.code ?? err?.response?.data?.code) === KODE_DATA_SUDAH_BERUBAH
}

/** Bidang versi untuk badan PUT: updatedAt yang dimuat formulir, bila ada. */
export function versiDimuat(updatedAt) {
    return updatedAt ? { expectedUpdatedAt: updatedAt } : {}
}
