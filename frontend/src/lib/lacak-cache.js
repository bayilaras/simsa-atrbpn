export const LACAK_MIN_CHARS = 3
export const LACAK_MAX_CHARS = 100
export const LACAK_CACHE_SIZE = 20

/** Skor "nomor mentah sama" bersifat case-insensitive, jadi kunci boleh di-lowercase. */
export function lacakCacheKey({ q, mode = 'lacak', tahun = '', jenis = '' }) {
    return JSON.stringify([
        mode,
        tahun === null || tahun === undefined ? '' : String(tahun),
        jenis ?? '',
        String(q ?? '').trim().toLowerCase(),
    ])
}

/** Cache LRU kecil: get() mempromosikan, peek() tidak (aman dipanggil saat render). */
export function createLacakCache(max = LACAK_CACHE_SIZE) {
    const entries = new Map()
    return {
        get(key) {
            if (!entries.has(key)) return undefined
            const value = entries.get(key)
            entries.delete(key)
            entries.set(key, value)
            return value
        },
        peek(key) {
            return entries.get(key)
        },
        set(key, value) {
            entries.delete(key)
            entries.set(key, value)
            while (entries.size > max) entries.delete(entries.keys().next().value)
        },
        hapus(key) {
            entries.delete(key)
        },
        get size() {
            return entries.size
        },
        clear() {
            entries.clear()
        },
    }
}
