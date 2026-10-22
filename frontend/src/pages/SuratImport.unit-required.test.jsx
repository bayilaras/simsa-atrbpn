import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SuratKeluar from './SuratKeluar'
import SuratMasuk from './SuratMasuk'

// Tombol impor selalu terlihat oleh admin. Saat pilihan unit masih "Semua Unit
// Kerja", tombol tidak membuka dialog dan menjelaskan langkah yang kurang; setiap
// impor tetap menuju satu unit konkret.
const mocks = vi.hoisted(() => ({ getAll: vi.fn(), getStats: vi.fn(), toast: vi.fn(), user: null }))
const page = { data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } }
vi.mock('@/services/surat-keluar.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats } }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats } }))
vi.mock('@/services/approval.service', () => ({ default: { getPending: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/services/settings.service', () => ({ default: {
    getAllUnitKerja: vi.fn().mockResolvedValue([{ id: 'ditjen', name: 'Ditjen PTPP' }]) } }))
vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, canWrite: () => true }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({
    mode: 'full', capabilities: { metadata: true, files: false, fileUploads: false, externalIntegrations: true } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAll.mockResolvedValue({ success: true, ...page })
    mocks.getStats.mockResolvedValue({ total: 0, diarsipkan: 0, belumDibalas: 0, sudahDibalas: 0 })
})
afterEach(cleanup)

const importButtons = () => [
    screen.getByRole('button', { name: 'Impor dari Google Sheets' }),
    screen.getByRole('button', { name: 'Impor CSV/XLSX' }),
]

describe.each([['Surat Keluar', SuratKeluar], ['Surat Masuk', SuratMasuk]])('%s', (_label, Page) => {
    it('shows the import buttons on "Semua Unit Kerja" without opening a dialog until a unit is chosen', async () => {
        mocks.user = { id: 'super', role: 'super_admin', unitKerjaId: null }
        render(<MemoryRouter><Page /></MemoryRouter>)
        await screen.findByLabelText('Unit kerja')
        for (const button of importButtons()) {
            expect(button).toHaveAttribute('aria-disabled', 'true')
            expect(button).toHaveAccessibleDescription('Pilih unit kerja terlebih dahulu')
            fireEvent.click(button)
        }
        expect(screen.queryByRole('dialog')).toBeNull()
        // Sighted keyboard and touch users see the hint as a tooltip on focus, not only on mouse hover.
        const hints = screen.getAllByRole('tooltip')
        expect(hints.map(hint => hint.textContent)).toEqual(['Pilih unit kerja terlebih dahulu', 'Pilih unit kerja terlebih dahulu'])
        for (const hint of hints) expect(hint).not.toHaveAttribute('hidden')
        for (const hint of hints) expect(hint.className).toMatch(/peer-focus:block/)
    })

    it('enables the import buttons for the concrete unit of a unit admin', async () => {
        mocks.user = { id: 'admin', role: 'admin_unit', unitKerjaId: 'dir_bppt' }
        render(<MemoryRouter><Page /></MemoryRouter>)
        for (const button of importButtons()) {
            expect(button).not.toHaveAttribute('aria-disabled')
            expect(button).not.toHaveAccessibleDescription('Pilih unit kerja terlebih dahulu')
        }
        fireEvent.click(screen.getByRole('button', { name: 'Impor CSV/XLSX' }))
        expect(await screen.findByRole('dialog')).toBeInTheDocument()
    })
})
