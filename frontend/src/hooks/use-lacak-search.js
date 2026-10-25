import { useEffect, useRef, useState } from 'react'
import { rangkaianService } from '@/services/rangkaian.service'
import { createLacakCache, lacakCacheKey, LACAK_MAX_CHARS, LACAK_MIN_CHARS } from '@/lib/lacak-cache'

export const LACAK_DEBOUNCE_MS = 300

/**
 * Satu-satunya hook Lacak (§6): debounce 300 ms, minimal 3 / maksimal 100 karakter,
 * AbortController per kueri, penjaga urutan basi, cache LRU 20 entri per instans.
 * Kontrak P3 (T18-2, commit 986e7b5) dipertahankan: selama `loading`, `data` tetap
 * `null` (bukan hasil sukses lama), supaya konsumen yang tidak mengecek `loading`
 * (mis. ReferensiSection) tidak menampilkan kartu kueri sebelumnya sebagai hasil kueri baru.
 */
export function useLacakSearch(term, { mode = 'lacak', jenis, tahun, enabled = true, debounceMs = LACAK_DEBOUNCE_MS } = {}) {
    const [cache] = useState(() => createLacakCache())
    const sequenceRef = useRef(0)
    const [snapshot, setSnapshot] = useState(null)
    const [attempt, setAttempt] = useState(0)
    const q = typeof term === 'string' ? term.trim() : ''
    const tahunKunci = tahun === undefined || tahun === null || tahun === '' ? '' : String(tahun)
    const valid = enabled && q.length >= LACAK_MIN_CHARS && q.length <= LACAK_MAX_CHARS
    const key = valid ? lacakCacheKey({ q, mode, tahun: tahunKunci, jenis }) : null

    useEffect(() => {
        const sequence = ++sequenceRef.current
        if (!key || cache.get(key) !== undefined) return undefined
        const controller = new AbortController()
        const timer = setTimeout(() => {
            rangkaianService.lacak({ q, mode, jenis, tahun: tahunKunci || undefined }, { signal: controller.signal })
                .then(data => {
                    cache.set(key, data)
                    if (sequence === sequenceRef.current) setSnapshot({ key, attempt, data, error: null })
                })
                .catch(error => {
                    if (controller.signal.aborted || error?.name === 'AbortError') return
                    if (sequence === sequenceRef.current) setSnapshot({ key, attempt, data: null, error })
                })
        }, debounceMs)
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [cache, key, q, mode, jenis, tahunKunci, debounceMs, attempt])

    const retry = () => setAttempt(value => value + 1)
    const bentuk = (status, data = null, error = null) => ({ status, loading: status === 'loading', data, error, q, retry })

    if (!key) return bentuk(enabled && q.length > LACAK_MAX_CHARS ? 'invalid' : 'idle')
    const cached = cache.peek(key)
    if (cached !== undefined) return bentuk('success', cached)
    if (snapshot?.key === key && snapshot.attempt === attempt && snapshot.error) return bentuk('error', null, snapshot.error)
    return bentuk('loading')
}
