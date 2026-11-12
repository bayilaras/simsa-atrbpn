import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SuratMasuk from './SuratMasuk'
import SuratKeluar from './SuratKeluar'

// Kartu statistik ikut dimuat ulang setelah surat dihapus atau diarsipkan.
const mocks = vi.hoisted(() => ({
    masuk: { getAll: vi.fn(), getStats: vi.fn(), delete: vi.fn(), archive: vi.fn() },
    keluar: { getAll: vi.fn(), getStats: vi.fn(), delete: vi.fn(), archive: vi.fn() },
    toast: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({
    user: { id: 'admin-a', role: 'admin_unit', unitKerjaId: 'unit-a' }, canWrite: () => true,
}) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({
    mode: 'full', capabilities: { metadata: true, files: false, fileUploads: false, externalIntegrations: false },
}) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/surat-masuk.service', () => ({ default: mocks.masuk }))
vi.mock('@/services/surat-keluar.service', () => ({ default: mocks.keluar }))
vi.mock('@/services/approval.service', () => ({ default: { getPending: async () => [] }, approvalService: { getPending: async () => [] } }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: async () => [] } }))
vi.mock('@/components/ArchiveDialog', () => ({
    ArchiveDialog: ({ open, onArchive }) => open
        ? <button type="button" onClick={() => onArchive({}).catch(() => {})}>Konfirmasi arsip</button>
        : null,
}))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ImportFromGDrive', () => ({ default: () => null }))
vi.mock('@/components/ImportCsvDialog', () => ({ default: () => null }))
vi.mock('@/components/ImportFileDialog', () => ({ default: () => null }))

const halaman = [
    {
        kind: 'masuk', Component: SuratMasuk, menu: 'Buka menu tindakan surat masuk',
        row: { id: 'sm-1', nomorSurat: 'SM-1/2026', perihal: 'Surat masuk uji', tanggalSurat: '2026-09-12', status: 'belum_dibalas', isArchived: false },
        stats: total => ({ total, belumDibalas: total, sudahDibalas: 0, diarsipkan: 0 }),
        isiAlasan: () => fireEvent.change(screen.getByLabelText(/^Alasan penghapusan/), { target: { value: 'Surat ganda, sudah dicatat ulang' } }),
    },
    {
        kind: 'keluar', Component: SuratKeluar, menu: 'Buka menu tindakan surat keluar',
        row: { id: 'sk-1', nomorSurat: 'SK-1/2026', perihal: 'Surat keluar uji', tanggalSurat: '2026-09-12', kepada: 'Unit tujuan', isArchived: false },
        stats: total => ({ total, diarsipkan: 0 }),
        isiAlasan: () => {},
    },
]

afterEach(cleanup)

describe.each(halaman)('daftar surat $kind', ({ kind, Component, menu, row, stats, isiAlasan }) => {
    const service = () => mocks[kind]
    const totalSurat = () => screen.getByText('Total Surat').parentElement.querySelector('p:last-child')

    async function tampil(baris) {
        service().getAll.mockResolvedValue({ success: true, data: [baris], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } })
        render(<MemoryRouter><Component /></MemoryRouter>)
        await screen.findByText(baris.nomorSurat)
        await waitFor(() => expect(totalSurat()).toHaveTextContent(/^5$/))
        fireEvent.keyDown(screen.getByRole('button', { name: menu }), { key: 'Enter' })
    }

    beforeEach(() => {
        vi.clearAllMocks()
        service().getStats.mockResolvedValueOnce(stats(5)).mockResolvedValue(stats(4))
        service().delete.mockResolvedValue(undefined)
        service().archive.mockResolvedValue({})
    })

    it('memuat ulang statistik setelah surat dihapus', async () => {
        await tampil({ ...row, approvalStatus: 'draft' })
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Hapus Surat' }))
        await screen.findByRole('alertdialog')
        isiAlasan()
        fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))
        await waitFor(() => expect(service().delete).toHaveBeenCalled())
        await waitFor(() => expect(totalSurat()).toHaveTextContent(/^4$/))
        expect(service().getStats).toHaveBeenCalledTimes(2)
    })

    it('memuat ulang statistik setelah surat diarsipkan', async () => {
        await tampil({ ...row, approvalStatus: 'approved' })
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Arsipkan' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Konfirmasi arsip' }))
        await waitFor(() => expect(service().archive).toHaveBeenCalledWith(row.id, {}))
        await waitFor(() => expect(totalSurat()).toHaveTextContent(/^4$/))
        expect(service().getStats).toHaveBeenCalledTimes(2)
    })
})
