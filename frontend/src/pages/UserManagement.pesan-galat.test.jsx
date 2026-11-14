import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UserManagement from './UserManagement'

const state = vi.hoisted(() => ({
    user: { id: 'sa', role: 'super_admin' },
    listUsers: vi.fn(), getRoles: vi.fn(), getUnitKerja: vi.fn(), updateUser: vi.fn(), deactivateUser: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: state.user, hasRole: roles => roles.includes(state.user.role) }) }))
vi.mock('@/services/user-management.service', () => ({ default: state }))
vi.mock('@/components/ui/dropdown-menu', () => ({
    DropdownMenu: ({ children }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }) => <>{children}</>,
    DropdownMenuContent: ({ children }) => <div role="menu">{children}</div>,
    DropdownMenuItem: ({ children, onClick }) => <button type="button" role="menuitem" onClick={onClick}>{children}</button>,
    DropdownMenuLabel: ({ children }) => <div>{children}</div>,
    DropdownMenuSeparator: () => null,
}))

// Bentuk galat services/api.js untuk AppError backend: `error` = nama kelas, `message` = pesan domain.
const galatApi = (status, body) => Object.assign(new Error(body.message), { status, data: body, response: { status, data: body } })

const users = [
    { id: 'sa', email: 'sa@example.test', name: 'Super Admin', role: 'super_admin', unitKerjaId: null, isActive: true },
    { id: 'sa-2', email: 'sa2@example.test', name: 'Super Admin Dua', role: 'super_admin', unitKerjaId: null, isActive: true },
    { id: 'off-1', email: 'off@example.test', name: 'Pengguna Nonaktif', role: 'admin_unit', unitKerjaId: 'ditjen', isActive: false },
]

beforeEach(() => {
    vi.clearAllMocks()
    state.listUsers.mockResolvedValue({ data: users, pagination: { total: users.length, totalPages: 1 } })
    state.getRoles.mockResolvedValue({ data: [{ value: 'super_admin', label: 'Super Admin' }, { value: 'admin_unit', label: 'Admin Unit Kerja' }] })
    state.getUnitKerja.mockResolvedValue({ data: [{ id: 'ditjen', name: 'Ditjen' }] })
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function menu(email, name) {
    render(<UserManagement />)
    const row = (await screen.findByText(email)).closest('tr')
    fireEvent.click(within(row).getByRole('menuitem', { name }))
}

describe('pesan galat pengelolaan pengguna', () => {
    it('menonaktifkan yang ditolak menampilkan pesan server, bukan nama kelas galat', async () => {
        state.deactivateUser.mockRejectedValue(galatApi(409, { success: false, error: 'ConflictError', message: 'Minimal satu super admin aktif harus tetap tersedia.', code: 'CONFLICT' }))
        await menu('sa2@example.test', /Nonaktifkan/)
        fireEvent.click(await screen.findByRole('button', { name: 'Nonaktifkan' }))
        await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Minimal satu super admin aktif harus tetap tersedia.'))
    })

    it('mengaktifkan yang ditolak menampilkan pesan server', async () => {
        state.updateUser.mockRejectedValue(galatApi(409, { success: false, error: 'ConflictError', message: 'Akun masih menunggu persetujuan. Setujui akses pengguna terlebih dahulu.', code: 'CONFLICT' }))
        await menu('off@example.test', /Aktifkan/)
        fireEvent.click(await screen.findByRole('button', { name: 'Aktifkan' }))
        await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Akun masih menunggu persetujuan. Setujui akses pengguna terlebih dahulu.'))
    })

    it('menyimpan perubahan yang ditolak menampilkan pesan server', async () => {
        state.updateUser.mockRejectedValue(galatApi(400, { success: false, error: 'ValidationError', message: 'Unit kerja wajib untuk admin unit.', code: 'VALIDATION_ERROR' }))
        await menu('off@example.test', /Ubah Peran\/Unit/)
        fireEvent.click(await screen.findByRole('button', { name: /Simpan Perubahan/ }))
        await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Unit kerja wajib untuk admin unit.'))
    })
})

describe('konfirmasi status akun memakai dialog aplikasi', () => {
    it('menonaktifkan hanya setelah tombol Nonaktifkan di dialog dipilih; Batal tidak mengubah apa pun', async () => {
        const confirm = vi.spyOn(window, 'confirm')
        state.deactivateUser.mockResolvedValue({})
        await menu('sa2@example.test', /Nonaktifkan/)
        const dialog = await screen.findByRole('alertdialog', { name: 'Nonaktifkan pengguna?' })
        expect(dialog).toHaveTextContent('Akun Super Admin Dua tidak dapat dipakai untuk masuk sampai diaktifkan kembali.')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Batal' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expect(state.deactivateUser).not.toHaveBeenCalled()

        const row = screen.getByText('sa2@example.test').closest('tr')
        fireEvent.click(within(row).getByRole('menuitem', { name: /Nonaktifkan/ }))
        fireEvent.click(await screen.findByRole('button', { name: 'Nonaktifkan' }))
        await waitFor(() => expect(state.deactivateUser).toHaveBeenCalledWith('sa-2'))
        expect(confirm).not.toHaveBeenCalled()
    })
})
