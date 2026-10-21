// Per-row outcomes of a surat import, as the server reports them for every data row.
export const IMPORT_ROW_STATUS_LABELS = {
    imported: 'Tersimpan',
    updated: 'Diperbarui',
    duplicate: 'Duplikat',
    locked: 'Tidak diperbarui',
    invalid: 'Ditolak',
    empty: 'Kosong',
}

const REVIEW_STATUSES = new Set(['locked', 'invalid'])

/**
 * Rows that need action: rejected rows, rows whose letter could not be updated,
 * rows repeating an earlier source row, and rows matching a deleted letter. A
 * letter already recorded (with nothing to change) needs none.
 */
export function importRowsNeedingReview(rows) {
    return rows.filter(row => REVIEW_STATUSES.has(row.status) || (row.status === 'duplicate' && row.duplicate !== 'recorded'))
}

const DUPLICATE_LINES = [
    ['recorded', count => `${count} baris sudah tercatat di SIMSA`],
    ['source', count => `${count} baris ganda di sumber (dilewati)`],
    ['deleted', count => `${count} baris cocok dengan surat yang sudah dihapus (tidak dibuat ulang)`],
]

/** Duplicate counts by kind; a server without per-row outcomes keeps the single earlier line. */
function duplicateLines(result) {
    if (!result.rows?.length) return result.duplicateRows > 0 ? [`${result.duplicateRows} baris duplikat dilewati (sudah ada di sistem)`] : []
    const counts = {}
    for (const row of result.rows) if (row.status === 'duplicate') counts[row.duplicate ?? 'recorded'] = (counts[row.duplicate ?? 'recorded'] || 0) + 1
    return DUPLICATE_LINES.filter(([kind]) => counts[kind]).map(([kind, line]) => line(counts[kind]))
}

/**
 * The headline of an import result. Rows a sinkron could not update keep the
 * result from reading as "all data already exists".
 */
export function importResultSummary(result) {
    const lockedRows = (result.rows || []).filter(row => row.status === 'locked').length
    const duplicateOnly = result.success === true && !result.importedRows && !result.updatedRows && result.duplicateRows > 0
        && !result.skippedRows && !result.errors?.length && !lockedRows
    const title = result.notice ? 'Impor belum selesai' : result.importedRows > 0 ? 'Impor berhasil!'
        : result.updatedRows > 0 ? 'Data diperbarui' : lockedRows > 0 ? 'Perubahan belum diterapkan'
            : duplicateOnly ? 'Semua data sudah ada' : 'Impor gagal'
    const tone = result.notice || lockedRows > 0 ? 'warning'
        : result.importedRows > 0 || result.updatedRows > 0 || duplicateOnly ? 'success' : 'error'
    return { title, tone, duplicateOnly, lockedRows, duplicateLines: duplicateLines(result) }
}

// Excel with Indonesian regional settings (and others whose list separator is
// ";", decimal ",") splits a CSV on semicolons; Google Sheets detects either.
const CSV_SEPARATOR = ';'

// A spreadsheet program runs a cell starting with these as a formula. A lone
// "-" (an unnumbered letter) is no formula and stays as written.
function csvCell(value) {
    let text = value === undefined || value === null ? '' : String(value)
    if (/^[=+@\t\r]/.test(text) || /^-./.test(text)) text = `'${text}`
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function changeText(changes) {
    return (changes || []).map(change => `${change.label}: ${change.before ?? '(kosong)'} → ${change.after ?? '(kosong)'}`).join('; ')
}

const UTF8_BOM = String.fromCharCode(0xfeff)

/** The report as semicolon-separated CSV with a BOM, so spreadsheet programs read it as UTF-8. */
export function importReportCsv(rows) {
    const header = ['Baris', 'No', 'Nomor Surat', 'Tanggal', 'Perihal', 'Status', 'Keterangan']
    const lines = rows.map(row => [row.row, row.no, row.nomorSurat, row.tanggal, row.perihal,
        IMPORT_ROW_STATUS_LABELS[row.status] || row.status,
        [row.reason, changeText(row.changes)].filter(Boolean).join(' ')].map(csvCell).join(CSV_SEPARATOR))
    return `${UTF8_BOM}${[header.join(CSV_SEPARATOR), ...lines].join('\r\n')}`
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
