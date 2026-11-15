import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listLogs: vi.fn() }))
vi.mock('@/services/audit-log.service', () => ({ default: { listLogs: mocks.listLogs } }))
vi.mock('@/components/ui/select', () => ({
    Select: ({ children, value, onValueChange }) => (
        <select aria-label="Pilihan" value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }) => <>{children}</>,
    SelectItem: ({ children, value }) => <option value={value}>{children}</option>,
}))

import AuditLog from './AuditLog'

const PERISTIWA = [
    ['sign_in', 'Masuk', { userName: 'Petugas Pencatat', userEmail: 'pencatat@example.test' }],
    ['sign_in_failed', 'Gagal masuk', { userName: null, userEmail: 'pencatat@example.test' }],
    ['sign_out', 'Keluar', { userName: 'Petugas Pencatat', userEmail: 'pencatat@example.test' }],
    ['change_password', 'Mengganti kata sandi', { userName: 'Petugas Pencatat', userEmail: 'pencatat@example.test' }],
]

beforeEach(() => {
    vi.clearAllMocks()
    mocks.listLogs.mockResolvedValue({
        data: [
            ...PERISTIWA.map(([action, , user], index) => ({
                id: `log-${index}`, action, entityType: 'user', entityId: null, ...user,
                createdAt: '2026-11-14T01:00:00.000Z',
                changes: action === 'change_password' ? { fields: ['kata_sandi'], after: { kata_sandi: 'diganti' } } : null,
            })),
            { id: 'log-tanpa-email', action: 'sign_in_failed', entityType: 'user', entityId: null, userName: null, userEmail: null,
                createdAt: '2026-11-14T01:00:00.000Z', changes: { after: { metode: 'email', alasan: 'Format email tidak valid' } } },
        ],
        pagination: { total: PERISTIWA.length + 1, totalPages: 1 },
    })
})
afterEach(cleanup)

it('memberi label Indonesia untuk masuk, gagal masuk, keluar, dan mengganti kata sandi', async () => {
    render(<AuditLog />)
    for (const [action, label] of PERISTIWA) {
        expect((await screen.findAllByText(label, { selector: '.border-0' }))[0], action).toBeInTheDocument()
        expect(screen.queryByText(action)).toBeNull()
    }
    // The detail of a password change is labelled in Indonesian.
    expect(screen.getByText('kata sandi:')).toBeInTheDocument()
    expect(screen.getByText('diganti')).toBeInTheDocument()
    // A failed attempt without a well-formed address is not attributed to the system.
    expect(screen.getByText('Pengguna tidak dikenal')).toBeInTheDocument()
})

it('menyaring Audit Log menurut peristiwa masuk dan keluar', async () => {
    render(<AuditLog />)
    await waitFor(() => expect(mocks.listLogs).toHaveBeenCalled())
    const [, aksi] = screen.getAllByRole('combobox', { name: 'Pilihan' })
    for (const [action, label] of PERISTIWA) {
        expect(within(aksi).getByRole('option', { name: label })).toHaveValue(action)
    }
    fireEvent.change(aksi, { target: { value: 'sign_in_failed' } })
    await waitFor(() => expect(mocks.listLogs).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'sign_in_failed', page: 1 })))
})
