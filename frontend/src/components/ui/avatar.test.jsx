import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Avatar, AvatarFallback, AvatarImage } from './avatar'

// Radix memuat foto lewat `new window.Image()`. Tiruan ini mencatat setiap
// alamat yang diminta peramban.
let diminta

beforeEach(() => {
    diminta = []
    vi.stubGlobal('Image', class {
        addEventListener() {}
        removeEventListener() {}
        set src(alamat) { diminta.push(alamat) }
        get src() { return diminta.at(-1) ?? '' }
    })
})
afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

function tampilkan(src) {
    render(<Avatar><AvatarImage src={src} alt="Budi" /><AvatarFallback>BS</AvatarFallback></Avatar>)
}

describe('AvatarImage', () => {
    it('meminta foto akun Google', () => {
        tampilkan('https://lh3.googleusercontent.com/a/sintetis')
        expect(diminta).toEqual(['https://lh3.googleusercontent.com/a/sintetis'])
    })

    it.each([
        'https://example.test/foto.jpg',
        '/api/files/surat_masuk/1?download=1',
        'http://lh3.googleusercontent.com/a/sintetis',
    ])('tidak meminta %s dan menampilkan inisial', (src) => {
        tampilkan(src)
        expect(diminta).toEqual([])
        expect(screen.getByText('BS')).toBeInTheDocument()
    })
})
