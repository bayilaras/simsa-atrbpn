import { useEffect, useState } from 'react'
import rangkaianService from '@/services/rangkaian.service'
import { PERLU_DILENGKAPI_EVENT, PERLU_DILENGKAPI_REFRESH_MS } from '@/lib/perlu-dilengkapi'

/**
 * Jumlah "Perlu Dilengkapi" untuk badge sidebar (D7). Irama sama dengan notifikasi (60 detik):
 * paling sering satu permintaan per refreshMs, hanya saat tab terlihat. Ringkasan yang diumumkan
 * tab Perlu Dilengkapi (PERLU_DILENGKAPI_EVENT) dipakai tanpa request tambahan.
 */
export function usePerluDilengkapiCount({ enabled = true, refreshMs = PERLU_DILENGKAPI_REFRESH_MS } = {}) {
    const [total, setTotal] = useState(0)

    useEffect(() => {
        if (!enabled) return undefined
        let aktif = true
        let controller = null
        let terakhir = -Infinity
        const muat = () => {
            if (document.visibilityState === 'hidden') return
            if (Date.now() - terakhir < refreshMs) return
            terakhir = Date.now()
            controller?.abort()
            controller = new AbortController()
            rangkaianService.ringkasanPerluDilengkapi({}, { signal: controller.signal })
                .then((ringkasan) => { if (aktif) setTotal(Number(ringkasan?.total) || 0) })
                .catch(() => { /* Badge bukan jalur kritis: nilai terakhir dipertahankan, dicoba lagi pada siklus berikutnya. */ })
        }
        const terimaRingkasan = (event) => {
            const nilai = Number(event.detail?.total)
            if (!aktif || !Number.isFinite(nilai)) return
            terakhir = Date.now()
            setTotal(nilai)
        }
        muat()
        const timer = window.setInterval(muat, refreshMs)
        document.addEventListener('visibilitychange', muat)
        window.addEventListener(PERLU_DILENGKAPI_EVENT, terimaRingkasan)
        return () => {
            aktif = false
            controller?.abort()
            window.clearInterval(timer)
            document.removeEventListener('visibilitychange', muat)
            window.removeEventListener(PERLU_DILENGKAPI_EVENT, terimaRingkasan)
        }
    }, [enabled, refreshMs])

    return { total: enabled ? total : 0 }
}
