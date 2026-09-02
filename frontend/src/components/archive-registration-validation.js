export function validateArchiveRegistration(formData, items) {
    const missing = []
    if (!formData.nomorBerkas?.trim()) missing.push('nomor berkas')
    if (!formData.klasifikasiItemId && !formData.kodeKlasifikasi?.trim()) missing.push('klasifikasi arsip')
    if (!formData.jraItemId && !formData.jraKode?.trim()) missing.push('jadwal retensi arsip')
    if (!formData.uraianBerkas?.trim()) missing.push('uraian berkas')
    if (!formData.unitPengolah?.trim()) missing.push('unit pengolah')
    if (!formData.kurunWaktuDari || !formData.kurunWaktuSampai) missing.push('kurun waktu lengkap')
    if (!formData.personInCharge?.trim()) missing.push('person in charge')

    if (!Array.isArray(items) || items.length === 0) {
        missing.push('minimal satu item arsip')
    } else {
        items.forEach((item, index) => {
            const label = `item ${index + 1}`
            if (!item.nomor?.trim()) missing.push(`nomor ${label}`)
            if (!item.uraian?.trim()) missing.push(`uraian ${label}`)
            if (!item.perkembangan) missing.push(`tingkat perkembangan ${label}`)
            if (!item.tanggal) missing.push(`tanggal ${label}`)
            if (!Number.isInteger(Number(item.jumlah)) || Number(item.jumlah) < 1) missing.push(`jumlah ${label}`)
            if (!item.lokasiFc?.trim() || !item.lokasiLaci?.trim() || !item.lokasiFolder?.trim()) {
                missing.push(`lokasi fisik lengkap ${label}`)
            }
        })
    }

    return missing.length > 0
        ? `Lengkapi field wajib: ${missing.join(', ')}.`
        : ''
}
