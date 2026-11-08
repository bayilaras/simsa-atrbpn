import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings'

const mocks = vi.hoisted(() => ({
    toast: vi.fn(), setTheme: vi.fn(),
    api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
    // Objek auth stabil antar-render (Settings menyinkronkan profil lewat useEffect([user])).
    auth: {
        user: { id: 'staf-1', role: 'user', name: 'Staf', email: 'staf@example.test' },
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
// settings.service yang asli dipakai; hanya lapisan HTTP yang diganti.
vi.mock('@/services/api', () => ({ default: mocks.api }))

const KUNCI_PREFERENSI = ['theme', 'language', 'notificationsEnabled', 'emailNotifications']
const BERHASIL = { title: 'Berhasil', description: 'Preferensi pengguna berhasil disimpan' }

let tersimpan

beforeEach(() => {
    vi.clearAllMocks()
    tersimpan = {
        theme: 'light', language: 'id', notificationsEnabled: true, emailNotifications: true,
        updatedAt: '2026-11-01T02:00:00.000Z',
    }
    mocks.api.get.mockImplementation(async () => ({ ...tersimpan }))
    // Meniru skema PUT /api/settings/preferences yang menolak kunci di luar daftar.
    mocks.api.put.mockImplementation(async (_endpoint, body) => {
        if (Object.keys(body).some((key) => !KUNCI_PREFERENSI.includes(key))) {
            throw new Error('Invalid preferences')
        }
        tersimpan = { ...tersimpan, ...body, updatedAt: new Date(Date.parse(tersimpan.updatedAt) + 60_000).toISOString() }
        return { ...tersimpan }
    })
})

async function bukaTabPreferensi() {
    render(<Settings />)
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Preferensi' }), { button: 0, ctrlKey: false })
    // Nilai default halaman mematikan notifikasi email; sakelar menyala berarti data akun sudah dimuat.
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Aktifkan notifikasi email' })).toHaveAttribute('aria-checked', 'true'))
}

async function simpan() {
    const tombol = screen.getByRole('button', { name: /Simpan Preferensi/ })
    await waitFor(() => expect(tombol).toBeEnabled())
    fireEvent.click(tombol)
}

describe('Pengaturan — Simpan Preferensi', () => {
    it('mengirim hanya preferensi yang dapat diubah, juga pada penyimpanan kedua berturut-turut', async () => {
        await bukaTabPreferensi()
        expect(mocks.api.get).toHaveBeenCalledWith('/api/settings/preferences')

        await simpan()
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(BERHASIL))
        expect(mocks.api.put).toHaveBeenCalledOnce()
        expect(mocks.api.put.mock.calls[0][0]).toBe('/api/settings/preferences')
        expect(mocks.api.put.mock.calls[0][1]).toStrictEqual({
            theme: 'light', language: 'id', notificationsEnabled: true, emailNotifications: true,
        })

        fireEvent.click(screen.getByRole('switch', { name: 'Aktifkan notifikasi dalam aplikasi' }))
        await simpan()
        await waitFor(() => expect(mocks.api.put).toHaveBeenCalledTimes(2))
        expect(mocks.api.put.mock.calls[1][1]).toStrictEqual({
            theme: 'light', language: 'id', notificationsEnabled: false, emailNotifications: true,
        })
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(2))
        expect(mocks.toast).toHaveBeenNthCalledWith(2, BERHASIL)
        expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
        expect(tersimpan.notificationsEnabled).toBe(false)
    })
})
