import { resolveEffectiveUnitKerjaId } from '@/lib/unit-kerja-scope'

export const LABEL_LOKASI_SIMPAN = 'Lokasi Simpan'
export const PETUNJUK_LOKASI_SIMPAN =
    'Opsional. Pilih gedung, ruang, rak, atau boks tempat berkas disimpan. Daftarnya dikelola di menu Lokasi Simpan.'
export const TANPA_LOKASI = 'Belum ditentukan'

/** Nama lokasi dari gedung sampai lokasi itu sendiri, diikuti kodenya. */
export function namaJalurLokasi(jalur = [], code = '') {
    const nama = jalur.map(lokasi => lokasi?.name).filter(Boolean).join(' / ')
    return nama && code ? `${nama} (${code})` : nama || code
}

/** Pohon lokasi dari GET /api/storage-locations/tree menjadi daftar pilihan berurutan. */
export function daftarPilihanLokasi(nodes = [], induk = []) {
    return nodes.flatMap(node => {
        const jalur = [...induk, node]
        return [
            { id: node.id, label: namaJalurLokasi(jalur, node.code) },
            ...daftarPilihanLokasi(node.children || [], jalur),
        ]
    })
}

/**
 * Lokasi simpan suatu unit hanya dapat dipilih pengguna unit itu atau Super
 * Admin; server menolak pilihan lain (bolehMemakaiLokasiUnit di backend).
 */
export function bolehMemilihLokasiUnit(user, unitKerjaId) {
    if (!user || !unitKerjaId) return false
    return user.role === 'super_admin' || resolveEffectiveUnitKerjaId(user) === unitKerjaId
}

/**
 * Tautan ke daftar arsip yang disaring pada satu lokasi simpan (beserta
 * sub-lokasinya). Membuka tab yang berisi arsip; `unit` hanya dipakai Super Admin.
 */
export function tautanArsipLokasi(lokasi, unitKerjaId) {
    const tab = (lokasi?.arsipKeluarCount ?? 0) === 0 && (lokasi?.arsipMasukCount ?? 0) > 0 ? 'masuk' : 'keluar'
    const params = new URLSearchParams({ lokasi: lokasi.id })
    if (unitKerjaId) params.set('unit', unitKerjaId)
    return `/arsip/${tab}?${params}`
}
