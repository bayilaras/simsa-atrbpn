import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UserManagement from './UserManagement'

const state = vi.hoisted(() => ({
    user: { id: 'sa', role: 'super_admin' },
    listUsers: vi.fn(), getRoles: vi.fn(), getUnitKerja: vi.fn(), resetPassword: vi.fn(), toast: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: state.user, hasRole: roles => roles.includes(state.user.role) }) }))
vi.mock('@/services/user-management.service', () => ({ default: state }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }))
// Row actions render inline so each row's menu can be queried directly.
vi.mock('@/components/ui/dropdown-menu', () => ({
    DropdownMenu: ({ children }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }) => <>{children}</>,
    DropdownMenuContent: ({ children }) => <div role="menu">{children}</div>,
    DropdownMenuItem: ({ children, onClick }) => <button type="button" role="menuitem" onClick={onClick}>{children}</button>,
    DropdownMenuLabel: ({ children }) => <div>{children}</div>,
    DropdownMenuSeparator: () => null,
}))

const users = [
    { id: 'sa', email: 'sa@example.test', name: 'Super Admin', role: 'super_admin', unitKerjaId: null, isActive: true },
    { id: 'unit-1', email: 'unit@example.test', name: 'Admin Unit', role: 'admin_unit', unitKerjaId: 'ditjen', isActive: true },
    { id: 'off-1', email: 'off@example.test', name: 'Pengguna Nonaktif', role: 'admin_unit', unitKerjaId: 'ditjen', isActive: false },
    { id: 'pending-1', email: 'pending@example.test', name: 'Calon pengguna', role: 'user', unitKerjaId: null, isActive: true },
]
const ACTION = 'Atur Ulang Kata Sandi'

beforeEach(() => {
    vi.clearAllMocks()
    state.user = { id: 'sa', role: 'super_admin' }
    state.listUsers.mockResolvedValue({ data: users, pagination: { total: users.length, totalPages: 1 } })
    state.getRoles.mockResolvedValue({ data: [{ value: 'super_admin', label: 'Super Admin' }, { value: 'admin_unit', label: 'Admin Unit Kerja' }] })
    state.getUnitKerja.mockResolvedValue({ data: [{ id: 'ditjen', name: 'Ditjen' }] })
    state.resetPassword.mockResolvedValue({ success: true, data: { userId: 'unit-1' } })
})
afterEach(cleanup)

async function row(email) {
    return (await screen.findByText(email)).closest('tr')
}

async function openReset(email = 'unit@example.test') {
    render(<UserManagement />)
    fireEvent.click(within(await row(email)).getByRole('menuitem', { name: ACTION }))
    return within(await screen.findByRole('dialog', { name: ACTION }))
}

describe('Super Admin password reset', () => {
    it('offers the action for other approved accounts only', async () => {
        render(<UserManagement />)
        expect(within(await row('unit@example.test')).getByRole('menuitem', { name: ACTION })).toBeInTheDocument()
        expect(within(await row('off@example.test')).getByRole('menuitem', { name: ACTION })).toBeInTheDocument()
        expect(within(await row('sa@example.test')).queryByRole('menuitem', { name: ACTION })).not.toBeInTheDocument()
        expect(within(await row('pending@example.test')).queryByRole('menuitem', { name: ACTION })).not.toBeInTheDocument()
    })

    it('checks length and confirmation before calling the server', async () => {
        const dialog = await openReset()
        expect(dialog.getByText('unit@example.test')).toBeInTheDocument()
        const password = dialog.getByLabelText('Kata sandi baru')
        const confirmation = dialog.getByLabelText('Konfirmasi kata sandi baru')
        expect(password).toHaveAttribute('maxLength', '128')
        fireEvent.change(password, { target: { value: 'pendek7' } })
        fireEvent.change(confirmation, { target: { value: 'pendek7' } })
        fireEvent.click(dialog.getByRole('button', { name: ACTION }))
        expect(await dialog.findByRole('alert')).toHaveTextContent('Kata sandi minimal 8 karakter.')
        fireEvent.change(password, { target: { value: 'sintetis-baru-01' } })
        fireEvent.change(confirmation, { target: { value: 'sintetis-baru-02' } })
        fireEvent.click(dialog.getByRole('button', { name: ACTION }))
        expect(await dialog.findByRole('alert')).toHaveTextContent('Konfirmasi kata sandi tidak sama.')
        expect(state.resetPassword).not.toHaveBeenCalled()
    })

    it('shows and hides both password fields together', async () => {
        const dialog = await openReset()
        const password = dialog.getByLabelText('Kata sandi baru')
        expect(password).toHaveAttribute('type', 'password')
        fireEvent.click(dialog.getByRole('button', { name: 'Tampilkan kata sandi' }))
        expect(password).toHaveAttribute('type', 'text')
        expect(dialog.getByLabelText('Konfirmasi kata sandi baru')).toHaveAttribute('type', 'text')
        fireEvent.click(dialog.getByRole('button', { name: 'Sembunyikan kata sandi' }))
        expect(password).toHaveAttribute('type', 'password')
    })

    it('resets the selected account, confirms with a toast and closes', async () => {
        const dialog = await openReset()
        fireEvent.change(dialog.getByLabelText('Kata sandi baru'), { target: { value: 'sintetis-baru-01' } })
        fireEvent.change(dialog.getByLabelText('Konfirmasi kata sandi baru'), { target: { value: 'sintetis-baru-01' } })
        fireEvent.click(dialog.getByRole('button', { name: ACTION }))
        await waitFor(() => expect(state.resetPassword).toHaveBeenCalledExactlyOnceWith('unit-1', 'sintetis-baru-01'))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Berhasil',
            description: expect.stringMatching(/Admin Unit diatur ulang.*masuk kembali/),
        }))
        expect(JSON.stringify(state.toast.mock.calls)).not.toContain('sintetis-baru-01')
    })

    it('explains that an inactive account still needs reactivation', async () => {
        const dialog = await openReset('off@example.test')
        expect(dialog.getByText(/nonaktif.*diaktifkan kembali/)).toBeInTheDocument()
    })

    it('keeps the dialog open with an error toast when the server refuses', async () => {
        state.resetPassword.mockRejectedValueOnce(Object.assign(new Error('Validation error'), {
            data: { error: 'ConflictError', message: 'Akun masih menunggu persetujuan.' },
        }))
        const dialog = await openReset()
        fireEvent.change(dialog.getByLabelText('Kata sandi baru'), { target: { value: 'sintetis-baru-01' } })
        fireEvent.change(dialog.getByLabelText('Konfirmasi kata sandi baru'), { target: { value: 'sintetis-baru-01' } })
        fireEvent.click(dialog.getByRole('button', { name: ACTION }))
        await waitFor(() => expect(state.toast).toHaveBeenCalledWith({
            title: 'Gagal mengatur ulang kata sandi',
            description: 'Akun masih menunggu persetujuan.',
            variant: 'destructive',
        }))
        expect(screen.getByRole('dialog', { name: ACTION })).toBeInTheDocument()
        expect(dialog.getByRole('button', { name: ACTION })).toBeEnabled()
    })
})
