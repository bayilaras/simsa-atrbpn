import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SuratMasuk from './SuratMasuk'

// Tombol Export hanya untuk peran yang memiliki izin reports:export di server
// (staf mendapat 403), sama dengan aturan halaman Laporan.
const mocks = vi.hoisted(() => ({ getAll: vi.fn(), getStats: vi.fn(), toast: vi.fn(), role: 'staff' }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({
    user: { id: 'user-a', role: mocks.role, unitKerjaId: 'unit-a' }, canWrite: () => mocks.role !== 'auditor',
}) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({
    mode: 'full', capabilities: { metadata: true, files: false, fileUploads: false, externalIntegrations: false },
}) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats } }))
vi.mock('@/services/approval.service', () => ({ default: { getPending: async () => [] }, approvalService: { getPending: async () => [] } }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => <button type="button">Export</button> }))
vi.mock('@/components/ImportFromGDrive', () => ({ default: () => null }))
vi.mock('@/components/ImportCsvDialog', () => ({ default: () => null }))

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAll.mockResolvedValue({
        success: true,
        data: [{ id: 'sm-1', nomorSurat: 'EXP-1/2026', perihal: 'Uji tombol export', tanggalSurat: '2026-10-09', status: 'belum_dibalas', isArchived: false }],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    })
    mocks.getStats.mockResolvedValue({ total: 1, belumDibalas: 1, sudahDibalas: 0, diarsipkan: 0 })
})
afterEach(cleanup)

it('staf tidak melihat tombol Export', async () => {
    mocks.role = 'staff'
    render(<MemoryRouter><SuratMasuk /></MemoryRouter>)
    await screen.findByText('EXP-1/2026')
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
})

it.each(['admin_unit', 'super_admin', 'auditor'])('%s melihat tombol Export', async role => {
    mocks.role = role
    render(<MemoryRouter><SuratMasuk /></MemoryRouter>)
    await screen.findByText('EXP-1/2026')
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
})
