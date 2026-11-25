import { describe, expect, it, vi } from 'vitest'
import {
    alamatPeminjaman,
    batasAwalPerpanjangan,
    galatJatuhTempo,
    galatPerpanjangan,
    hariBerikutnya,
    idDariAlamat,
    PESAN_JATUH_TEMPO_LAMPAU,
    PESAN_PERPANJANGAN_TIDAK_MAJU,
} from './peminjaman-arsip'

const HARI_INI = '2026-11-25'

describe('jatuh tempo peminjaman', () => {
    it('hari ini diterima, kemarin ditolak, kosong tidak dinilai', () => {
        expect(galatJatuhTempo('2026-11-25', HARI_INI)).toBe('')
        expect(galatJatuhTempo('2026-11-24', HARI_INI)).toBe(PESAN_JATUH_TEMPO_LAMPAU)
        expect(galatJatuhTempo('', HARI_INI)).toBe('')
    })

    it('memakai tanggal WIB, bukan tanggal UTC, bila hari ini tidak diberikan', () => {
        // 24 November 17.30 UTC = 25 November 00.30 WIB.
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-11-24T17:30:00Z'))
        try {
            expect(galatJatuhTempo('2026-11-24')).toBe(PESAN_JATUH_TEMPO_LAMPAU)
            expect(galatJatuhTempo('2026-11-25')).toBe('')
        } finally {
            vi.useRealTimers()
        }
    })

    it('perpanjangan harus melewati jatuh tempo saat ini dan tidak boleh lampau', () => {
        expect(galatPerpanjangan('2026-12-01', '2026-12-01', HARI_INI)).toBe(PESAN_PERPANJANGAN_TIDAK_MAJU)
        expect(galatPerpanjangan('2026-11-30', '2026-12-01', HARI_INI)).toBe(PESAN_PERPANJANGAN_TIDAK_MAJU)
        expect(galatPerpanjangan('2026-12-02', '2026-12-01', HARI_INI)).toBe('')
        // Pinjaman terlambat: sesudah jatuh tempo lama tetapi sebelum hari ini tetap ditolak.
        expect(galatPerpanjangan('2026-11-20', '2026-11-10', HARI_INI)).toBe(PESAN_JATUH_TEMPO_LAMPAU)
        expect(galatPerpanjangan('2026-11-25', '2026-11-10', HARI_INI)).toBe('')
        expect(galatPerpanjangan('', '2026-11-10', HARI_INI)).toBe('')
    })

    it('batas awal perpanjangan: sehari sesudah jatuh tempo lama, paling cepat hari ini', () => {
        expect(batasAwalPerpanjangan('2026-12-01', HARI_INI)).toBe('2026-12-02')
        expect(batasAwalPerpanjangan('2026-11-10', HARI_INI)).toBe(HARI_INI)
        expect(batasAwalPerpanjangan('2026-11-24', HARI_INI)).toBe(HARI_INI)
        expect(batasAwalPerpanjangan(undefined, HARI_INI)).toBe(HARI_INI)
        expect(hariBerikutnya('2026-12-31')).toBe('2027-01-01')
        expect(hariBerikutnya('bukan tanggal')).toBe('')
    })
})

describe('alamat halaman Peminjaman', () => {
    it('menyaring ke satu arsip atau satu boks beserta unitnya', () => {
        expect(alamatPeminjaman({ status: 'overdue', arsipId: 'a-1', unitKerjaId: 'sesditjen' }))
            .toBe('/archive-lending?status=overdue&arsipId=a-1&unitKerjaId=sesditjen')
        expect(alamatPeminjaman({ status: 'borrowed', storageLocationId: 'b-1' }))
            .toBe('/archive-lending?status=borrowed&storageLocationId=b-1')
    })

    it('hanya menerima pengenal berbentuk UUID dari alamat', () => {
        expect(idDariAlamat('550e8400-e29b-41d4-a716-446655440010')).toBe('550e8400-e29b-41d4-a716-446655440010')
        expect(idDariAlamat('bukan-uuid')).toBe('')
        expect(idDariAlamat(null)).toBe('')
    })
})
