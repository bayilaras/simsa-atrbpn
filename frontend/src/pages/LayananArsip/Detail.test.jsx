import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ getById: vi.fn(), updateStatus: vi.fn(), toast: vi.fn() }))
vi.mock('@/services/layanan-arsip.service', () => ({ layananArsipService: { getById: mocks.getById, updateStatus: mocks.updateStatus } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-a', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))

import LayananArsipDetail from './Detail'

const permohonan = {
    id: 'la-1', status: 'diajukan', jenisLayanan: 'penggandaan', jumlahRangkap: 1, keperluan: 'Bahan rapat',
    createdAt: '2026-11-01T02:00:00Z', arsip: { nomorBerkas: 'B-1', uraianBerkas: 'Uraian', tahun: 2026, kodeKlasifikasi: 'PT.01' },
    pemohon: { name: 'Pemohon' },
}

const tampilkan = () => render(
    <MemoryRouter initialEntries={['/layanan-arsip/la-1']}>
        <Routes><Route path="/layanan-arsip/:id" element={<LayananArsipDetail />} /></Routes>
    </MemoryRouter>,
)

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('menampilkan teks memuat berbahasa Indonesia', async () => {
    mocks.getById.mockReturnValue(new Promise(() => {}))
    tampilkan()
    expect(screen.getByRole('status')).toHaveTextContent('Memuat detail permohonan...')
    expect(screen.queryByText('Loading...')).toBeNull()
})

it('pesan server saat status gagal diperbarui ditampilkan apa adanya', async () => {
    mocks.getById.mockResolvedValue(permohonan)
    mocks.updateStatus.mockRejectedValue(Object.assign(new Error('Status permohonan sudah berubah. Muat ulang halaman.'), { status: 409 }))
    tampilkan()
    fireEvent.click(await screen.findByRole('button', { name: /Proses Permohonan/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Konfirmasi' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Gagal', description: 'Status permohonan sudah berubah. Muat ulang halaman.', variant: 'destructive',
    })))
})
