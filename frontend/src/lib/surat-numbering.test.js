import { describe, expect, it } from 'vitest';
import { buildOutgoingNumberingPayload } from './surat-numbering';

describe('buildOutgoingNumberingPayload', () => {
    it('does not promote a preview into an authoritative manual number', () => {
        expect(buildOutgoingNumberingPayload('')).toEqual({ numberingMode: 'auto' });
        expect(buildOutgoingNumberingPayload(undefined)).toEqual({ numberingMode: 'auto' });
    });

    it('sends a trimmed user-entered number with explicit manual intent', () => {
        expect(buildOutgoingNumberingPayload('  MANUAL/7/2026  ')).toEqual({
            numberingMode: 'manual',
            nomorSurat: 'MANUAL/7/2026',
        });
    });
});
