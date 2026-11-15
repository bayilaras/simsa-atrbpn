/** Pilihan urutan daftar surat masuk dan keluar; nilainya sama dengan yang diterima server. */
export const URUTAN_BAWAAN = 'dicatat_terbaru'

export const PILIHAN_URUTAN_SURAT = Object.freeze([
    { value: URUTAN_BAWAAN, label: 'Terakhir dicatat' },
    { value: 'tanggal_terbaru', label: 'Tanggal surat (terbaru)' },
    { value: 'tanggal_terlama', label: 'Tanggal surat (terlama)' },
])

/** Surat masuk juga dapat diurutkan menurut tanggal diterima. */
export const PILIHAN_URUTAN_SURAT_MASUK = Object.freeze([
    ...PILIHAN_URUTAN_SURAT,
    { value: 'diterima_terbaru', label: 'Tanggal diterima (terbaru)' },
    { value: 'diterima_terlama', label: 'Tanggal diterima (terlama)' },
])

/** Rentang tanggal daftar surat masuk: menurut tanggal surat (bawaan) atau tanggal diterima. */
export const ACUAN_TANGGAL_BAWAAN = 'surat'

/** Acuan bawaan tidak dikirim, sama dengan urutan. */
export function parameterAcuanTanggal(acuan) {
    return acuan && acuan !== ACUAN_TANGGAL_BAWAAN ? acuan : undefined
}

/** Urutan bawaan tidak dikirim, sehingga permintaan tanpa pilihan tetap seperti sebelumnya. */
export function parameterUrutan(urutan) {
    return urutan && urutan !== URUTAN_BAWAAN ? urutan : undefined
}
