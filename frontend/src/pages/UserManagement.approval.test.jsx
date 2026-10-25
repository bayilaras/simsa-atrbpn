import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UserManagement from './UserManagement'

const state = vi.hoisted(() => ({ user: { id: 'sa', role: 'super_admin' }, listUsers: vi.fn(), getRoles: vi.fn(), getUnitKerja: vi.fn(), updateUser: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: state.user, hasRole: roles => roles.includes(state.user.role) }) }))
vi.mock('@/services/user-management.service', () => ({ default: state }))
vi.mock('@/components/ui/select', async () => {
    const { Children } = await import('react')
    return {
        Select: ({ children, value, onValueChange, disabled }) => {
            const trigger = Children.toArray(children).find(child => child.props?.['aria-label'])
            return <select aria-label={trigger?.props['aria-label']} value={value} onChange={event => onValueChange(event.target.value)} disabled={disabled}><option value="">Pilih</option>{children}</select>
        }, SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({ children }) => <>{children}</>,
        SelectItem: ({ children, value, disabled }) => <option value={value} disabled={disabled}>{children}</option>,
    }
})
const pending = { id: 'pending-1', email: 'pending@example.test', name: 'Calon pengguna', role: 'user', unitKerjaId: null, isActive: true }
beforeEach(() => {
    vi.clearAllMocks()
    state.user = { id: 'sa', role: 'super_admin' }
    state.listUsers.mockResolvedValue({ data: [pending], pagination: { total: 1, totalPages: 1 } })
    state.getRoles.mockResolvedValue({ data: [{ value: 'super_admin', label: 'Super Admin' }, { value: 'admin_unit', label: 'Admin Unit Kerja' }] })
    state.getUnitKerja.mockResolvedValue({ data: [{ id: 'ditjen', name: 'Ditjen' }, { id: 'sesditjen', name: 'Sesditjen' }] })
    state.updateUser.mockResolvedValue({ success: true })
})
afterEach(cleanup)
async function openApproval() {
    render(<UserManagement />)
    await screen.findByText('pending@example.test')
    fireEvent.click(screen.getByRole('button', { name: /Setujui akses.*Calon pengguna/ }))
    return within(await screen.findByRole('dialog', { name: 'Setujui akses pengguna' }))
}

