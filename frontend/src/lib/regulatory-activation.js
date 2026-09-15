export const ACTIVATABLE_RULE_SET_STATUSES = Object.freeze(['draft', 'submitted', 'reviewed', 'approved'])

export function regulatoryActivationBlocker(ruleSet, now = Date.now()) {
    if (!ACTIVATABLE_RULE_SET_STATUSES.includes(ruleSet?.status)) return 'Versi ini tidak dapat diaktifkan.'
    const dateParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const date = Object.fromEntries(dateParts.map(part => [part.type, part.value]))
    const today = `${date.year}-${date.month}-${date.day}`
    if (ruleSet.effectiveFrom && ruleSet.effectiveFrom > today) return 'Tanggal mulai berlaku belum tiba.'
    if (!ruleSet.sourceDocumentStored || !ruleSet.sourceDocumentVerifiedAt) return 'Lengkapi dan verifikasi PDF sumber terlebih dahulu.'
    if (!ruleSet.completenessVerifiedAt) return 'Verifikasi manifest kelengkapan terlebih dahulu.'
    if (!ruleSet.impactReportGeneratedAt) return 'Buat analisis dampak terlebih dahulu.'
    return ''
}
