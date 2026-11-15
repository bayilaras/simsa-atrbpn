import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useOperationsStatus } from '@/hooks/use-operations-status'
import { TAUTAN_MONITORING_OPERASIONAL } from '@/lib/operations-status'

// Warna sama dengan lencana status di halaman Monitoring Operasional.
const TAMPILAN = {
    attention: { label: 'perlu perhatian', className: 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900' },
    failed: { label: 'gagal', className: 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900' },
}

/**
 * Tanda di header bagi Super Admin saat Monitoring Operasional tidak sehat.
 * Tidak tampil untuk peran lain dan tidak meminta status untuk mereka.
 */
export function OperationsStatusIndicator() {
    const { user } = useAuth()
    const { status } = useOperationsStatus({ enabled: user?.role === 'super_admin' })
    const tampilan = TAMPILAN[status]
    if (!tampilan) return null
    return (
        <Link
            to={TAUTAN_MONITORING_OPERASIONAL}
            aria-label={`Monitoring Operasional: ${tampilan.label}. Buka halaman Monitoring Operasional.`}
            title={`Monitoring Operasional: ${tampilan.label}`}
            className={`inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tampilan.className}`}
        >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="hidden xl:inline">Operasional: {tampilan.label}</span>
        </Link>
    )
}
