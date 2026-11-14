/** Pilihan urutan daftar surat masuk dan keluar; nilainya sama dengan yang diterima server. */
export const URUTAN_BAWAAN = 'dicatat_terbaru'

export const PILIHAN_URUTAN_SURAT = Object.freeze([
    { value: URUTAN_BAWAAN, label: 'Terakhir dicatat' },
    { value: 'tanggal_terbaru', label: 'Tanggal surat (terbaru)' },
    { value: 'tanggal_terlama', label: 'Tanggal surat (terlama)' },
])

/** Urutan bawaan tidak dikirim, sehingga permintaan tanpa pilihan tetap seperti sebelumnya. */
export function parameterUrutan(urutan) {
    return urutan && urutan !== URUTAN_BAWAAN ? urutan : undefined
}
