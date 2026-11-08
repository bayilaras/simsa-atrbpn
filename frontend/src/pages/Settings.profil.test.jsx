import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings'

const mocks = vi.hoisted(() => ({
    updateProfile: vi.fn(), toast: vi.fn(), setTheme: vi.fn(),
    // Objek auth harus stabil antar-render: Settings menyinkronkan profil lewat useEffect([user]).
    auth: {
        user: { id: 'u1', role: 'user', name: 'Budi', email: 'budi@example.test', image: '' },
        canWrite: () => false,
    },
    scope: { unitKerjaId: null },
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => mocks.auth }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/context/theme-context', () => ({ useTheme: () => ({ setTheme: mocks.setTheme }) }))
vi.mock('@/hooks/use-required-unit-kerja-scope', () => ({ useRequiredUnitKerjaScope: () => mocks.scope }))
vi.mock('@/components/RequiredUnitKerjaScope', () => ({ RequiredUnitKerjaScope: () => null }))
vi.mock('@/components/ChangePasswordCard', () => ({ ChangePasswordCard: () => null }))
vi.mock('@/services/settings.service', () => ({
    settingsService: { updateProfile: mocks.updateProfile },
}))

beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateProfile.mockResolvedValue({})
})

const isiNama = (value) => fireEvent.change(screen.getByLabelText('Nama Lengkap'), { target: { value } })
const simpan = () => fireEvent.click(screen.getByRole('button', { name: /Simpan Profil/ }))

describe('Pengaturan Profil — nama wajib diisi', () => {
    it.each([['kosong', ''], ['hanya spasi', '   ']])('nama %s tidak dikirim dan pesan ditampilkan', (_label, value) => {
        render(<Settings />)
        isiNama(value)
        simpan()
        expect(mocks.updateProfile).not.toHaveBeenCalled()
        expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Nama wajib diisi', variant: 'destructive',
        }))
    })

    it('mengirim nama yang sudah dipangkas', async () => {
        render(<Settings />)
        isiNama('  Budi Santoso  ')
        simpan()
        await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledWith({ name: 'Budi Santoso', image: '' }))
        expect(screen.getByLabelText('Nama Lengkap')).toHaveValue('Budi Santoso')
    })
})
