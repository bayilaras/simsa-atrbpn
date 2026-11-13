import { useEffect, useState } from 'react'
import approvalService from '@/services/approval.service'
import { PERSETUJUAN_MENUNGGU_EVENT, PERSETUJUAN_MENUNGGU_REFRESH_MS } from '@/lib/persetujuan-menunggu'

/**
 * Jumlah surat keluar yang menunggu keputusan pengguna ini, untuk badge sidebar
 * dan Dashboard. Pola sama dengan usePerluDilengkapiCount: paling sering satu
 * permintaan per refreshMs, hanya saat tab terlihat, dan jumlah yang diumumkan
 * halaman Surat Keluar dipakai tanpa request tambahan.
 */
export function usePersetujuanMenungguCount({ enabled = true, refreshMs = PERSETUJUAN_MENUNGGU_REFRESH_MS } = {}) {
    const [total, setTotal] = useState(0)

    useEffect(() => {
        if (!enabled) return undefined
        let aktif = true
        let terakhir = -Infinity
        const muat = () => {
            if (document.visibilityState === 'hidden') return
            if (Date.now() - terakhir < refreshMs) return
            terakhir = Date.now()
            Promise.resolve()
                .then(() => approvalService.getPending())
                .then((daftar) => { if (aktif) setTotal(Array.isArray(daftar) ? daftar.length : 0) })
                .catch(() => { /* Badge bukan jalur kritis: nilai terakhir dipertahankan, dicoba lagi pada siklus berikutnya. */ })
        }
        const terimaJumlah = (event) => {
            const nilai = Number(event.detail?.total)
            if (!aktif || !Number.isFinite(nilai)) return
            terakhir = Date.now()
            setTotal(nilai)
        }
        muat()
        const timer = window.setInterval(muat, refreshMs)
        document.addEventListener('visibilitychange', muat)
        window.addEventListener(PERSETUJUAN_MENUNGGU_EVENT, terimaJumlah)
        return () => {
            aktif = false
            window.clearInterval(timer)
            document.removeEventListener('visibilitychange', muat)
            window.removeEventListener(PERSETUJUAN_MENUNGGU_EVENT, terimaJumlah)
        }
    }, [enabled, refreshMs])

    return { total: enabled ? total : 0 }
}
