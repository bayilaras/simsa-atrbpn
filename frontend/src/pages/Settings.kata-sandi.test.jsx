import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings'

const mocks = vi.hoisted(() => ({
    toast: vi.fn(), setTheme: vi.fn(), listAccounts: vi.fn(), changePassword: vi.fn(),
    // Objek auth stabil antar-render (Settings menyinkronkan profil lewat useEffect([user])).
    auth: {
        user: { id: 'unit-1', role: 'admin_unit', unitKerjaId: 'ditjen', name: 'Admin Unit', email: 'unit@example.test' },
        canWrite: () => true,
    },
    scope: { unitKerjaId: 'ditjen' },
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => mocks.auth }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/context/theme-context', () => ({ useTheme: () => ({ setTheme: mocks.setTheme }) }))
vi.mock('@/hooks/use-required-unit-kerja-scope', () => ({ useRequiredUnitKerjaScope: () => mocks.scope }))
vi.mock('@/components/RequiredUnitKerjaScope', () => ({ RequiredUnitKerjaScope: () => null }))
vi.mock('@/services/settings.service', () => ({ settingsService: {} }))
vi.mock('@/services/auth.service', () => ({
    authService: { listAccounts: mocks.listAccounts, changePassword: mocks.changePassword },
}))

const SAAT_INI = 'sintetis-lama-01'
const BARU = 'sintetis-baru-01'

beforeEach(() => {
    vi.clearAllMocks()
    mocks.listAccounts.mockResolvedValue([{ providerId: 'credential' }, { providerId: 'google' }])
    mocks.changePassword.mockResolvedValue({ token: 'sesi-baru' })
})

async function form() {
    render(<Settings />)
    return within(await screen.findByRole('form', { name: 'Ubah kata sandi' }))
}

function isi(view, { saatIni = SAAT_INI, baru = BARU, konfirmasi = baru } = {}) {
    fireEvent.change(view.getByLabelText('Kata sandi saat ini'), { target: { value: saatIni } })
    fireEvent.change(view.getByLabelText('Kata sandi baru'), { target: { value: baru } })
    fireEvent.change(view.getByLabelText('Konfirmasi kata sandi baru'), { target: { value: konfirmasi } })
    fireEvent.click(view.getByRole('button', { name: 'Simpan Kata Sandi' }))
}

describe('Pengaturan — Ubah Kata Sandi', () => {
    it('mengganti kata sandi akun email dan menutup sesi perangkat lain', async () => {
        const view = await form()
        expect(screen.getByText('Ubah Kata Sandi')).toBeInTheDocument()
        isi(view)
        await waitFor(() => expect(mocks.changePassword).toHaveBeenCalledExactlyOnceWith(SAAT_INI, BARU))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
            title: 'Berhasil', description: 'Kata sandi berhasil diubah. Sesi di perangkat lain telah ditutup.',
        }))
        expect(view.getByLabelText('Kata sandi saat ini')).toHaveValue('')
        expect(view.getByLabelText('Kata sandi baru')).toHaveValue('')
    })

    it.each([
        [{ saatIni: '' }, 'Masukkan kata sandi saat ini.'],
        [{ baru: 'pendek7' }, 'Kata sandi minimal 8 karakter.'],
        [{ konfirmasi: 'sintetis-lain-01' }, 'Konfirmasi kata sandi tidak sama.'],
        [{ baru: SAAT_INI }, 'Kata sandi baru harus berbeda dari kata sandi saat ini.'],
    ])('memeriksa isian sebelum mengirim (%o)', async (isian, pesan) => {
        const view = await form()
        isi(view, isian)
        expect(await view.findByRole('alert')).toHaveTextContent(pesan)
        expect(mocks.changePassword).not.toHaveBeenCalled()
    })

    it('menerjemahkan kata sandi saat ini yang salah', async () => {
        mocks.changePassword.mockRejectedValueOnce(Object.assign(new Error('Invalid password'), { code: 'INVALID_PASSWORD', status: 400 }))
        const view = await form()
        isi(view)
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
            title: 'Gagal mengubah kata sandi', description: 'Kata sandi saat ini salah.', variant: 'destructive',
        }))
        expect(view.getByLabelText('Kata sandi saat ini')).toHaveValue(SAAT_INI)
    })

    it('menampilkan dan menyembunyikan kata sandi', async () => {
        const view = await form()
        const saatIni = view.getByLabelText('Kata sandi saat ini')
        fireEvent.click(view.getByRole('button', { name: 'Tampilkan kata sandi saat ini' }))
        expect(saatIni).toHaveAttribute('type', 'text')
        fireEvent.click(view.getByRole('button', { name: 'Tampilkan kata sandi baru' }))
        expect(view.getByLabelText('Kata sandi baru')).toHaveAttribute('type', 'text')
        expect(view.getByLabelText('Konfirmasi kata sandi baru')).toHaveAttribute('type', 'text')
    })

    it('menjelaskan bahwa akun Google saja tidak memiliki kata sandi SIMSA', async () => {
        mocks.listAccounts.mockResolvedValue([{ providerId: 'google' }])
        render(<Settings />)
        expect(await screen.findByText(/masuk dengan Google sehingga tidak memiliki kata sandi SIMSA/)).toBeInTheDocument()
        expect(screen.queryByRole('form', { name: 'Ubah kata sandi' })).not.toBeInTheDocument()
    })

    it('tetap menampilkan formulir bila metode masuk gagal dimuat', async () => {
        mocks.listAccounts.mockRejectedValue(new Error('jaringan'))
        await form()
        expect(screen.getByLabelText('Kata sandi saat ini')).toBeInTheDocument()
    })
})
