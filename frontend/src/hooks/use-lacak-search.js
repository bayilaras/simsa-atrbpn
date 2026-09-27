import { useEffect, useState } from 'react'
import rangkaianService from '@/services/rangkaian.service'

const DEBOUNCE_MS = 300
const MIN_KARAKTER = 3
const BATAS_CACHE = 20
const KOSONG = { loading: false, error: null, data: null }

function simpan(prev, kunci, data) {
    const next = new Map(prev)
    next.delete(kunci)
    next.set(kunci, data)
    if (next.size > BATAS_CACHE) next.delete(next.keys().next().value)
    return next
}

/**
 * Pencarian Lacak dengan debounce, AbortController, penjaga respons basi, dan cache LRU 20 entri per hook (§6).
 * Tanpa setState sinkron di badan effect (react-hooks/set-state-in-effect): keadaan kosong/cache diturunkan saat render,
 * semua setState berada di callback timer.
 */
export function useLacakSearch(term, { mode = 'lacak', jenis, tahun, enabled = true } = {}) {
    const q = (term || '').trim()
    const kunci = enabled && q.length >= MIN_KARAKTER ? JSON.stringify([q, mode, jenis ?? null, tahun ?? null]) : null
    const [cache, setCache] = useState(() => new Map())
    const [gagal, setGagal] = useState({ kunci: null, error: null })
    const [terakhir, setTerakhir] = useState(null)
    const [percobaan, setPercobaan] = useState(0)
    const tersimpan = kunci ? cache.get(kunci) : undefined

    useEffect(() => {
        if (!kunci) return undefined
        if (tersimpan !== undefined) {
            // Sentuh entri LRU (asinkron, bukan setState sinkron di effect).
            const sentuh = setTimeout(() => setCache((prev) => (prev.get(kunci) === tersimpan ? simpan(prev, kunci, tersimpan) : prev)), 0)
            return () => clearTimeout(sentuh)
        }
        const controller = new AbortController()
        const timer = setTimeout(async () => {
            try {
                const data = await rangkaianService.lacak({ q, mode, jenis, tahun }, { signal: controller.signal })
                if (controller.signal.aborted) return
                setCache((prev) => simpan(prev, kunci, data))
                setTerakhir(data)
            } catch (error) {
                if (controller.signal.aborted) return
                setGagal({ kunci, error })
            }
        }, DEBOUNCE_MS)
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [kunci, tersimpan, q, mode, jenis, tahun, percobaan])

    /** Superset kontrak P3 (nama & tanda tangan sama dengan P4 Task 10): ulangi kueri yang gagal. */
    const retry = () => {
        setGagal({ kunci: null, error: null })
        setPercobaan((n) => n + 1)
    }

    if (!kunci) return { ...KOSONG, retry }
    if (tersimpan !== undefined) return { loading: false, error: null, data: tersimpan, retry }
    if (gagal.kunci === kunci) return { loading: false, error: gagal.error, data: null, retry }
    return { loading: true, error: null, data: terakhir, retry }
}
