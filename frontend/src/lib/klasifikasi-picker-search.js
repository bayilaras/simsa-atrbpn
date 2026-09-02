const ARCHIVE_SEARCH_THESAURUS = {
    ptp: ['pengadaan tanah', 'pengembangan pertanahan'],
    'ganti rugi': ['ganti kerugian', 'musyawarah penetapan ganti kerugian'],
    konsinyasi: ['penitipan uang ganti kerugian'],
    ba: ['berita acara'],
    sk: ['surat keputusan', 'keputusan'],
    tu: ['tata usaha', 'ketatausahaan'],
    ukur: ['pengukuran', 'pemetaan'],
    sengketa: ['sengketa konflik perkara', 'penanganan perkara'],
}

const CODE_FIELDS = ['kode', 'sourceCode']
const SEARCH_FIELDS = [
    ...CODE_FIELDS,
    'sourceRecordKey',
    'jenis',
    'kategori',
    'keterangan',
]
const JRA_SEARCH_FIELDS = ['kode', 'uraian', 'keterangan', 'triggerGuidance']

function normalizedSearch(value) {
    return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim()
}

function expandedSearchTerms(query) {
    const normalized = normalizedSearch(query)
    if (!normalized) return []

    const terms = new Set([normalized])
    for (const [alias, equivalents] of Object.entries(ARCHIVE_SEARCH_THESAURUS)) {
        if (normalized.includes(alias) || equivalents.some((item) => normalizedSearch(item).includes(normalized))) {
            terms.add(alias)
            equivalents.forEach((item) => terms.add(normalizedSearch(item)))
        }
    }
    return [...terms]
}

function matchesTerms(item, terms, fields) {
    const haystack = fields.map((field) => normalizedSearch(item?.[field])).join(' ')
    return terms.some((term) => haystack.includes(term))
}

export function filterKlasifikasiPickerItems(items, activeTab, query) {
    const tabItems = activeTab === 'all'
        ? items
        : items.filter((item) => item.tipe === activeTab)
    const normalizedQuery = normalizedSearch(query)
    let filtered = tabItems

    if (normalizedQuery) {
        // Codes are authoritative. If the input matches a code, do not broaden
        // `TU.02.01` to the `tu` thesaurus alias and accidentally render every
        // description containing that common two-letter sequence.
        const codeMatches = tabItems.filter((item) => matchesTerms(item, [normalizedQuery], CODE_FIELDS))
        filtered = codeMatches.length > 0
            ? codeMatches
            : tabItems.filter((item) => matchesTerms(item, expandedSearchTerms(normalizedQuery), SEARCH_FIELDS))
    }

    return [...filtered].sort((left, right) => (left.kode || '').localeCompare(right.kode || ''))
}

export function filterJraPickerItems(items, query) {
    const terms = expandedSearchTerms(query)
    if (terms.length === 0) return items
    return items.filter((item) => matchesTerms(item, terms, JRA_SEARCH_FIELDS))
}
