import { useId, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { downloadImportReport, IMPORT_ROW_STATUS_LABELS, importRowsNeedingReview } from '@/lib/import-report'

const STATUS_STYLES = {
    imported: 'text-emerald-700 dark:text-emerald-300',
    updated: 'text-blue-700 dark:text-blue-300',
    duplicate: 'text-muted-foreground',
    locked: 'text-amber-700 dark:text-amber-300',
    invalid: 'text-red-700 dark:text-red-300',
    empty: 'text-muted-foreground',
}

/**
 * The outcome of every data row of an import, filterable by status and
 * downloadable as CSV. Opens on the rows that need a look when there are any.
 * Row numbers count data rows from 1, as the server and progress notices do.
 */
export default function ImportRowReport({ rows, type }) {
    const filterId = useId()
    const review = importRowsNeedingReview(rows || [])
    const [filter, setFilter] = useState(review.length ? 'review' : 'all')
    if (!rows?.length) return null

    const counts = rows.reduce((total, row) => ({ ...total, [row.status]: (total[row.status] || 0) + 1 }), {})
    const shown = filter === 'review' ? review : filter === 'all' ? rows : rows.filter(row => row.status === filter)
    return <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="space-y-1">
                <label htmlFor={filterId} className="block text-xs font-medium text-muted-foreground">Tampilkan</label>
                <select id={filterId} value={filter} onChange={event => setFilter(event.target.value)}
                    className="min-h-9 rounded-md border bg-background px-2 text-sm">
                    {review.length > 0 && <option value="review">{`Perlu dicek (${review.length})`}</option>}
                    <option value="all">{`Semua (${rows.length})`}</option>
                    {Object.keys(IMPORT_ROW_STATUS_LABELS).filter(status => counts[status]).map(status =>
                        <option key={status} value={status}>{`${IMPORT_ROW_STATUS_LABELS[status]} (${counts[status]})`}</option>)}
                </select>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => downloadImportReport(rows, type)}>
                <Download aria-hidden="true" className="mr-2 h-3.5 w-3.5" />Unduh laporan (CSV)
            </Button>
        </div>
        <div className="max-h-72 overflow-auto rounded-lg border">
            <table className="w-full text-xs">
                <caption className="sr-only">Rincian hasil impor per baris</caption>
                <thead className="sticky top-0 bg-muted"><tr className="border-b">
                    {['Baris', 'No.', 'Nomor surat', 'Tanggal', 'Perihal', 'Status', 'Keterangan'].map(title =>
                        <th key={title} scope="col" className="whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">{title}</th>)}
                </tr></thead>
                <tbody>{shown.map(row => <tr key={row.row} className="border-b align-top last:border-0">
                    <td className="px-2 py-1.5 tabular-nums">{row.row}</td>
                    <td className="px-2 py-1.5">{row.no}</td>
                    <td className="max-w-[12rem] break-words px-2 py-1.5">{row.nomorSurat}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.tanggal}</td>
                    <td className="max-w-[16rem] break-words px-2 py-1.5">{row.perihal}</td>
                    <td className={`whitespace-nowrap px-2 py-1.5 font-medium ${STATUS_STYLES[row.status] || ''}`}>{IMPORT_ROW_STATUS_LABELS[row.status] || row.status}</td>
                    <td className="min-w-[14rem] px-2 py-1.5">
                        {row.reason}
                        {row.changes?.length > 0 && <ul className="mt-1 space-y-0.5">{row.changes.map(change =>
                            <li key={change.field} className="break-words"><span className="font-medium">{change.label}:</span> {change.before ?? '(kosong)'} → {change.after ?? '(kosong)'}</li>)}</ul>}
                    </td>
                </tr>)}</tbody>
            </table>
        </div>
    </div>
}
