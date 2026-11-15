import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UserManagement from './UserManagement'
import { UserAccessApprovalDialog } from '@/components/UserAccessApprovalDialog'

// Setiap label di dialog pengguna terhubung ke isiannya (htmlFor/id), sehingga
// pembaca layar menyebut nama isian dan klik pada label memindahkan fokus.
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

const users = [
    { id: 'sa', email: 'sa@example.test', name: 'Super Admin', role: 'super_admin', unitKerjaId: null, isActive: true },
    { id: 'au-1', email: 'admin@example.test', name: 'Admin Unit', role: 'admin_unit', unitKerjaId: 'ditjen', isActive: true },
]

beforeEach(() => {
    vi.clearAllMocks()
    state.listUsers.mockResolvedValue({ data: users, pagination: { total: users.length, totalPages: 1 } })
    state.getRoles.mockResolvedValue({ data: [{ value: 'super_admin', label: 'Super Admin' }, { value: 'admin_unit', label: 'Admin Unit Kerja' }] })
    state.getUnitKerja.mockResolvedValue({ data: [{ id: 'ditjen', name: 'Ditjen' }] })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const terhubung = (dialog, label, id) => {
    const kontrol = within(dialog).getByText(label, { selector: 'label' })
    expect(kontrol).toHaveAttribute('for', id)
    expect(document.getElementById(id)).not.toBeNull()
}

describe('label dialog pengguna', () => {
    it('Tambah Pengguna Baru menghubungkan Peran, Unit Kerja, Jabatan, dan NIP ke isiannya', async () => {
        render(<UserManagement />)
        await screen.findByText('admin@example.test')
        fireEvent.click(screen.getByRole('button', { name: /Tambah Pengguna/ }))
        const dialog = await screen.findByRole('dialog', { name: /Tambah Pengguna Baru/ })
        terhubung(dialog, 'Peran', 'new-user-role')
        terhubung(dialog, 'Unit Kerja', 'new-user-unit')
        expect(within(dialog).getByLabelText('Jabatan')).toHaveAttribute('id', 'new-user-jabatan')
        expect(within(dialog).getByLabelText('NIP')).toHaveAttribute('id', 'new-user-nip')
    })

    it('Ubah Pengguna menghubungkan setiap label ke isiannya', async () => {
        render(<UserManagement />)
        const row = (await screen.findByText('admin@example.test')).closest('tr')
        fireEvent.click(within(row).getByRole('menuitem', { name: /Ubah Peran\/Unit/ }))
        const sheet = await screen.findByRole('dialog', { name: /Ubah Pengguna/ })
        terhubung(sheet, 'Peran Pengguna', 'edit-user-role')
        terhubung(sheet, 'Unit Kerja', 'edit-user-unit')
        terhubung(sheet, 'Status Akun', 'edit-user-status')
        expect(within(sheet).getByLabelText('Jabatan')).toHaveAttribute('id', 'edit-user-jabatan')
        expect(within(sheet).getByLabelText('NIP')).toHaveAttribute('id', 'edit-user-nip')
    })

    it('dialog persetujuan akses menghubungkan Peran dan Unit kerja ke pilihannya', () => {
        render(<UserAccessApprovalDialog user={{ id: 'p-1', email: 'baru@example.test', name: 'Baru', role: 'user' }}
            unitKerjaList={[{ id: 'ditjen', name: 'Ditjen' }]} onClose={vi.fn()} onApproved={vi.fn()} />)
        const dialog = screen.getByRole('dialog')
        terhubung(dialog, 'Peran', 'approval-role')
        terhubung(dialog, 'Unit kerja', 'approval-unit')
    })
})
