export function readArchiveListQuery(params) {
    const year = params.get('tahun') || 'all'
    const page = Number(params.get('page') || 1)
    const pageSize = Number(params.get('limit') || 10)
    return {
        search: (params.get('q') || '').slice(0, 255),
        tahun: /^\d{4}$/.test(year) && Number(year) >= 2000 && Number(year) <= 2100 ? year : 'all',
        unitKerjaId: (params.get('unit') || 'all').slice(0, 100),
        page: Number.isSafeInteger(page) && page > 0 && page <= 100000 ? page : 1,
        pageSize: [10, 25, 50].includes(pageSize) ? pageSize : 10,
    }
}

export function writeArchiveListQuery(query) {
    const params = new URLSearchParams()
    if (query.search) params.set('q', query.search.slice(0, 255))
    if (query.tahun && query.tahun !== 'all') params.set('tahun', query.tahun)
    if (query.unitKerjaId && query.unitKerjaId !== 'all') params.set('unit', query.unitKerjaId)
    if (query.page > 1) params.set('page', String(query.page))
    if (query.pageSize !== 10) params.set('limit', String(query.pageSize))
    return params
}
