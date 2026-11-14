import { describe, expect, it } from 'vitest'
import {
    formatTahun,
    kemajuanRetensiAktif,
    keteranganRetensiKosong,
    keteranganRetensiSingkat,
    PESAN_MENUNGGU_PEMICU_RETENSI,
    PESAN_MENUNGGU_REKONSILIASI_ATURAN,
} from './retensi-arsip'

const terverifikasi = {
    ruleProvenanceStatus: 'verified',
    currentRetentionTriggerEventId: 'pemicu-1',
    retentionTriggerDate: '2024-01-01',
    canonicalRetention: {
        verified: true,
        normalizedRetention: { activeMonths: 24, inactiveMonths: 60, calculationMode: 'duration', dispositionCode: 'musnah' },
        dates: { tanggalAktifBerakhir: '2026-01-01', tanggalInaktifBerakhir: '2031-01-01', tanggalKadaluarsa: '2031-01-01' },
    },
}
const tanpaPemicu = {
    ruleProvenanceStatus: 'verified',
    currentRetentionTriggerEventId: null,
    retentionTriggerDate: null,
    canonicalRetention: { verified: false, dates: { tanggalAktifBerakhir: null, tanggalInaktifBerakhir: null, tanggalKadaluarsa: null } },
}

describe('keteranganRetensiKosong', () => {
    it('menunggu verifikasi pemicu bila aturan sudah terverifikasi tetapi belum ada pemicu terverifikasi', () => {
        expect(keteranganRetensiKosong(tanpaPemicu)).toBe(PESAN_MENUNGGU_PEMICU_RETENSI)
    })

    it('menunggu rekonsiliasi bila klasifikasi dan JRA arsip belum terverifikasi', () => {
        expect(keteranganRetensiKosong({ ...tanpaPemicu, ruleProvenanceStatus: 'legacy_unverified' })).toBe(PESAN_MENUNGGU_REKONSILIASI_ATURAN)
        expect(keteranganRetensiKosong({ ...tanpaPemicu, ruleProvenanceStatus: 'pending_jra' })).toBe(PESAN_MENUNGGU_REKONSILIASI_ATURAN)
    })

    it('tidak memberi keterangan setelah evaluasi terverifikasi atau bila pemicu sudah tercatat tetapi evaluasi ditolak karena hal lain', () => {
        expect(keteranganRetensiKosong(terverifikasi)).toBeNull()
        expect(keteranganRetensiKosong({ ...terverifikasi, canonicalRetention: { verified: false } })).toBeNull()
        expect(keteranganRetensiKosong(null)).toBeNull()
    })
})

describe('kemajuanRetensiAktif', () => {
    it('menghitung dari tanggal pemicu terverifikasi sampai akhir masa aktif', () => {
        const kemajuan = kemajuanRetensiAktif(terverifikasi, new Date(2025, 0, 1))
        expect(Math.round(kemajuan.persen)).toBe(50)
        expect(kemajuan.tahunAktif).toBe(2)
        expect(formatTahun(kemajuan.tahunBerjalan)).toBe('1,0')
        expect(kemajuan.tanggalPemicu).toBe('2024-01-01')
    })

    it('dibatasi 0 sampai 100 persen', () => {
        expect(kemajuanRetensiAktif(terverifikasi, new Date(2023, 5, 1)).persen).toBe(0)
        expect(kemajuanRetensiAktif(terverifikasi, new Date(2027, 5, 1)).persen).toBe(100)
    })

    it('tidak ada kemajuan tanpa pemicu terverifikasi atau tanpa masa aktif yang dihitung', () => {
        expect(kemajuanRetensiAktif(tanpaPemicu, new Date(2025, 0, 1))).toBeNull()
        expect(kemajuanRetensiAktif({ ...terverifikasi, canonicalRetention: { ...terverifikasi.canonicalRetention, verified: false } })).toBeNull()
        expect(kemajuanRetensiAktif({
            ...terverifikasi,
            canonicalRetention: { ...terverifikasi.canonicalRetention, dates: { tanggalAktifBerakhir: null, tanggalInaktifBerakhir: null, tanggalKadaluarsa: null } },
        })).toBeNull()
        expect(kemajuanRetensiAktif({
            ...terverifikasi,
            canonicalRetention: {
                ...terverifikasi.canonicalRetention,
                normalizedRetention: { ...terverifikasi.canonicalRetention.normalizedRetention, activeMonths: 0 },
                dates: { tanggalAktifBerakhir: '2024-01-01', tanggalInaktifBerakhir: '2029-01-01', tanggalKadaluarsa: '2029-01-01' },
            },
        })).toBeNull()
    })
})

describe('keteranganRetensiSingkat', () => {
    it('memendekkan keterangan untuk kolom sempit', () => {
        expect(keteranganRetensiSingkat(PESAN_MENUNGGU_PEMICU_RETENSI)).toBe('Menunggu verifikasi')
        expect(keteranganRetensiSingkat(PESAN_MENUNGGU_REKONSILIASI_ATURAN)).toBe('Menunggu rekonsiliasi')
        expect(keteranganRetensiSingkat(null)).toBeNull()
    })
})

describe('formatTahun', () => {
    it('memakai koma desimal dan paling banyak satu angka di belakang koma', () => {
        expect(formatTahun(1.04)).toBe('1,0')
        expect(formatTahun(2, 0)).toBe('2')
        expect(formatTahun(1.5, 0)).toBe('1,5')
    })
})
