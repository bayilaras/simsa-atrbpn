import { describe, expect, it } from 'vitest'
import { addImportPart, emptyImportTotals } from '@/lib/google-sheets-import'
import { importReportCsv, importReportFileName, importResultSummary, importRowsNeedingReview } from '@/lib/import-report'

const rows = [
    { row: 1, no: '1', nomorSurat: '1/UND/I/2026', tanggal: '05/01/2026', perihal: 'Undangan rapat', status: 'imported' },
    { row: 2, no: '2', nomorSurat: '1/UND/I/2026', tanggal: '06/01/2026', perihal: 'Rapat "koordinasi"; lanjutan, 2', status: 'duplicate',
        duplicate: 'source', reason: 'Nomor surat dan tahun sama dengan baris data ke-1 pada sumber ini.' },
    { row: 3, no: '3', nomorSurat: '-', tanggal: '', perihal: '=HYPERLINK("https://contoh.test")', status: 'invalid', reason: 'Tanggal surat yang valid wajib diisi.' },
    { row: 4, no: '4', nomorSurat: '', tanggal: '', perihal: '', status: 'empty', reason: 'Nomor surat dan perihal kosong.' },
]
const BOM = String.fromCharCode(0xfeff)

describe('import row report CSV', () => {
    it('lists every row separated by semicolons, as Excel with Indonesian regional settings reads it', () => {
        const lines = importReportCsv(rows).split('\r\n')
        expect(lines[0]).toBe(`${BOM}Baris;No;Nomor Surat;Tanggal;Perihal;Status;Keterangan`)
        expect(lines[1]).toBe('1;1;1/UND/I/2026;05/01/2026;Undangan rapat;Tersimpan;')
        expect(lines[2]).toBe('2;2;1/UND/I/2026;06/01/2026;"Rapat ""koordinasi""; lanjutan, 2";Duplikat;Nomor surat dan tahun sama dengan baris data ke-1 pada sumber ini.')
        expect(lines[4]).toBe('4;4;;;;Kosong;Nomor surat dan perihal kosong.')
        expect(lines).toHaveLength(5)
    })

    it('keeps a spreadsheet from running a cell as a formula but leaves an unnumbered "-" as written', () => {
        const line = importReportCsv([rows[2]]).split('\r\n')[1]
        expect(line).toBe('3;3;-;;"\'=HYPERLINK(""https://contoh.test"")";Ditolak;Tanggal surat yang valid wajib diisi.')
        expect(importReportCsv([{ ...rows[0], perihal: '-1+1', nomorSurat: '+62', no: '@a' }]).split('\r\n')[1])
            .toBe("1;'@a;'+62;05/01/2026;'-1+1;Tersimpan;")
    })

    it('names the file after the import type and time', () => {
        expect(importReportFileName('surat-keluar', new Date(2026, 9, 21, 8, 5))).toBe('laporan-impor-surat-keluar-20261021-0805.csv')
    })

    it('selects only rows that need action: repeats inside the source, deleted letters, rejected and not-updated rows', () => {
        const more = [...rows,
            { row: 5, status: 'duplicate', duplicate: 'recorded', reason: 'Sudah tercatat di SIMSA pada unit ini.' },
            { row: 6, status: 'duplicate', duplicate: 'recorded', reason: 'Sudah tercatat; tidak ada perubahan.' },
            { row: 7, status: 'duplicate', duplicate: 'deleted' },
            { row: 8, status: 'locked' }, { row: 9, status: 'updated' }]
        expect(importRowsNeedingReview(more).map(row => row.row)).toEqual([2, 3, 7, 8])
    })
})

describe('import result summary', () => {
    const result = fields => ({ success: true, totalRows: 6, importedRows: 0, updatedRows: 0, duplicateRows: 0, skippedRows: 0, errors: [], ...fields })

    it('says how many rows were recorded already, repeated in the source, or match a deleted letter', () => {
        const summary = importResultSummary(result({ importedRows: 1, duplicateRows: 5, rows: [
            { status: 'imported' }, { status: 'duplicate', duplicate: 'recorded' }, { status: 'duplicate', duplicate: 'recorded' },
            { status: 'duplicate', duplicate: 'source' }, { status: 'duplicate', duplicate: 'deleted' }, { status: 'locked' }] }))
        expect(summary.duplicateLines).toEqual(['2 baris sudah tercatat di SIMSA', '1 baris ganda di sumber (dilewati)',
            '1 baris cocok dengan surat yang sudah dihapus (tidak dibuat ulang)'])
        expect(summary.lockedRows).toBe(1)
    })

    it('keeps the earlier wording for a server that reports no rows', () => {
        expect(importResultSummary(result({ duplicateRows: 3 })).duplicateLines).toEqual(['3 baris duplikat dilewati (sudah ada di sistem)'])
    })
})

describe('row outcomes across resumable parts', () => {
    it('keeps every part\'s rows in order', () => {
        const first = addImportPart(emptyImportTotals(4), { success: true, totalRows: 4, importedRows: 1, duplicateRows: 1,
            skippedRows: 0, errors: [], rows: rows.slice(0, 2), startRow: 0, nextRow: 2, prefixHash: 'h1' })
        const second = addImportPart(first, { success: false, totalRows: 4, importedRows: 0, duplicateRows: 0,
            skippedRows: 2, errors: ['Row 3: x'], rows: rows.slice(2), startRow: 2, nextRow: null })
        expect(second.rows.map(row => row.row)).toEqual([1, 2, 3, 4])
    })

    it('has no rows from a server that does not report them', () => {
        expect(addImportPart(emptyImportTotals(3), { success: true, totalRows: 3, importedRows: 3, duplicateRows: 0, skippedRows: 0, errors: [] }).rows)
            .toEqual([])
    })
})
