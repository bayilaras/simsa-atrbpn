// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { regulatoryActivationBlocker } from './regulatory-activation'

const prepared = {
    status: 'draft', effectiveFrom: '2026-09-13', sourceDocumentStored: true,
    sourceDocumentVerifiedAt: '2026-09-12', completenessVerifiedAt: '2026-09-12',
    impactReportGeneratedAt: '2026-09-12',
}
const midnightJakarta = Date.parse('2026-09-12T17:00:00Z')

describe('direct catalogue activation eligibility', () => {
    it.each(['draft', 'submitted', 'reviewed', 'approved'])('accepts prepared %s without fabricated review or approval fields', status => {
        expect(regulatoryActivationBlocker({ ...prepared, status }, midnightJakarta)).toBe('')
    })
    it('uses the Jakarta effective date boundary', () => {
        expect(regulatoryActivationBlocker(prepared, midnightJakarta - 1)).toMatch(/belum tiba/)
        expect(regulatoryActivationBlocker(prepared, midnightJakarta)).toBe('')
    })
    it.each([
        ['sourceDocumentStored', false, /PDF sumber/],
        ['sourceDocumentVerifiedAt', null, /PDF sumber/],
        ['completenessVerifiedAt', null, /manifest/],
        ['impactReportGeneratedAt', null, /dampak/],
    ])('blocks incomplete %s evidence', (field, value, message) => {
        expect(regulatoryActivationBlocker({ ...prepared, [field]: value }, midnightJakarta)).toMatch(message)
    })
    it.each(['active', 'superseded', 'withdrawn'])('keeps historical %s versions immutable', status => {
        expect(regulatoryActivationBlocker({ ...prepared, status }, midnightJakarta)).toMatch(/tidak dapat/)
    })
})
