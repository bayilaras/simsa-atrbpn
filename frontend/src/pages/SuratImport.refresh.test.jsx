import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SuratKeluar from './SuratKeluar'
import SuratMasuk from './SuratMasuk'

// A finished import refreshes the list and the stat cards, as the Refresh button does.
const mocks = vi.hoisted(() => ({ getAll: vi.fn(), getStats: vi.fn(), toast: vi.fn() }))
vi.mock('@/services/surat-keluar.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats } }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats } }))
vi.mock('@/services/approval.service', () => ({ default: { getPending: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin', role: 'admin_unit', unitKerjaId: 'dir_bppt' }, canWrite: () => true }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({
    mode: 'full', capabilities: { metadata: true, files: false, fileUploads: false, externalIntegrations: true } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/ImportFromGDrive', () => ({ default: ({ onImportComplete }) =>
    <button type="button" onClick={onImportComplete}>Selesai impor Sheets</button> }))
vi.mock('@/components/ImportFileDialog', () => ({ default: ({ onImportComplete }) =>
    <button type="button" onClick={onImportComplete}>Selesai impor berkas</button> }))

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAll.mockResolvedValue({ success: true, data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } })
    mocks.getStats.mockResolvedValue({ total: 0, diarsipkan: 0, belumDibalas: 0, sudahDibalas: 0 })
})
afterEach(cleanup)

describe.each([['Surat Keluar', SuratKeluar], ['Surat Masuk', SuratMasuk]])('%s', (_label, Page) => {
    it.each(['Selesai impor Sheets', 'Selesai impor berkas'])('refreshes the stat cards after %s', async name => {
        render(<MemoryRouter><Page /></MemoryRouter>)
        await waitFor(() => expect(mocks.getStats).toHaveBeenCalledTimes(1))
        const lists = mocks.getAll.mock.calls.length
        fireEvent.click(screen.getByRole('button', { name }))
        await waitFor(() => expect(mocks.getStats).toHaveBeenCalledTimes(2))
        expect(mocks.getAll.mock.calls.length).toBeGreaterThan(lists)
    })
})
