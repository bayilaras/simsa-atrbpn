import { describe, expect, it, vi } from 'vitest'
import { PESAN_LINK_DOKUMEN_TIDAK_VALID, buildSuratFormPayload, linkDokumenError } from './surat-form-payload'

describe('surat metadata updates without document services', () => {
    it('omits a hidden empty document field from JSON so an existing link is retained', () => {
        const form = { perihal: 'Perihal diperbarui', linkDokumen: '', klasifikasiKode: 'KU.01' }
        const sent = JSON.parse(JSON.stringify(buildSuratFormPayload(form, 'unit-a', false)))
        expect(sent).toEqual({ perihal: 'Perihal diperbarui', klasifikasiKode: 'KU.01', unitKerjaId: 'unit-a' })
        expect(Object.hasOwn(sent, 'linkDokumen')).toBe(false)
        expect(form.linkDokumen).toBe('')
    })
    it('preserves intentional document edits only when its editor is available', () => {
        expect(buildSuratFormPayload({ linkDokumen: 'https://example.test/existing' }, 'unit-a', true).linkDokumen)
            .toBe('https://example.test/existing')
        expect(buildSuratFormPayload({ linkDokumen: '' }, 'unit-a', true).linkDokumen).toBe('')
    })

    it('submits selected rule IDs without trusting editable retention preview text', () => {
        const payload = JSON.parse(JSON.stringify(buildSuratFormPayload({ klasifikasiItemId: 82, jraItemId: 97, klasifikasiKode: 'BP.02.02', klasifikasiUraian: 'Bimbingan Teknis dan Supervisi', jraKode: 'S.III.01', jraRetensiAktif: 'Edited preview', jraKeterangan: 'Edited outcome' }, 'unit-a', false)))
        expect(payload).toEqual({ klasifikasiItemId: 82, jraItemId: 97, klasifikasiKode: 'BP.02.02', klasifikasiUraian: 'Bimbingan Teknis dan Supervisi', unitKerjaId: 'unit-a' })
    })
})

describe('link dokumen opsional', () => {
    it('menerima isian kosong dan alamat lengkap', () => {
        for (const nilai of ['', null, undefined, 'https://example.test/berkas.pdf', 'http://example.test/a?b=1']) {
            expect(linkDokumenError(nilai)).toBeNull()
        }
    })
    it('menolak teks yang bukan alamat lengkap', () => {
        for (const nilai of ['drive saya', 'example.test/berkas.pdf', '   ']) {
            expect(linkDokumenError(nilai)).toBe(PESAN_LINK_DOKUMEN_TIDAK_VALID)
        }
    })
    it('tetap bekerja di peramban tanpa URL.canParse', () => {
        vi.spyOn(URL, 'canParse').mockImplementation(() => { throw new TypeError('URL.canParse is not a function') })
        try {
            expect(linkDokumenError('https://example.test/berkas.pdf')).toBeNull()
            expect(linkDokumenError('drive saya')).toBe(PESAN_LINK_DOKUMEN_TIDAK_VALID)
        } finally {
            vi.restoreAllMocks()
        }
    })
})
