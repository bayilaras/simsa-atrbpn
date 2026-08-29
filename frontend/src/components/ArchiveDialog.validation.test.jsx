import { describe, expect, it } from 'vitest'
import { validateArchiveRegistration } from './archive-registration-validation'

const completeForm = {
    nomorBerkas: 'E2E/IN/001/2026',
    kodeKlasifikasi: 'TU.02.01',
    klasifikasiItemId: 89,
    jraKode: 'F.VI.A.0145',
    jraItemId: 299,
    uraianBerkas: 'Uji integrasi arsip',
    unitPengolah: 'Ditjen',
    kurunWaktuDari: '2026-01-01',
    kurunWaktuSampai: '2026-12-31',
    personInCharge: 'Tester Super Admin',
}

const completeItem = {
    nomor: '1',
    uraian: 'Uji integrasi arsip',
    perkembangan: 'Asli',
    tanggal: '2026-08-29',
    jumlah: 1,
    lokasiFc: 'FC-01',
    lokasiLaci: 'L-01',
    lokasiFolder: 'F-001',
}

describe('validateArchiveRegistration', () => {
    it('accepts a complete archive registration', () => {
        expect(validateArchiveRegistration(completeForm, [completeItem])).toBe('')
    })

    it('rejects an incomplete retention period before calling the API', () => {
        expect(validateArchiveRegistration({
            ...completeForm,
            kurunWaktuSampai: '',
        }, [completeItem])).toContain('kurun waktu lengkap')
    })

    it('rejects incomplete physical locations that the form marks as required', () => {
        expect(validateArchiveRegistration(completeForm, [{
            ...completeItem,
            lokasiFolder: '',
        }])).toContain('lokasi fisik lengkap item 1')
    })
})
