import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings'

const mocks = vi.hoisted(() => ({
    getAll: vi.fn(), update: vi.fn(), toast: vi.fn(), setTheme: vi.fn(),
    getTemplates: vi.fn(), getPreferences: vi.fn(),
    // Objek auth harus stabil antar-render: Settings menyinkronkan profil lewat
    // useEffect([user]), sehingga objek baru di setiap render memicu loop render tanpa akhir.
    auth: {
        user: { id: 'sa', role: 'super_admin', name: 'Super', email: 'sa@example.test' },
        canWrite: () => true,
    },
    scope: { unitKerjaId: 'sesditjen' },
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => mocks.auth }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/context/theme-context', () => ({ useTheme: () => ({ setTheme: mocks.setTheme }) }))
vi.mock('@/hooks/use-required-unit-kerja-scope', () => ({ useRequiredUnitKerjaScope: () => mocks.scope }))
vi.mock('@/components/RequiredUnitKerjaScope', () => ({ RequiredUnitKerjaScope: () => null }))
vi.mock('@/services/settings.service', () => ({
    settingsService: {
        getAllUnitKerja: mocks.getAll,
        updateUnitKerja: mocks.update,
        getSuratTemplates: mocks.getTemplates,
        getPreferences: mocks.getPreferences,
    },
}))

const bukaTabUnitKerja = () =>
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Unit Kerja' }), { button: 0, ctrlKey: false })

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAll.mockResolvedValue([
        { id: 'sesditjen', name: 'Sekretariat Direktorat Jenderal', unitType: 'sekretariat', isUnitPengawas: true },
        { id: 'dir_bppt', name: 'Dit. BPPT', unitType: 'direktorat', isUnitPengawas: false, canReceiveDistribution: false },
    ])
    mocks.update.mockResolvedValue({})
    mocks.getTemplates.mockResolvedValue({ masukFormat: '{noUrut}/SM/{tahun}', keluarFormat: '{noUrut}/{naskahDinas}/{bulan}/{tahun}' })
    mocks.getPreferences.mockResolvedValue({ theme: 'light', language: 'id', notificationsEnabled: true, emailNotifications: false })
})

const SAKELAR = 'Dapat menerima distribusi'

describe('Pengaturan Unit Kerja — Dapat menerima distribusi', () => {
    it('menganggap unit tanpa nilai eksplisit dapat menerima distribusi dan menandai unit yang ditutup', async () => {
        render(<Settings />)
        bukaTabUnitKerja()
        expect(await screen.findByText('Tanpa distribusi')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /Sekretariat Direktorat Jenderal/ }))
        expect(screen.getByRole('switch', { name: SAKELAR })).toHaveAttribute('aria-checked', 'true')
        fireEvent.click(screen.getByRole('button', { name: /Dit\. BPPT/ }))
        expect(screen.getByRole('switch', { name: SAKELAR })).toHaveAttribute('aria-checked', 'false')
    })

    it('menyalakan sakelar lalu mengirim canReceiveDistribution saat disimpan', async () => {
        render(<Settings />)
        bukaTabUnitKerja()
        fireEvent.click(await screen.findByRole('button', { name: /Dit\. BPPT/ }))
        fireEvent.click(screen.getByRole('switch', { name: SAKELAR }))
        fireEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/ }))
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('dir_bppt', expect.objectContaining({ canReceiveDistribution: true })))
        expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('isUnitPengawas')
    })

    it('mengubah nama tanpa menyentuh sakelar tidak mengirim canReceiveDistribution', async () => {
        render(<Settings />)
        bukaTabUnitKerja()
        fireEvent.click(await screen.findByRole('button', { name: /Dit\. BPPT/ }))
        fireEvent.change(screen.getByDisplayValue('Dit. BPPT'), { target: { value: 'Direktorat BPPT' } })
        fireEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/ }))
        await waitFor(() => expect(mocks.update).toHaveBeenCalled())
        expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('canReceiveDistribution')
    })
})
