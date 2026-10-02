import { Suspense } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

const templates = vi.hoisted(() => ({ firstRequested: vi.fn(), lastRequested: vi.fn() }))

vi.mock('@/components/formulir/Formulir1', () => {
    templates.firstRequested()
    return { default: () => <h1>Template peminjaman arsip</h1> }
})
vi.mock('@/components/formulir/Formulir33', () => {
    templates.lastRequested()
    return { default: () => <h1>Template penyerahan arsip terjaga</h1> }
})
vi.mock('@/components/formulir/Formulir2', async () => {
    throw new Error('Template chunk unavailable')
})

import FormulirViewer from './FormulirViewer'

afterEach(() => vi.restoreAllMocks())

it('loads only the requested printable template and preserves navigation and printing', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const router = createMemoryRouter([
        { path: '/formulir/cetak/:id', element: <Suspense fallback={<p role="status">Memuat template</p>}><FormulirViewer /></Suspense> },
    ], { initialEntries: ['/formulir/cetak/1'] })

    expect(templates.firstRequested).not.toHaveBeenCalled()
    expect(templates.lastRequested).not.toHaveBeenCalled()
    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: 'Template peminjaman arsip' })).toBeInTheDocument()
    expect(templates.firstRequested).toHaveBeenCalledOnce()
    expect(templates.lastRequested).not.toHaveBeenCalled()
    expect(screen.getByText('Pratinjau ini tidak terisi dari data aplikasi.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Buka Peminjaman' })).toHaveAttribute('href', '/archive-lending')
    fireEvent.click(screen.getByRole('button', { name: 'Cetak Template Kosong' }))
    expect(print).toHaveBeenCalledOnce()

    await act(async () => { await router.navigate('/formulir/cetak/33') })
    expect(await screen.findByRole('heading', { name: 'Template penyerahan arsip terjaga' })).toBeInTheDocument()
    expect(templates.lastRequested).toHaveBeenCalledOnce()
    expect(screen.queryByRole('heading', { name: 'Template peminjaman arsip' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Buka Arsip Terjaga' })).toHaveAttribute('href', '/arsip-terjaga')

    await act(async () => { await router.navigate('/formulir/cetak/99') })
    await waitFor(() => expect(screen.getByText('Formulir tidak ditemukan')).toBeInTheDocument())
    expect(templates.firstRequested).toHaveBeenCalledOnce()
    expect(templates.lastRequested).toHaveBeenCalledOnce()
})

it('offers recovery instead of printing an incomplete document when a template chunk fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const router = createMemoryRouter([
        { path: '/formulir/cetak/:id', element: <Suspense fallback={<p role="status">Memuat template</p>}><FormulirViewer /></Suspense> },
    ], { initialEntries: ['/formulir/cetak/2'] })

    render(<RouterProvider router={router} />)

    expect(await screen.findByText('Template tidak dapat dimuat. Muat ulang halaman untuk mencoba kembali.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Cetak Template Kosong' })).not.toBeInTheDocument()
    expect(screen.queryByText('Unexpected Application Error!')).not.toBeInTheDocument()
})
