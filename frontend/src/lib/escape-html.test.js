import { describe, expect, it } from 'vitest'
import { escapeHtml } from './escape-html'

describe('escapeHtml', () => {
    it('meloloskan kelima karakter khusus HTML', () => {
        expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
    })

    it('membuat tag dari data lama menjadi teks biasa', () => {
        expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
        expect(escapeHtml('Luas < 5 ha & > 2 ha')).toBe('Luas &lt; 5 ha &amp; &gt; 2 ha')
    })

    it('entitas yang sudah tertulis ditampilkan apa adanya, bukan diterjemahkan', () => {
        expect(escapeHtml('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;')
    })

    it('angka menjadi teks dan nilai kosong menjadi string kosong', () => {
        expect(escapeHtml(3)).toBe('3')
        expect(escapeHtml(null)).toBe('')
        expect(escapeHtml(undefined)).toBe('')
    })
})
