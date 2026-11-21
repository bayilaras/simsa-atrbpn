import { describe, expect, it } from 'vitest'
import { barisDisposisi, formatTanggalCetak, labelDisposisiSumber } from './lembar-disposisi'

describe('lembar-disposisi', () => {
    it('menulis tanggal kalender apa adanya dan waktu menurut WIB', () => {
        expect(formatTanggalCetak('2026-11-03')).toBe('3 November 2026')
        expect(formatTanggalCetak('2026-11-02T18:30:00.000Z', true)).toBe('3 November 2026 01.30 WIB')
        expect(formatTanggalCetak(null)).toBe('')
    })

    it('menyusun baris tujuan urut waktu kirim, dengan tembusan dan penanggung jawab', () => {
        const namaUnit = new Map([['dir_bppt', 'Direktorat BPPT'], ['dir_ptep', 'Direktorat PTEP'], ['dir_ktpp', 'Direktorat KTPP']])
        const baris = barisDisposisi([
            {
                distribution: { id: 'd-2', targetUnitId: 'dir_ptep', instruction: 'Untuk diketahui', status: 'received', sentAt: '2026-11-04T02:00:00.000Z', batasWaktu: null, ccUnits: null },
                targetUnit: { id: 'dir_ptep', name: 'Direktorat PTEP' },
            },
            {
                distribution: {
                    id: 'd-1', targetUnitId: 'dir_bppt', instruction: ' Mohon tindak lanjut ', status: 'sent', sentAt: '2026-11-03T02:00:00.000Z',
                    batasWaktu: '2026-11-10', penanggungJawab: true, ccUnits: '["dir_ktpp","unit_lama"]',
                },
                targetUnit: { id: 'dir_bppt', name: 'Direktorat BPPT' },
            },
            { distribution: { id: 'samar' } },
        ], namaUnit)
        expect(baris).toEqual([
            {
                id: 'd-1', unitTujuan: 'Direktorat BPPT', instruksi: 'Mohon tindak lanjut', batasWaktu: '10 November 2026',
                penanggungJawab: true, status: 'Terkirim', dikirim: '3 November 2026', tembusan: 'Direktorat KTPP, unit_lama',
            },
            {
                id: 'd-2', unitTujuan: 'Direktorat PTEP', instruksi: 'Untuk diketahui', batasWaktu: '-',
                penanggungJawab: false, status: 'Diterima', dikirim: '4 November 2026', tembusan: '',
            },
        ])
    })

    it('menggabungkan catatan disposisi hasil impor', () => {
        expect(labelDisposisiSumber([' Kabag TU ', '', 'Dir. BPPT'])).toBe('Kabag TU; Dir. BPPT')
        expect(labelDisposisiSumber(null)).toBe('')
    })
})
