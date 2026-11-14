import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ErrorBoundary from './ErrorBoundary'

function Rusak() {
    throw new Error('render gagal')
}

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

it('halaman galat berbahasa Indonesia', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Rusak /></ErrorBoundary>)
    expect(screen.getByRole('heading', { name: 'Terjadi kesalahan pada halaman ini' })).toBeInTheDocument()
    expect(screen.getByText(/Halaman tidak dapat ditampilkan karena terjadi kesalahan/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Coba Lagi' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ke Dashboard' })).toBeInTheDocument()
    expect(screen.queryByText(/Something went wrong|Try Again/)).toBeNull()
})
