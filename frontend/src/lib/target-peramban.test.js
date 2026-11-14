// @vitest-environment node

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import konfigurasiVite, { BROWSER_TARGETS } from '../../vite.config.js'

// Target build dan pesan peramban di index.html harus sama dengan versi yang
// disebut panduan: Chrome/Edge 111+, Firefox 128+, Safari 16.4+.
const PESAN = 'Peramban ini tidak didukung SIMSA. Gunakan Chrome, Edge, Firefox, atau Safari versi terbaru.'

describe('peramban yang didukung', () => {
    it('menetapkan target build secara eksplisit', () => {
        expect(BROWSER_TARGETS).toEqual(['chrome111', 'edge111', 'firefox128', 'safari16.4', 'ios16.4'])
        const konfigurasi = konfigurasiVite({ command: 'serve', mode: 'test' })
        expect(konfigurasi.build.target).toEqual([...BROWSER_TARGETS])
    })

    it('index.html memuat pesan peramban tanpa JavaScript, di luar wadah aplikasi', () => {
        const html = readFileSync(path.join(process.cwd(), 'index.html'), 'utf8')
        const pesan = html.indexOf(`<p class="peramban-tidak-didukung" lang="id">${PESAN}</p>`)
        expect(pesan).toBeGreaterThan(-1)
        expect(pesan).toBeLessThan(html.indexOf('<div id="root"></div>'))
        // Tampil secara bawaan; disembunyikan hanya bila pemeriksaan CSS lolos.
        expect(html).toMatch(/\.peramban-tidak-didukung \{\s*display: block;/)
        expect(html).toContain('@supports (color: color-mix(in srgb, red, red))')
        expect(html).toContain('@supports (-moz-orient: inline) and (not (color: rgb(from red r g b)))')
        expect(html).toContain('@supports (-webkit-appearance: -apple-pay-button) and (not (margin-trim: block))')
        expect(html).not.toMatch(/<script(?![^>]*type="module")[^>]*>/)
    })
})
