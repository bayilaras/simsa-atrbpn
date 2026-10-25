import { describe, expect, it } from 'vitest'
import { buildSuratArchiveSelection, omitSuratArchivePreviews, readSuratArchiveSelection, selectedSuratArchiveRules, validateSuratArchiveSelection } from './surat-archive-selection'

const classification = { id: 102, kode: 'HT.01.01', jenis: 'Penetapan hak', tipe: 'substantif' }
const retention = { id: 56, kode: 'S.III.01', uraian: 'Penetapan hak atas tanah', retensiAktif: '2 tahun', retensiInaktif: '3 tahun', keterangan: 'Permanen' }

describe('classification and retention selection in surat', () => {
    it('keeps distinct authoritative IDs when outgoing classifications are substantive', () => {
        const result = buildSuratArchiveSelection(classification.kode, classification, retention, 'keluar')
        expect(result).toMatchObject({ klasifikasiItemId: 102, jraItemId: 56, klasifikasiSubstantifKode: 'HT.01.01', klasifikasiFasilitatifKode: '', jraKode: 'S.III.01' })
        expect(selectedSuratArchiveRules(result)).toMatchObject({ classification: { id: 102, kode: 'HT.01.01' }, retention: { id: 56, kode: 'S.III.01' } })
    })

    it('clears both IDs and both outgoing classification categories together', () => {
        expect(buildSuratArchiveSelection('', null, null, 'keluar')).toMatchObject({ klasifikasiItemId: null, jraItemId: null, klasifikasiSubstantifKode: '', klasifikasiFasilitatifKode: '', jraKode: '' })
    })

    it('preserves legacy metadata without claiming an explicit rule deletion', () => {
        expect(readSuratArchiveSelection({ klasifikasiKode: 'TU.01' })).toMatchObject({ klasifikasiItemId: undefined, jraItemId: undefined })
    })

    it('sends identity fields while leaving retention text under server control', () => {
        const selection = buildSuratArchiveSelection(classification.kode, classification, retention)
        expect(omitSuratArchivePreviews(selection)).toEqual({ klasifikasiItemId: 102, jraItemId: 56, klasifikasiKode: 'HT.01.01', klasifikasiUraian: 'Penetapan hak' })
    })

    it('keeps zero retention values when selecting and reopening a saved pair', () => {
        const selected = buildSuratArchiveSelection(classification.kode, classification, { ...retention, retensiAktif: 0, retensiInaktif: 0 })
        expect(selectedSuratArchiveRules(readSuratArchiveSelection(selected)).retention).toMatchObject({ retensiAktif: 0, retensiInaktif: 0 })
    })

    it('uses the label from the selected outgoing category rather than a stale other label', () => {
        expect(selectedSuratArchiveRules({ klasifikasiFasilitatif: 'Stale label', klasifikasiSubstantifKode: 'BP.02.02', klasifikasiSubstantif: 'Bimbingan Teknis dan Supervisi' }).classification)
            .toMatchObject({ kode: 'BP.02.02', jenis: 'Bimbingan Teknis dan Supervisi', tipe: 'substantif' })
    })

    it('allows legacy classification-only metadata edits and rejects unidentified retention', () => {
        expect(validateSuratArchiveSelection({ klasifikasiKode: 'BP.02.02' })).toBe('')
        expect(validateSuratArchiveSelection({ klasifikasiItemId: 82, jraItemId: 97, jraKode: 'S.III.01' })).toBe('')
        expect(validateSuratArchiveSelection({ jraKode: 'S.III.01' })).toContain('Pilih ulang')
    })
})
