import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ErrorBoundary, { HalamanGalat } from './ErrorBoundary'
import { GalatMuatHalaman } from '@/lib/muat-halaman'

function Rusak() {
    throw new Error('render gagal')
}

function GagalMuat() {
    throw new GalatMuatHalaman(new TypeError('Failed to fetch dynamically imported module'))
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

it('halaman galat berbahasa Indonesia', () => {
    render(<ErrorBoundary><Rusak /></ErrorBoundary>)
    expect(screen.getByRole('heading', { name: 'Terjadi kesalahan pada halaman ini' })).toBeInTheDocument()
    expect(screen.getByText(/Halaman tidak dapat ditampilkan karena terjadi kesalahan/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Coba Lagi' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ke Dashboard' })).toBeInTheDocument()
    expect(screen.queryByText(/Something went wrong|Try Again/)).toBeNull()
})

it('layar galat ditutup saat pengguna berpindah halaman', () => {
    const view = render(<ErrorBoundary resetKey="halaman-1"><Rusak /></ErrorBoundary>)
    expect(screen.getByRole('heading', { name: 'Terjadi kesalahan pada halaman ini' })).toBeInTheDocument()

    view.rerender(<ErrorBoundary resetKey="halaman-2"><h1>Halaman lain</h1></ErrorBoundary>)
    expect(screen.getByRole('heading', { name: 'Halaman lain' })).toBeInTheDocument()
    expect(screen.queryByText('Terjadi kesalahan pada halaman ini')).toBeNull()
})

it('layar galat menetap selama halamannya sama, dan halaman baru yang juga gagal tetap menampilkannya', () => {
    const view = render(<ErrorBoundary resetKey="halaman-1"><Rusak /></ErrorBoundary>)
    view.rerender(<ErrorBoundary resetKey="halaman-1"><h1>Halaman lain</h1></ErrorBoundary>)
    expect(screen.getByRole('heading', { name: 'Terjadi kesalahan pada halaman ini' })).toBeInTheDocument()

    view.rerender(<ErrorBoundary resetKey="halaman-2"><Rusak /></ErrorBoundary>)
    expect(screen.getByRole('heading', { name: 'Terjadi kesalahan pada halaman ini' })).toBeInTheDocument()
})

it('Coba Lagi menampilkan kembali halaman yang sudah pulih', () => {
    let rusak = true
    const Halaman = () => {
        if (rusak) throw new Error('render gagal')
        return <h1>Halaman pulih</h1>
    }
    render(<ErrorBoundary><Halaman /></ErrorBoundary>)
    rusak = false
    fireEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }))
    expect(screen.getByRole('heading', { name: 'Halaman pulih' })).toBeInTheDocument()
})

it('berkas halaman yang gagal dimuat menawarkan Muat ulang halaman, bukan Coba Lagi', () => {
    const muatUlang = vi.fn()
    render(<ErrorBoundary muatUlang={muatUlang} fallbackMessage="Pesan lain"><GagalMuat /></ErrorBoundary>)
    expect(screen.getByRole('heading', { name: 'Halaman belum dapat dimuat' })).toBeInTheDocument()
    expect(screen.getByText(/Periksa koneksi internet Anda, lalu muat ulang halaman/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Coba Lagi' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ke Dashboard' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Muat ulang halaman' }))
    expect(muatUlang).toHaveBeenCalledOnce()
})

it('di luar ruang kerja tautan Dashboard diganti Muat ulang halaman', () => {
    const muatUlang = vi.fn()
    render(<ErrorBoundary tanpaDashboard muatUlang={muatUlang}><Rusak /></ErrorBoundary>)
    expect(screen.getByRole('button', { name: 'Coba Lagi' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ke Dashboard' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Muat ulang halaman' }))
    expect(muatUlang).toHaveBeenCalledOnce()
})

it('layar galat tanpa Coba Lagi (galat rute) menawarkan Muat ulang halaman', () => {
    render(<HalamanGalat error={new Error('kerangka gagal')} muatUlang={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Terjadi kesalahan pada halaman ini' })).toBeInTheDocument()
    expect(screen.getAllByRole('button').map(tombol => tombol.textContent)).toEqual(['Muat ulang halaman', 'Ke Dashboard'])
})
