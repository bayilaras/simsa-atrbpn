import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SuratMasuk from '@/pages/SuratMasuk'
import SuratKeluar from '@/pages/SuratKeluar'

const mocks = vi.hoisted(() => ({
  total: 11, getAll: vi.fn(), getStats: vi.fn(), toast: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({
  user: { id: 'review-user', role: 'admin_dirjen', unitKerjaId: 'ditjen' }, canWrite: () => true,
}) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({
  mode: 'full', capabilities: { metadata: true, files: false, fileUploads: false, externalIntegrations: false },
}) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats } }))
vi.mock('@/services/surat-keluar.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats } }))
vi.mock('@/services/approval.service', () => ({ default: { getPending: async () => [] }, approvalService: { getPending: async () => [] } }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ImportFromGDrive', () => ({ default: () => null }))
vi.mock('@/components/ImportCsvDialog', () => ({ default: () => null }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.total = 11
  mocks.getAll.mockImplementation(async ({ page, limit }) => ({
    success: true,
    data: page > Math.ceil(mocks.total / limit) ? [] : [{
      id: `letter-${page}`, nomorSurat: `REVIEW-PAGE-${page}`, perihal: 'Synthetic record',
      tanggalSurat: '2026-09-12', status: 'belum_dibalas', approvalStatus: 'draft',
    }],
    pagination: { page, limit, total: mocks.total, totalPages: Math.ceil(mocks.total / limit) },
  }))
  mocks.getStats.mockImplementation(async () => ({ total: mocks.total, belumDibalas: mocks.total,
    sudahDibalas: 0, diarsipkan: 0 }))
})
afterEach(cleanup)

describe.each([{ name: 'masuk', Page: SuratMasuk }, { name: 'keluar', Page: SuratKeluar }])('pagination recovery $name', ({ name, Page }) => {
  it('fetches the last remaining page after another user removes its final record', async () => {
    render(<MemoryRouter><Page /></MemoryRouter>)
    await screen.findByText('REVIEW-PAGE-1')
    // Let the initial search debounce complete before changing pages.
    await act(() => new Promise(resolve => setTimeout(resolve, 550)))
    fireEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya' }))
    await screen.findByText('REVIEW-PAGE-2')
    mocks.total = 10
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('REVIEW-PAGE-1')
    expect(screen.queryByRole('button', { name: 'Halaman sebelumnya' })).toBeNull()
    expect(screen.queryByText(`Tidak ada surat ${name} ditemukan`)).toBeNull()
    expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 10 }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('REVIEW-PAGE-1')
    expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 10 }))
  })
})
