import { useEffect, useState } from 'react'
import recordAccessGrantService from '@/services/record-access-grant.service'
import userManagementService from '@/services/user-management.service'
import {
    JUMLAH_KOSONG, MENUNGGU_KEPUTUSAN_EVENT, MENUNGGU_KEPUTUSAN_REFRESH_MS,
    MENUNGGU_KEPUTUSAN_SEGARKAN_EVENT, totalDariDaftar,
} from '@/lib/menunggu-keputusan'

// Sidebar dan Dashboard memakai hook ini bersamaan. Hasil terakhir dan
// permintaan yang sedang berjalan disimpan di sini agar keduanya berbagi satu
// pasang permintaan per selang, bukan masing-masing mengirim sendiri.
let bersama = { waktu: -Infinity, nilai: JUMLAH_KOSONG }

function muatBersama(refreshMs, paksa = false) {
    if (!paksa && Date.now() - bersama.waktu < refreshMs) return
    bersama = { ...bersama, waktu: Date.now() }
    // Hanya jumlahnya yang dipakai, jadi cukup satu baris per daftar.
    Promise.allSettled([
        Promise.resolve().then(() => recordAccessGrantService.listForReview({ status: 'pending', page: 1, limit: 1 })),
        Promise.resolve().then(() => userManagementService.listUsers({ role: 'user', isActive: true, page: 1, limit: 1 })),
    ]).then(([akses, akun]) => {
        // Lencana bukan jalur kritis: bila satu daftar gagal dimuat, nilai
        // terakhirnya dipertahankan dan dicoba lagi pada selang berikutnya.
        const permohonanAkses = akses.status === 'fulfilled' ? totalDariDaftar(akses.value) : null
        const akunBaru = akun.status === 'fulfilled' ? totalDariDaftar(akun.value) : null
        bersama = {
            ...bersama,
            nilai: {
                permohonanAkses: permohonanAkses ?? bersama.nilai.permohonanAkses,
                akunBaru: akunBaru ?? bersama.nilai.akunBaru,
            },
        }
        window.dispatchEvent(new CustomEvent(MENUNGGU_KEPUTUSAN_EVENT, { detail: bersama.nilai }))
    })
}

// Permintaan hitung ulang didengar sekali, berapa pun hook yang terpasang.
let jumlahPemakai = 0
const segarkanBersama = () => muatBersama(0, true)

/** Hanya untuk pengujian. */
export function aturUlangMenungguKeputusan() {
    bersama = { waktu: -Infinity, nilai: JUMLAH_KOSONG }
}

/**
 * Jumlah permohonan akses dan akun baru yang menunggu keputusan Super Admin,
 * untuk lencana sidebar dan Dashboard. Paling sering satu pasang permintaan per
 * refreshMs, hanya saat tab terlihat; halaman yang baru memutuskan sesuatu
 * meminta hitung ulang lewat mintaSegarkanMenungguKeputusan().
 */
export function useMenungguKeputusanCount({ enabled = true, refreshMs = MENUNGGU_KEPUTUSAN_REFRESH_MS } = {}) {
    // Pemasangan kedua (mis. Dashboard setelah sidebar) mulai dari nilai terakhir.
    const [jumlah, setJumlah] = useState(() => bersama.nilai)

    useEffect(() => {
        if (!enabled) return undefined
        const muat = () => {
            if (document.visibilityState === 'hidden') return
            muatBersama(refreshMs)
        }
        const terima = (event) => {
            const nilai = event.detail
            if (nilai && Number.isFinite(nilai.permohonanAkses) && Number.isFinite(nilai.akunBaru)) setJumlah(nilai)
        }
        window.addEventListener(MENUNGGU_KEPUTUSAN_EVENT, terima)
        if (jumlahPemakai === 0) window.addEventListener(MENUNGGU_KEPUTUSAN_SEGARKAN_EVENT, segarkanBersama)
        jumlahPemakai += 1
        document.addEventListener('visibilitychange', muat)
        muat()
        const timer = window.setInterval(muat, refreshMs)
        return () => {
            window.clearInterval(timer)
            window.removeEventListener(MENUNGGU_KEPUTUSAN_EVENT, terima)
            jumlahPemakai -= 1
            if (jumlahPemakai === 0) window.removeEventListener(MENUNGGU_KEPUTUSAN_SEGARKAN_EVENT, segarkanBersama)
            document.removeEventListener('visibilitychange', muat)
        }
    }, [enabled, refreshMs])

    const nilai = enabled ? jumlah : JUMLAH_KOSONG
    return { ...nilai, total: nilai.permohonanAkses + nilai.akunBaru }
}
