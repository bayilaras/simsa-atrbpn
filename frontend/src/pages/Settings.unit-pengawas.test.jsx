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
        { id: 'dir_bppt', name: 'Dit. BPPT', unitType: 'direktorat', isUnitPengawas: false },
    ])
    mocks.update.mockResolvedValue({})
    mocks.getTemplates.mockResolvedValue({ masukFormat: '{noUrut}/SM/{tahun}', keluarFormat: '{noUrut}/{naskahDinas}/{bulan}/{tahun}' })
    mocks.getPreferences.mockResolvedValue({ theme: 'light', language: 'id', notificationsEnabled: true, emailNotifications: false })
})

describe('Pengaturan Unit Kerja — Unit Pengawas (pencatat terpusat)', () => {
    it('memuat status pengawas unit yang sudah ditandai', async () => {
        render(<Settings />)
        bukaTabUnitKerja()
        fireEvent.click(await screen.findByRole('button', { name: /Sekretariat Direktorat Jenderal/ }))
        expect(screen.getByRole('switch', { name: 'Unit Pengawas (pencatat terpusat)' })).toHaveAttribute('aria-checked', 'true')
    })

    it('menyalakan toggle lalu mengirim isUnitPengawas saat disimpan', async () => {
        render(<Settings />)
        bukaTabUnitKerja()
        fireEvent.click(await screen.findByRole('button', { name: /Dit\. BPPT/ }))
        const toggle = screen.getByRole('switch', { name: 'Unit Pengawas (pencatat terpusat)' })
        expect(toggle).toHaveAttribute('aria-checked', 'false')
        fireEvent.click(toggle)
        expect(toggle).toHaveAttribute('aria-checked', 'true')
        fireEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/ }))
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('dir_bppt', expect.objectContaining({ isUnitPengawas: true })))
    })

    it('mengubah nama tanpa mengubah status pengawas tidak mengirim isUnitPengawas [T26-1]', async () => {
        render(<Settings />)
        bukaTabUnitKerja()
        fireEvent.click(await screen.findByRole('button', { name: /Dit\. BPPT/ }))
        const nameInput = screen.getByDisplayValue('Dit. BPPT')
        fireEvent.change(nameInput, { target: { value: 'Direktorat BPPT' } })
        fireEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/ }))
        await waitFor(() => expect(mocks.update).toHaveBeenCalled())
        const [, payload] = mocks.update.mock.calls[0]
        expect(payload).not.toHaveProperty('isUnitPengawas')
        expect(payload.name).toBe('Direktorat BPPT')
    })

    it('setelah penanda tersimpan, simpan berikutnya tanpa toggle tidak mengirim ulang isUnitPengawas [T26-1]', async () => {
        render(<Settings />)
        bukaTabUnitKerja()
        fireEvent.click(await screen.findByRole('button', { name: /Dit\. BPPT/ }))
        fireEvent.click(screen.getByRole('switch', { name: 'Unit Pengawas (pencatat terpusat)' }))
        fireEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/ }))
        await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
        expect(mocks.update.mock.calls[0][1]).toMatchObject({ isUnitPengawas: true })
        await waitFor(() => expect(screen.getByRole('button', { name: /Simpan Perubahan/ })).not.toBeDisabled())
        fireEvent.change(screen.getByDisplayValue('Dit. BPPT'), { target: { value: 'Direktorat BPPT' } })
        fireEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/ }))
        await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2))
        expect(mocks.update.mock.calls[1][1]).not.toHaveProperty('isUnitPengawas')
    })
})
