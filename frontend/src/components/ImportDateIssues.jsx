import { AlertCircle } from 'lucide-react'

/**
 * Preview notice: the rows of the whole source whose date the import will
 * reject, as the server read them with the import's own date rules. The
 * import stays available; these rows are reported as rejected.
 */
export default function ImportDateIssues({ issues, totalRows }) {
    if (!issues?.total) return null
    const more = issues.total - (issues.rows?.length || 0)
    return <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
        <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 space-y-1">
            <p className="font-medium">{`${issues.total} dari ${totalRows} baris akan ditolak karena tanggalnya`}</p>
            <p>Baris lain tetap dapat diimpor. Perbaiki tanggal di sumber data, lalu buat pratinjau lagi agar baris ini ikut tersimpan.</p>
            <ul className="space-y-0.5 text-xs">
                {(issues.rows || []).map(issue => <li key={issue.row} className="break-words">{`Baris data ke-${issue.row}: ${issue.reason}`}</li>)}
                {more > 0 && <li>{`dan ${more} baris lainnya.`}</li>}
            </ul>
        </div>
    </div>
}
