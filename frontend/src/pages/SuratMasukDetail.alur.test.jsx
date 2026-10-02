import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ getById: vi.fn(), toast: vi.fn() }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getById: mocks.getById, archive: vi.fn() } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ canWrite: () => true, user: { id: 'user-a', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/surat-masuk/FilePreviewSection', () => ({ FilePreviewSection: () => null }))
vi.mock('@/components/surat/AlurSuratPanel', () => ({
    AlurSuratPanel: ({ jenis, suratId, aksesMelalui }) => <output aria-label="Panel alur surat">{`${jenis}|${suratId}|${aksesMelalui}`}</output>,
}))

import SuratMasukDetail from './SuratMasukDetail'

const surat = {
    id: 'sm-1', nomorSurat: 'SM-1/2026', perihal: 'Permohonan data pertanahan', unitKerjaId: 'sesditjen',
    dari: 'Kanwil A', tanggalSurat: '2026-09-01', status: 'belum_dibalas', sifatSurat: 'biasa', isArchived: false,
}

const renderDetail = () => render(
    <MemoryRouter initialEntries={['/surat/masuk/sm-1']}>
        <Routes><Route path="/surat/masuk/:id" element={<SuratMasukDetail />} /></Routes>
    </MemoryRouter>,
)

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('menyembunyikan aksi pemilik saat surat dibaca melalui rangkaian', async () => {
    mocks.getById.mockResolvedValue({ ...surat, aksesMelalui: 'peserta' })
    renderDetail()
    expect(await screen.findByLabelText('Panel alur surat')).toHaveTextContent('surat_masuk|sm-1|peserta')
    expect(screen.queryAllByRole('button', { name: /^edit$/i })).toHaveLength(0)
})

it('tetap menampilkan aksi pemilik untuk akses owner', async () => {
    mocks.getById.mockResolvedValue({ ...surat, aksesMelalui: 'owner' })
    renderDetail()
    expect(await screen.findByLabelText('Panel alur surat')).toHaveTextContent('surat_masuk|sm-1|owner')
    expect(screen.queryAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThan(0)
})