describe('explicit approval of pending Google identities', () => {
    it('labels pending separately from active and requests the pending filter from the server', async () => {
        render(<UserManagement />)
        const row = (await screen.findByText('pending@example.test')).closest('tr')
        expect(within(row).getByText('Menunggu persetujuan')).toBeInTheDocument()
        expect(within(row).queryByText('Aktif', { exact: true })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Menunggu persetujuan', exact: true }))
        await waitFor(() => expect(state.listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'user', isActive: true, page: 1 })))
        expect(screen.getByRole('button', { name: 'Menunggu persetujuan', exact: true })).toHaveAttribute('aria-pressed', 'true')
    })

    it('preserves search, unit and the previous role while switching the pending queue and resets pagination', async () => {
        state.listUsers.mockResolvedValue({ data: [pending], pagination: { total: 45, totalPages: 3 } })
        render(<UserManagement />)
        await screen.findByText('pending@example.test')
        fireEvent.change(screen.getByRole('combobox', { name: 'Filter peran' }), { target: { value: 'admin_unit' } })
        fireEvent.change(screen.getByRole('combobox', { name: 'Filter unit kerja' }), { target: { value: 'ditjen' } })
        fireEvent.change(screen.getByPlaceholderText('Cari nama atau email...'), { target: { value: 'nama uji' } })
        await waitFor(() => expect(state.listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'admin_unit', unitKerjaId: 'ditjen', search: 'nama uji', page: 1 })))
        fireEvent.click(screen.getByRole('button', { name: 'Selanjutnya' }))
        await waitFor(() => expect(state.listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })))
        fireEvent.click(screen.getByRole('button', { name: 'Menunggu persetujuan', exact: true }))
        await waitFor(() => expect(state.listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'user', isActive: true, unitKerjaId: 'ditjen', search: 'nama uji', page: 1 })))
        expect(screen.getByRole('combobox', { name: 'Filter peran' })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'Semua pengguna', exact: true }))
        await waitFor(() => expect(state.listUsers).toHaveBeenLastCalledWith({ role: 'admin_unit', unitKerjaId: 'ditjen', search: 'nama uji', page: 1, limit: 20 }))
        expect(screen.getByRole('combobox', { name: 'Filter peran' })).toHaveValue('admin_unit')
        expect(state.updateUser).not.toHaveBeenCalled()
    })

    it('requires an explicit role and unit and approves the exact selected identity', async () => {
        const dialog = await openApproval()
        expect(dialog.getByText('pending@example.test')).toBeInTheDocument()
        const role = dialog.getByRole('combobox', { name: 'Peran untuk persetujuan' })
        expect(role).toHaveValue('')
        expect(within(role).getAllByRole('option').map(option => option.value)).toEqual(['', 'super_admin', 'admin_unit'])
        const submit = dialog.getByRole('button', { name: 'Setujui akses', exact: true })
        expect(submit).toBeDisabled()
        fireEvent.change(role, { target: { value: 'admin_unit' } })
        expect(submit).toBeDisabled()
        fireEvent.change(dialog.getByRole('combobox', { name: 'Unit kerja untuk persetujuan' }), { target: { value: 'sesditjen' } })
        fireEvent.click(submit)
        await waitFor(() => expect(state.updateUser).toHaveBeenCalledWith('pending-1', { role: 'admin_unit', unitKerjaId: 'sesditjen', isActive: true }))
        expect(await screen.findByRole('status')).toHaveTextContent(/disetujui.*masuk kembali/i)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('clears a chosen unit only after Super Admin is explicitly selected', async () => {
        const dialog = await openApproval()
        const role = dialog.getByRole('combobox', { name: 'Peran untuk persetujuan' })
        const unit = dialog.getByRole('combobox', { name: 'Unit kerja untuk persetujuan' })
        fireEvent.change(role, { target: { value: 'admin_unit' } })
        fireEvent.change(unit, { target: { value: 'ditjen' } })
        fireEvent.change(role, { target: { value: 'super_admin' } })
        expect(unit).toBeDisabled()
        fireEvent.click(dialog.getByRole('button', { name: 'Setujui akses', exact: true }))
        await waitFor(() => expect(state.updateUser).toHaveBeenCalledWith('pending-1', { role: 'super_admin', unitKerjaId: null, isActive: true }))
    })

    it('keeps a failed approval open with its chosen mandate and permits retry', async () => {
        state.updateUser.mockRejectedValueOnce(new Error('Server tidak tersedia'))
        const dialog = await openApproval()
        fireEvent.change(dialog.getByRole('combobox', { name: 'Peran untuk persetujuan' }), { target: { value: 'admin_unit' } })
        fireEvent.change(dialog.getByRole('combobox', { name: 'Unit kerja untuk persetujuan' }), { target: { value: 'ditjen' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Setujui akses', exact: true }))
        expect(await dialog.findByRole('alert')).toHaveTextContent('Server tidak tersedia')
        expect(dialog.getByRole('combobox', { name: 'Unit kerja untuk persetujuan' })).toHaveValue('ditjen')
        fireEvent.click(dialog.getByRole('button', { name: 'Setujui akses', exact: true }))
        await waitFor(() => expect(state.updateUser).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it.each(['admin_unit', 'user'])('does not offer approval or read the user directory to %s', role => {
        state.user = { id: 'restricted', role, unitKerjaId: role === 'admin_unit' ? 'ditjen' : null }
        render(<UserManagement />)
        expect(screen.queryByRole('button', { name: /Setujui akses/ })).not.toBeInTheDocument()
        expect(state.listUsers).not.toHaveBeenCalled()
    })
})
