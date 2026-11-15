import { describe, expect, it } from 'vitest'
import { dataSudahBerubah, versiDimuat } from './data-sudah-berubah'

describe('versi data yang dimuat', () => {
    it('mengenali penolakan DATA_SUDAH_BERUBAH saja', () => {
        expect(dataSudahBerubah({ status: 409, data: { code: 'DATA_SUDAH_BERUBAH' } })).toBe(true)
        expect(dataSudahBerubah({ status: 409, data: { code: 'CONFLICT' } })).toBe(false)
        expect(dataSudahBerubah(undefined)).toBe(false)
    })

    it('hanya mengirim versi bila formulir memuatnya', () => {
        expect(versiDimuat('2026-01-03T02:00:00.456Z')).toEqual({ expectedUpdatedAt: '2026-01-03T02:00:00.456Z' })
        expect(versiDimuat(null)).toEqual({})
    })
})
