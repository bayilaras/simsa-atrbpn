import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings'

const mocks = vi.hoisted(() => ({
    getAll: vi.fn(), getTemplates: vi.fn(), updateTemplates: vi.fn(),
    getPreferences: vi.fn(), updatePreferences: vi.fn(), toast: vi.fn(), setTheme: vi.fn(),
    // Objek auth harus stabil antar-render (Settings menyinkronkan profil lewat useEffect([user])).
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
vi.mock('@/components/ChangePasswordCard', () => ({ ChangePasswordCard: () => null }))
vi.mock('@/services/settings.service', () => ({
    settingsService: {
        getAllUnitKerja: mocks.getAll,
        getSuratTemplates: mocks.getTemplates,
        updateSuratTemplates: mocks.updateTemplates,
        getPreferences: mocks.getPreferences,
        updatePreferences: mocks.updatePreferences,
    },
}))

const TEMPLATE = {
    sesditjen: { masukFormat: '{noUrut}/SES/{tahun}', keluarFormat: '{noUrut}/SES-K/{bulan}/{tahun}' },
    dir_bppt: { masukFormat: '{noUrut}/BPPT/{tahun}', keluarFormat: '{noUrut}/BPPT-K/{bulan}/{tahun}' },
}
const BAWAAN_HALAMAN = '{noUrut}/SM/{tahun}'
const galat = () => Object.assign(new Error('Layanan sedang sibuk'), { status: 503 })
const bukaTab = (name) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false })
const tombolSimpanTemplate = () => screen.queryByRole('button', { name: /Simpan Template/ })

beforeEach(() => {
    vi.clearAllMocks()
    mocks.scope = { unitKerjaId: 'sesditjen' }
    mocks.getAll.mockResolvedValue([{ id: 'sesditjen', name: 'Sekretariat Ditjen' }, { id: 'dir_bppt', name: 'Dit. BPPT' }])
    mocks.getTemplates.mockImplementation(async (unit) => ({ ...TEMPLATE[unit] }))
    mocks.updateTemplates.mockResolvedValue({})
    mocks.getPreferences.mockResolvedValue({ theme: 'dark', language: 'id', notificationsEnabled: false, emailNotifications: true })
    mocks.updatePreferences.mockImplementation(async (data) => data)
})
afterEach(cleanup)

describe('Pengaturan — data yang gagal dimuat tidak dapat disimpan', () => {
    it('Template: gagal muat menampilkan pesan tanpa formulir, lalu Coba lagi memuat template unit itu', async () => {
        mocks.getTemplates.mockRejectedValueOnce(galat())
        render(<Settings />)
        bukaTab('Template')

        expect(await screen.findByRole('alert')).toHaveTextContent('Template nomor surat unit ini belum dapat dimuat')
        expect(screen.queryByDisplayValue(BAWAAN_HALAMAN)).not.toBeInTheDocument()
        expect(tombolSimpanTemplate()).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        expect(await screen.findByDisplayValue(TEMPLATE.sesditjen.masukFormat)).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()

        await waitFor(() => expect(tombolSimpanTemplate()).toBeEnabled())
        fireEvent.click(tombolSimpanTemplate())
        await waitFor(() => expect(mocks.updateTemplates).toHaveBeenCalledWith('sesditjen', TEMPLATE.sesditjen))
    })

    it('Template: gagal muat setelah ganti unit tidak menyisakan template unit sebelumnya untuk disimpan', async () => {
        const { rerender } = render(<Settings />)
        bukaTab('Template')
        expect(await screen.findByDisplayValue(TEMPLATE.sesditjen.masukFormat)).toBeInTheDocument()

        mocks.getTemplates.mockRejectedValueOnce(galat())
        mocks.scope = { unitKerjaId: 'dir_bppt' }
        rerender(<Settings />)

        expect(await screen.findByRole('alert')).toBeInTheDocument()
        expect(screen.queryByDisplayValue(TEMPLATE.sesditjen.masukFormat)).not.toBeInTheDocument()
        expect(tombolSimpanTemplate()).not.toBeInTheDocument()
        expect(mocks.updateTemplates).not.toHaveBeenCalled()
    })

    it('Template: jawaban unit lama yang datang terlambat tidak menimpa template unit yang sedang dipilih', async () => {
        let jawabLama
        mocks.getTemplates.mockImplementationOnce(() => new Promise((resolve) => { jawabLama = resolve }))
        const { rerender } = render(<Settings />)
        bukaTab('Template')
        await waitFor(() => expect(mocks.getTemplates).toHaveBeenCalledWith('sesditjen'))

        mocks.scope = { unitKerjaId: 'dir_bppt' }
        rerender(<Settings />)
        expect(await screen.findByDisplayValue(TEMPLATE.dir_bppt.masukFormat)).toBeInTheDocument()

        jawabLama({ ...TEMPLATE.sesditjen })
        await waitFor(() => expect(tombolSimpanTemplate()).toBeEnabled())
        expect(screen.getByDisplayValue(TEMPLATE.dir_bppt.masukFormat)).toBeInTheDocument()
        expect(screen.queryByDisplayValue(TEMPLATE.sesditjen.masukFormat)).not.toBeInTheDocument()

        fireEvent.click(tombolSimpanTemplate())
        await waitFor(() => expect(mocks.updateTemplates).toHaveBeenCalledWith('dir_bppt', TEMPLATE.dir_bppt))
    })

    it('Preferensi: gagal muat menampilkan pesan tanpa tombol simpan, lalu Coba lagi memuat preferensi akun', async () => {
        mocks.getPreferences.mockRejectedValueOnce(galat())
        render(<Settings />)
        bukaTab('Preferensi')

        expect(await screen.findByRole('alert')).toHaveTextContent('Preferensi belum dapat dimuat')
        expect(screen.queryByRole('button', { name: /Simpan Preferensi/ })).not.toBeInTheDocument()
        expect(mocks.setTheme).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Aktifkan notifikasi email' })).toHaveAttribute('aria-checked', 'true'))
        expect(screen.getByRole('switch', { name: 'Aktifkan notifikasi dalam aplikasi' })).toHaveAttribute('aria-checked', 'false')
        expect(mocks.setTheme).toHaveBeenCalledWith('dark')
        expect(screen.getByRole('button', { name: /Simpan Preferensi/ })).toBeEnabled()
    })

    it('Unit Kerja: gagal muat menampilkan pesan dan Coba lagi memuat daftar', async () => {
        mocks.getAll.mockRejectedValueOnce(galat())
        render(<Settings />)
        bukaTab('Unit Kerja')

        expect(await screen.findByRole('alert')).toHaveTextContent('Daftar unit kerja belum dapat dimuat')
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        expect(await screen.findByRole('button', { name: /Dit\. BPPT/ })).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
})
