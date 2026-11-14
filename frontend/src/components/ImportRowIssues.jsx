import { AlertCircle } from 'lucide-react'
import { previewDuplicateLines } from '@/lib/import-report'

/**
 * Preview notice, shown before Impor: the rows of the whole source the import
 * will reject, judged by the server with the import's own checks (an older
 * server judges only the date), and the rows it will skip as duplicates. The
 * import stays available; the other rows are stored.
 */
export default function ImportRowIssues({ issues, duplicates, totalRows }) {
    const lines = previewDuplicateLines(duplicates)
    if (!issues?.total && !lines.length) return null
    const more = issues?.total ? issues.total - (issues.rows?.length || 0) : 0
    return <div className="space-y-2">
        {issues?.total > 0 && <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
            <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 space-y-1">
                <p className="font-medium">{`${issues.total} dari ${totalRows} baris akan ditolak`}</p>
                <p>Baris lain tetap dapat diimpor. Baris yang ditolak tidak disimpan; alasannya tercantum di bawah. Setelah sumber data diperbaiki, buat pratinjau lagi.</p>
                <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs">
                    {(issues.rows || []).map(issue => <li key={issue.row} className="break-words">{`Baris data ke-${issue.row}: ${issue.reason}`}</li>)}
                    {more > 0 && <li>{`dan ${more} baris lainnya.`}</li>}
                </ul>
            </div>
        </div>}
        {lines.length > 0 && <ul aria-label="Baris yang akan dilewati" className="space-y-0.5 rounded-lg border p-3 text-sm text-muted-foreground">
            {lines.map(line => <li key={line}>{line}</li>)}
        </ul>}
    </div>
}
