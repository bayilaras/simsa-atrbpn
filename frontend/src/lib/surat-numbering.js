export function buildOutgoingNumberingPayload(nomorSurat) {
    const manualNumber = typeof nomorSurat === 'string' ? nomorSurat.trim() : '';
    return manualNumber
        ? { numberingMode: 'manual', nomorSurat: manualNumber }
        : { numberingMode: 'auto' };
}
