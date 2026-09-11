import { describe, expect, it } from 'vitest'
import { buildSuratFormPayload } from './surat-form-payload'

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
})
