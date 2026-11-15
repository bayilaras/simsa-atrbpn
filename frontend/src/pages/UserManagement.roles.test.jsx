import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import UserManagement from './UserManagement'

const mocks = vi.hoisted(() => ({
    user: { id: 'super-1', role: 'super_admin' },
    listUsers: vi.fn(), getRoles: vi.fn(), getUnitKerja: vi.fn(), createUser: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, hasRole: roles => roles.includes(mocks.user.role) }) }))
vi.mock('@/services/user-management.service', () => ({ default: mocks }))
vi.mock('@/components/ui/select', async () => {
    const { Children } = await import('react')
    return {
        Select: ({ children, value, onValueChange, disabled }) => {
            const trigger = Children.toArray(children).find(child => child.props?.['aria-label'])
            return <select aria-label={trigger?.props['aria-label']} value={value} onChange={event => onValueChange(event.target.value)} disabled={disabled}>{children}</select>
        },
        SelectTrigger: () => null,
        SelectValue: () => null,
        SelectContent: ({ children }) => <>{children}</>,
        SelectItem: ({ children, value, disabled }) => <option value={value} disabled={disabled}>{children}</option>,
    }
})

beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = { id: 'super-1', role: 'super_admin' }
    mocks.listUsers.mockResolvedValue({ data: [], pagination: { total: 0, totalPages: 1 } })
    mocks.getRoles.mockResolvedValue({ data: [
        { value: 'super_admin', label: 'Super Admin' }, { value: 'admin_unit', label: 'Admin Unit Kerja' },
        { value: 'staff', label: 'Staf' }, { value: 'admin_dirjen', label: 'Admin Dirjen' },
    ] })
    mocks.getUnitKerja.mockResolvedValue({ data: [{ id: 'unit-a', name: 'Unit A' }] })
    mocks.createUser.mockResolvedValue({ success: true })
})
afterEach(cleanup)

describe('canonical account assignments', () => {
    it('offers two roles and blocks creating an unassigned unit administrator', async () => {
        render(<UserManagement />)
        await waitFor(() => expect(mocks.getRoles).toHaveBeenCalled())
        fireEvent.click(screen.getByRole('button', { name: 'Tambah Pengguna', exact: true }))
        const dialog = await screen.findByRole('dialog')
        const role = within(dialog).getByRole('combobox', { name: 'Peran pengguna baru' })
        expect(within(role).getAllByRole('option').map(option => option.value)).toEqual(['super_admin', 'admin_unit'])
        expect(role).toHaveValue('admin_unit')
        fireEvent.change(within(dialog).getByLabelText(/Email/), { target: { value: 'unit@example.test' } })
        fireEvent.change(within(dialog).getByLabelText(/Nama Lengkap/), { target: { value: 'Admin Unit A' } })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Tambah Pengguna', exact: true }))
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Unit kerja wajib dipilih')
        expect(mocks.createUser).not.toHaveBeenCalled()
        fireEvent.change(within(dialog).getByRole('combobox', { name: 'Unit kerja pengguna baru' }), { target: { value: 'unit-a' } })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Tambah Pengguna', exact: true }))
        await waitFor(() => expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin_unit', unitKerjaId: 'unit-a' })))
    })

    it('explains the password rules in Tambah Pengguna and checks them before calling the server', async () => {
        render(<UserManagement />)
        await waitFor(() => expect(mocks.getUnitKerja).toHaveBeenCalled())
        fireEvent.click(screen.getByRole('button', { name: 'Tambah Pengguna', exact: true }))
        const dialog = within(await screen.findByRole('dialog'))
        const password = dialog.getByLabelText('Kata sandi')
        expect(password).toHaveAccessibleDescription(/Minimal 12 karakter, tidak memuat nama atau bagian depan email pengguna, dan bukan kata sandi yang umum\./)
        expect(password).toHaveAccessibleDescription(/Minta pegawai mengganti kata sandi ini di Pengaturan › Profil setelah masuk pertama kali\./)
        expect(password).toHaveAccessibleDescription(/akun tanpa kata sandi hanya dapat masuk dengan Google/)

        fireEvent.change(dialog.getByLabelText(/^Email/), { target: { value: 'siti.rahma@example.test' } })
        fireEvent.change(dialog.getByLabelText(/^Nama Lengkap/), { target: { value: 'Siti Rahmawati' } })
        fireEvent.change(dialog.getByRole('combobox', { name: 'Unit kerja pengguna baru' }), { target: { value: 'unit-a' } })
        const submit = dialog.getByRole('button', { name: 'Tambah Pengguna' })
        for (const [value, message] of [
            ['sebelas-chr', 'Kata sandi minimal 12 karakter.'],
            ['kantor-rahmawati-7', 'Kata sandi tidak boleh memuat nama pengguna.'],
            ['x-siti.rahma-2026', 'Kata sandi tidak boleh memuat bagian depan alamat email (sebelum tanda @).'],
            ['Password1234', 'Kata sandi ini terlalu umum dan mudah ditebak. Pilih kata sandi lain.'],
        ]) {
            fireEvent.change(password, { target: { value } })
            fireEvent.click(submit)
            expect(await dialog.findByRole('alert')).toHaveTextContent(message)
        }
        expect(mocks.createUser).not.toHaveBeenCalled()
        fireEvent.change(password, { target: { value: 'lemari-arsip-biru-7' } })
        fireEvent.click(submit)
        await waitFor(() => expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ password: 'lemari-arsip-biru-7' })))
    })

    it('keeps account management unavailable to a unit administrator', () => {
        mocks.user = { id: 'unit-1', role: 'admin_unit', unitKerjaId: 'unit-a' }
        render(<UserManagement />)
        expect(screen.queryByRole('button', { name: 'Tambah Pengguna', exact: true })).not.toBeInTheDocument()
        expect(mocks.getRoles).not.toHaveBeenCalled()
        expect(mocks.listUsers).not.toHaveBeenCalled()
    })
})
