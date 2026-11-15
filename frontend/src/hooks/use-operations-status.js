import { useEffect, useState } from 'react'
import api from '@/services/api'
import { OPERATIONS_STATUS_EVENT, OPERATIONS_STATUS_REFRESH_MS } from '@/lib/operations-status'

const STATUS_DIKENAL = ['healthy', 'attention', 'failed']

/**
 * Status keseluruhan Monitoring Operasional untuk indikator header Super Admin.
 * Pola sama dengan usePersetujuanMenungguCount: paling sering satu permintaan
 * per refreshMs, hanya saat tab terlihat, dan status yang diumumkan halaman
 * Monitoring Operasional dipakai tanpa request tambahan. Bila gagal memuat,
 * status terakhir dipertahankan.
 */
export function useOperationsStatus({ enabled = true, refreshMs = OPERATIONS_STATUS_REFRESH_MS } = {}) {
    const [status, setStatus] = useState(null)

    useEffect(() => {
        if (!enabled) return undefined
        let aktif = true
        let terakhir = -Infinity
        const muat = () => {
            if (document.visibilityState === 'hidden') return
            if (Date.now() - terakhir < refreshMs) return
            terakhir = Date.now()
            Promise.resolve()
                .then(() => api.get('/api/operations/status'))
                .then((hasil) => { if (aktif && STATUS_DIKENAL.includes(hasil?.data?.status)) setStatus(hasil.data.status) })
                .catch(() => { /* Indikator bukan jalur kritis: status terakhir dipertahankan, dicoba lagi pada siklus berikutnya. */ })
        }
        const terimaStatus = (event) => {
            const nilai = event.detail?.status
            if (!aktif || !STATUS_DIKENAL.includes(nilai)) return
            terakhir = Date.now()
            setStatus(nilai)
        }
        muat()
        const timer = window.setInterval(muat, refreshMs)
        document.addEventListener('visibilitychange', muat)
        window.addEventListener(OPERATIONS_STATUS_EVENT, terimaStatus)
        return () => {
            aktif = false
            window.clearInterval(timer)
            document.removeEventListener('visibilitychange', muat)
            window.removeEventListener(OPERATIONS_STATUS_EVENT, terimaStatus)
        }
    }, [enabled, refreshMs])

    return { status: enabled ? status : null }
}
