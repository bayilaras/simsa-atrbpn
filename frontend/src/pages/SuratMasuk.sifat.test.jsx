import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SuratMasuk from './SuratMasuk'

// Sifat surat masuk adalah kelas keamanannya. Filter daftar menawarkan semua
// kelas yang dapat dicatat lewat formulir, dan lencana sifat memakai label yang
// sama dengan halaman detail untuk nilai formulir maupun nilai hasil impor.
const mocks = vi.hoisted(() => ({ getAll: vi.fn(), getStats: vi.fn(), toast: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({
    user: { id: 'admin-a', role: 'admin_unit', unitKerjaId: 'unit-a' }, canWrite: () => true,
}) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({
    mode: 'full', capabilities: { metadata: true, files: false, fileUploads: false, externalIntegrations: false },
}) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats } }))
// Panel filter memuat daftar unit untuk pilihan "Disposisi Ke".
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: async () => [] } }))
vi.mock('@/services/approval.service', () => ({ default: { getPending: async () => [] }, approvalService: { getPending: async () => [] } }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ImportFromGDrive', () => ({ default: () => null }))
vi.mock('@/components/ImportCsvDialog', () => ({ default: () => null }))
vi.mock('@/components/ImportFileDialog', () => ({ default: () => null }))
vi.mock('@/components/ui/select', async () => {
    const { Children } = await import('react')
    return {
        Select: ({ children, value, onValueChange }) => {
            const trigger = Children.toArray(children).find(child => child.props?.id)
            return <select id={trigger?.props.id} value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>
        },
        SelectTrigger: () => null,
        SelectValue: () => null,
        SelectContent: ({ children }) => <>{children}</>,
        SelectItem: ({ children, value }) => <option value={value}>{children}</option>,
    }
})

const baris = (nomor, sifatSurat) => ({
    id: `sm-${nomor}`, nomorSurat: `SM-${nomor}/2026`, perihal: `Perihal ${nomor}`, dari: 'Instansi Uji',
    tanggalSurat: '2026-09-12', status: 'belum_dibalas', isArchived: false, sifatSurat,
})

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAll.mockResolvedValue({
        success: true,
        data: [baris(1, 'terbatas'), baris(2, 'Sangat Rahasia'), baris(3, 'sangat_rahasia'), baris(4, ' Biasa'), baris(5, 'sangat_segera'), baris(6, null)],
        pagination: { page: 1, limit: 10, total: 6, totalPages: 1 },
    })
    mocks.getStats.mockResolvedValue({ total: 6, belumDibalas: 6, sudahDibalas: 0, diarsipkan: 0 })
})
afterEach(cleanup)

it('filter sifat menawarkan Terbatas dan Sangat Rahasia lalu mengirim kunci formulirnya', async () => {
    render(<MemoryRouter><SuratMasuk /></MemoryRouter>)
    await screen.findByText('SM-1/2026')
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const filter = await screen.findByLabelText('Sifat Surat')
    expect([...filter.options].map(option => option.value)).toEqual([
        'all', 'biasa', 'segera', 'sangat_segera', 'terbatas', 'rahasia', 'sangat_rahasia', 'undangan', 'penting',
    ])
    fireEvent.change(filter, { target: { value: 'sangat_rahasia' } })
    await waitFor(() => expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ sifatSurat: 'sangat_rahasia' })))
    fireEvent.change(filter, { target: { value: 'terbatas' } })
    await waitFor(() => expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ sifatSurat: 'terbatas' })))
})

it('lencana sifat memberi label kelas seperti halaman detail dan tidak menandai sifat Biasa', async () => {
    render(<MemoryRouter><SuratMasuk /></MemoryRouter>)
    await screen.findByText('SM-1/2026')
    const lencana = [...document.querySelectorAll('[data-badge="sifat-surat"]')]
    expect(lencana.map(item => item.textContent)).toEqual(['Terbatas', 'Sangat Rahasia', 'Sangat Rahasia', 'Sangat Segera'])
    expect(lencana[0]).toHaveClass('text-indigo-700')
    expect(lencana[1]).toHaveClass('text-red-700')
    expect(lencana[2]).toHaveClass('text-red-700')
})
