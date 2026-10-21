// Per-row outcomes of a surat import, as the server reports them for every data row.
export const IMPORT_ROW_STATUS_LABELS = {
    imported: 'Tersimpan',
    updated: 'Diperbarui',
    duplicate: 'Duplikat',
    locked: 'Tidak diperbarui',
    invalid: 'Ditolak',
    empty: 'Kosong',
}

const REVIEW_STATUSES = new Set(['duplicate', 'locked', 'invalid'])

/** Rows a person should look at: duplicates, rejected rows, and rows whose letter could not be updated. */
export function importRowsNeedingReview(rows) {
    return rows.filter(row => REVIEW_STATUSES.has(row.status))
}

// A spreadsheet program runs a cell starting with these as a formula. A lone
// "-" (an unnumbered letter) is no formula and stays as written.
function csvCell(value) {
    let text = value === undefined || value === null ? '' : String(value)
    if (/^[=+@\t\r]/.test(text) || /^-./.test(text)) text = `'${text}`
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function changeText(changes) {
    return (changes || []).map(change => `${change.label}: ${change.before ?? '(kosong)'} → ${change.after ?? '(kosong)'}`).join('; ')
}

const UTF8_BOM = String.fromCharCode(0xfeff)

/** The report as CSV with a BOM, so spreadsheet programs read it as UTF-8. */
export function importReportCsv(rows) {
    const header = ['Baris', 'No', 'Nomor Surat', 'Tanggal', 'Perihal', 'Status', 'Keterangan']
    const lines = rows.map(row => [row.row, row.no, row.nomorSurat, row.tanggal, row.perihal,
        IMPORT_ROW_STATUS_LABELS[row.status] || row.status,
        [row.reason, changeText(row.changes)].filter(Boolean).join(' ')].map(csvCell).join(','))
    return `${UTF8_BOM}${[header.join(','), ...lines].join('\r\n')}`
}

export function importReportFileName(type, date = new Date()) {
    const pad = value => String(value).padStart(2, '0')
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
    return `laporan-impor-${type}-${stamp}.csv`
}

export function downloadImportReport(rows, type) {
    const url = window.URL.createObjectURL(new Blob([importReportCsv(rows)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', importReportFileName(type))
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
}
