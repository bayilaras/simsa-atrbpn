import { describe, expect, it } from 'vitest'
import { createLacakCache, LACAK_CACHE_SIZE, lacakCacheKey } from './lacak-cache'

describe('lacakCacheKey', () => {
    it('menyamakan spasi tepi dan kapitalisasi, memisahkan mode dan tahun', () => {
        expect(lacakCacheKey({ q: '  B-12/PTPP ' })).toBe(lacakCacheKey({ q: 'b-12/ptpp' }))
        expect(lacakCacheKey({ q: 'B-12', mode: 'referensi' })).not.toBe(lacakCacheKey({ q: 'B-12' }))
        expect(lacakCacheKey({ q: 'B-12', tahun: '2024' })).not.toBe(lacakCacheKey({ q: 'B-12' }))
        expect(lacakCacheKey({ q: 'B-12', tahun: 2024 })).toBe(lacakCacheKey({ q: 'B-12', tahun: '2024' }))
        expect(lacakCacheKey({ q: 'B-12', jenis: 'surat_keluar' })).not.toBe(lacakCacheKey({ q: 'B-12' }))
        expect(lacakCacheKey({ q: 'B-12', jenis: undefined })).toBe(lacakCacheKey({ q: 'B-12' }))
    })
})

describe('createLacakCache', () => {
    it('menyimpan paling banyak 20 entri dan menggusur yang paling lama tidak dipakai', () => {
        const cache = createLacakCache()
        for (let i = 0; i < LACAK_CACHE_SIZE; i += 1) cache.set(`k${i}`, i)
        expect(cache.get('k0')).toBe(0)
        cache.set('k20', 20)
        expect(cache.size).toBe(20)
        expect(cache.peek('k1')).toBeUndefined()
        expect(cache.peek('k0')).toBe(0)
    })
    it('peek tidak mengubah urutan pemakaian', () => {
        const cache = createLacakCache(2)
        cache.set('a', 1)
        cache.set('b', 2)
        expect(cache.peek('a')).toBe(1)
        cache.set('c', 3)
        expect(cache.peek('a')).toBeUndefined()
        expect(cache.peek('b')).toBe(2)
    })
    it('hapus() menghapus satu entri tanpa memengaruhi yang lain', () => {
        const cache = createLacakCache()
        cache.set('a', 1)
        cache.set('b', 2)
        cache.hapus('a')
        expect(cache.peek('a')).toBeUndefined()
        expect(cache.peek('b')).toBe(2)
        expect(cache.size).toBe(1)
    })
})
