import { describe, expect, it } from 'vitest'
import { readArchiveListQuery, writeArchiveListQuery } from './archive-list-query'

describe('archive query boundaries', () => {
    it('normalizes invalid query values before sending them to the API', () => {
        expect(readArchiveListQuery(new URLSearchParams('tahun=1999&page=Infinity&limit=1000'))).toEqual({
            search: '', tahun: 'all', unitKerjaId: 'all', page: 1, pageSize: 10,
        })
        expect(readArchiveListQuery(new URLSearchParams({ q: 'a'.repeat(300) })).search).toHaveLength(255)
    })
    it('round trips named filters and omits default parameters', () => {
        const query = { search: 'tanah & ruang', tahun: '2026', unitKerjaId: 'unit-a', page: 3, pageSize: 25 }
        expect(readArchiveListQuery(writeArchiveListQuery(query))).toEqual(query)
        expect(writeArchiveListQuery(readArchiveListQuery(new URLSearchParams())).toString()).toBe('')
    })
})
