const JRA_PREVIEW_FIELDS = ['jraKode', 'jraUraian', 'jraRetensiAktif', 'jraRetensiInaktif', 'jraKeterangan']
const CLASSIFICATION_PREVIEW_FIELDS = ['klasifikasiTipe', 'klasifikasiOrganizationalScope']

export function readSuratArchiveSelection(record = {}) {
    return {
        klasifikasiItemId: record.klasifikasiItemId ?? undefined,
        jraItemId: record.jraItemId ?? undefined,
        ...Object.fromEntries(CLASSIFICATION_PREVIEW_FIELDS.map(field => [field, record[field] ?? undefined])),
        ...Object.fromEntries(JRA_PREVIEW_FIELDS.map(field => [field, record[field] ?? ''])),
    }
}

export function selectedSuratArchiveRules(record = {}) {
    const category = record.klasifikasiFasilitatifKode ? 'fasilitatif' : record.klasifikasiSubstantifKode ? 'substantif' : undefined
    const kode = record.klasifikasiKode || record.klasifikasiFasilitatifKode || record.klasifikasiSubstantifKode || ''
    const jenis = record.klasifikasiKode ? record.klasifikasiUraian
        : category === 'fasilitatif' ? record.klasifikasiFasilitatif : record.klasifikasiSubstantif
    return {
        classification: kode ? {
            id: record.klasifikasiItemId,
            kode,
            jenis: jenis || '',
            tipe: record.klasifikasiTipe || category,
            organizationalScope: record.klasifikasiOrganizationalScope,
        } : null,
        retention: record.jraKode ? {
            id: record.jraItemId,
            kode: record.jraKode,
            uraian: record.jraUraian,
            retensiAktif: record.jraRetensiAktif,
            retensiInaktif: record.jraRetensiInaktif,
            keterangan: record.jraKeterangan,
        } : null,
    }
}

export function buildSuratArchiveSelection(kode, classification, retention, kind = 'masuk') {
    return {
        klasifikasiItemId: classification?.id ?? null,
        jraItemId: retention?.id ?? null,
        klasifikasiTipe: classification?.tipe,
        klasifikasiOrganizationalScope: classification?.organizationalScope,
        ...(kind === 'keluar' ? {
            klasifikasiFasilitatifKode: classification?.tipe === 'fasilitatif' ? kode : '',
            klasifikasiFasilitatif: classification?.tipe === 'fasilitatif' ? classification.jenis : '',
            klasifikasiSubstantifKode: classification?.tipe === 'substantif' ? kode : '',
            klasifikasiSubstantif: classification?.tipe === 'substantif' ? classification.jenis : '',
        } : {
            klasifikasiKode: kode,
            klasifikasiUraian: classification?.jenis || '',
        }),
        jraKode: retention?.kode || '',
        jraUraian: retention?.uraian || '',
        jraRetensiAktif: retention?.retensiAktif ?? '',
        jraRetensiInaktif: retention?.retensiInaktif ?? '',
        jraKeterangan: retention?.keterangan || '',
    }
}

export function omitSuratArchivePreviews(formData) {
    return Object.fromEntries(Object.entries(formData).filter(([field]) => !JRA_PREVIEW_FIELDS.includes(field) && !CLASSIFICATION_PREVIEW_FIELDS.includes(field)))
}

export function validateSuratArchiveSelection(formData) {
    return formData.jraKode && (!formData.klasifikasiItemId || !formData.jraItemId)
        ? 'Pilih ulang pasangan klasifikasi dan JRA dari master aturan sebelum menyimpan.'
        : ''
}
