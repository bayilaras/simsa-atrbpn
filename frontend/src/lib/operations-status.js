/** Indikator header: paling sering satu permintaan per 5 menit. */
export const OPERATIONS_STATUS_REFRESH_MS = 5 * 60_000
export const OPERATIONS_STATUS_EVENT = 'simsa:status-operasional'
export const TAUTAN_MONITORING_OPERASIONAL = '/monitoring-operasional'

/** Halaman Monitoring Operasional membagikan status terbarunya ke header tanpa request tambahan. */
export function umumkanStatusOperasional(status) {
    if (typeof status !== 'string') return
    window.dispatchEvent(new CustomEvent(OPERATIONS_STATUS_EVENT, { detail: { status } }))
}
