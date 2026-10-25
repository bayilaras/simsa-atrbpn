// frontend/src/lib/perlu-dilengkapi.test.js
import { describe, expect, it, vi } from 'vitest'
import {
    formatJumlahBadge, KATEGORI_PERLU_DILENGKAPI, LABEL_KATEGORI_PERLU_DILENGKAPI, LABEL_STATUS_DISPOSISI,
    PERLU_DILENGKAPI_EVENT, PERLU_DILENGKAPI_REFRESH_MS, umumkanRingkasanPerluDilengkapi,
} from './perlu-dilengkapi'

describe('lib Perlu Dilengkapi (D7)', () => {
    it('kategori sama dengan kontrak backend dan setiap kategori berlabel', () => {
        expect(KATEGORI_PERLU_DILENGKAPI).toEqual([
            'sm_belum_ditindaklanjuti', 'disposisi_terbuka', 'sk_tanpa_nd_penjelas',
            'tindak_lanjut_tertahan', 'siap_diberkaskan', 'sk_tanpa_asal',
        ])
        for (const kategori of KATEGORI_PERLU_DILENGKAPI) expect(LABEL_KATEGORI_PERLU_DILENGKAPI[kategori]).toMatch(/\S/)
        expect(LABEL_STATUS_DISPOSISI).toMatchObject({ sent: 'Terkirim', received: 'Diterima' })
    })
    it('irama badge sama dengan notifikasi (60 detik)', () => {
        expect(PERLU_DILENGKAPI_REFRESH_MS).toBe(60_000)
    })
    it('format jumlah badge', () => {
        expect(formatJumlahBadge(7)).toBe('7')
        expect(formatJumlahBadge(99)).toBe('99')
        expect(formatJumlahBadge(100)).toBe('99+')
    })
    it('mengumumkan total ringkasan lewat event window dan mengabaikan ringkasan rusak', () => {
        const pendengar = vi.fn()
        window.addEventListener(PERLU_DILENGKAPI_EVENT, pendengar)
        umumkanRingkasanPerluDilengkapi({ total: 4, perKategori: {} })
        umumkanRingkasanPerluDilengkapi(null)
        window.removeEventListener(PERLU_DILENGKAPI_EVENT, pendengar)
        expect(pendengar).toHaveBeenCalledTimes(1)
        expect(pendengar.mock.calls[0][0].detail).toEqual({ total: 4 })
    })
})
