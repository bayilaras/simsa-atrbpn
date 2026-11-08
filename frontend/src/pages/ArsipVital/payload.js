const OPTIONAL_FIELDS = new Set([
    'alasanPenetapan', 'metodeProteksi', 'lokasiBackup', 'mediaBackup', 'jadwalBackup',
    'tanggalPenetapan', 'tanggalReviewSelanjutnya', 'penanggungJawab',
])

const isBlank = value => value == null || (typeof value === 'string' && value.trim() === '')

export const formFromItem = item => ({
    arsipId: item.arsipId, kategoriVital: item.kategoriVital,
    tingkatKekritisan: item.tingkatKekritisan, alasanPenetapan: item.alasanPenetapan,
    metodeProteksi: item.metodeProteksi, lokasiBackup: item.lokasiBackup,
    mediaBackup: item.mediaBackup, jadwalBackup: item.jadwalBackup,
    penanggungJawab: item.penanggungJawab,
    tanggalPenetapan: item.tanggalPenetapan?.split('T')[0],
    tanggalReviewSelanjutnya: item.tanggalReviewSelanjutnya?.split('T')[0],
    statusProteksi: item.statusProteksi
})

// Empty inputs are left out so the server stores nothing for them.
export function buildCreatePayload(form, unitKerjaId) {
    return Object.fromEntries(
        Object.entries({ ...form, unitKerjaId }).filter(([, value]) => !isBlank(value))
    )
}

// An optional field the user emptied is sent as null to clear it. Fields that were
// already empty, or that the list row did not include, are left out and stay as stored.
export function buildUpdatePayload(form, original) {
    const { arsipId: _arsipId, ...fields } = form
    return Object.fromEntries(Object.entries(fields).flatMap(([key, value]) => {
        if (!isBlank(value)) return [[key, value]]
        return OPTIONAL_FIELDS.has(key) && !isBlank(original[key]) ? [[key, null]] : []
    }))
}
