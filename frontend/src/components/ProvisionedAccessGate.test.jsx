import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
    PROVISIONED_ROLES,
    canExportReports,
    hasProvisionedAccess,
} from '@/lib/provisioning-access'
import { ProvisionedAccessGate } from './ProvisionedAccessGate'

describe('ProvisionedAccessGate', () => {
    it.each([
        { role: 'super_admin', unitKerjaId: null },
        { role: 'admin_unit', unitKerjaId: 'unit-a' },
        { role: 'staff', unitKerjaId: 'unit-a' },
    ])('does not mount data-bearing children for a deactivated $role session', (assignment) => {
        const childMounted = vi.fn()
        const onRefresh = vi.fn()
        const onSignOut = vi.fn()
        const user = { ...assignment, isActive: false, email: 'disabled@example.test' }
        function DataPage() {
            childMounted()
            return <div>Data arsip</div>
        }
        render(
            <ProvisionedAccessGate user={user} onRefresh={onRefresh} onSignOut={onSignOut}>
                <DataPage />
            </ProvisionedAccessGate>,
        )

        expect(hasProvisionedAccess(user)).toBe(false)
        expect(childMounted).not.toHaveBeenCalled()
        expect(screen.queryByText('Data arsip')).not.toBeInTheDocument()
        expect(screen.getByRole('status')).toHaveTextContent('Akun dinonaktifkan')
        expect(screen.queryByText('Akun belum diprovisikan')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Periksa ulang akses' }))
        fireEvent.click(screen.getByRole('button', { name: 'Keluar' }))
        expect(onRefresh).toHaveBeenCalledOnce()
        expect(onSignOut).toHaveBeenCalledOnce()
    })

    it.each([
        { role: 'user' },
        { role: 'unknown_role' },
        { role: undefined },
        { role: 'staff', unitKerjaId: null },
        { role: 'auditor', unitKerjaId: '   ' },
    ])(
        'fails closed for the incompletely provisioned user $role/$unitKerjaId without mounting application content',
        (user) => {
            const childMounted = vi.fn()
            function ApplicationContent() {
                childMounted()
                return <div>Dashboard rahasia</div>
            }

            render(
                <ProvisionedAccessGate user={{ email: 'pending@example.go.id', ...user }}>
                    <ApplicationContent />
                </ProvisionedAccessGate>,
            )

            expect(screen.getByRole('status')).toHaveTextContent(user.role === 'user' ? 'Menunggu persetujuan administrator' : 'Akun belum diprovisikan')
            expect(screen.getByText(/Dashboard, menu data, dan proses arsip tidak dimuat/i)).toBeInTheDocument()
            expect(screen.queryByText('Dashboard rahasia')).not.toBeInTheDocument()
            expect(childMounted).not.toHaveBeenCalled()
        },
    )

    it.each([
        { role: 'super_admin', unitKerjaId: null },
        { role: 'admin_dirjen', unitKerjaId: null },
        { role: 'admin_sesditjen', unitKerjaId: null },
        { role: 'staff', unitKerjaId: 'unit-a' },
        { role: 'auditor', unitKerjaId: 'unit-a' },
    ])('allows application content for provisioned role $role', (user) => {
        render(
            <ProvisionedAccessGate user={user}>
                <div>Konten aplikasi</div>
            </ProvisionedAccessGate>,
        )

        expect(PROVISIONED_ROLES).toContain(user.role)
        expect(hasProvisionedAccess(user)).toBe(true)
        expect(screen.getByText('Konten aplikasi')).toBeInTheDocument()
        expect(screen.queryByText('Akun belum diprovisikan')).not.toBeInTheDocument()
    })

    it('lets the user refresh provisioning status or sign out', () => {
        const onRefresh = vi.fn()
        const onSignOut = vi.fn()
        render(
            <ProvisionedAccessGate
                user={{ email: 'pending@example.go.id', role: 'user' }}
                onRefresh={onRefresh}
                onSignOut={onSignOut}
            >
                <div>Konten aplikasi</div>
            </ProvisionedAccessGate>,
        )

        fireEvent.click(screen.getByRole('button', { name: 'Periksa ulang akses' }))
        fireEvent.click(screen.getByRole('button', { name: 'Keluar' }))

        expect(onRefresh).toHaveBeenCalledOnce()
        expect(onSignOut).toHaveBeenCalledOnce()
    })

    it('matches the backend report export permission for staff and auditors', () => {
        expect(canExportReports('staff')).toBe(false)
        expect(canExportReports('auditor')).toBe(true)
        expect(canExportReports('admin_dirjen')).toBe(true)
    })
})
