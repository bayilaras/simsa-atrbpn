import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import RecordAccessGrants from './RecordAccessGrants'
import UserManagement from './UserManagement'
import { TAUTAN_AKUN_MENUNGGU, TAUTAN_PERMOHONAN_AKSES } from '@/lib/menunggu-keputusan'

// Lencana menu dan baris Dashboard menaut langsung ke daftar yang menunggu
// keputusan Super Admin; kedua halaman tujuan harus membukanya tanpa klik lagi.
const mocks = vi.hoisted(() => ({
    user: { id: 'sa', role: 'super_admin' },
    akses: { listMine: vi.fn(), listForReview: vi.fn() },
    pengguna: { listUsers: vi.fn(), getRoles: vi.fn(), getUnitKerja: vi.fn(), updateUser: vi.fn() },
    toast: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, hasRole: roles => roles.includes(mocks.user.role) }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/record-access-grant.service', () => ({ default: mocks.akses }))
vi.mock('@/services/user-management.service', () => ({ default: mocks.pengguna }))

const permohonan = (id, status) => ({
    data: [{ id, entityType: 'arsip', entityId: id, status, purpose: 'Keperluan dinas', accessMode: 'view' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
})

beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = { id: 'sa', role: 'super_admin' }
    mocks.akses.listMine.mockResolvedValue(permohonan('milik-saya', 'pending'))
    mocks.akses.listForReview.mockImplementation(({ status }) => Promise.resolve(permohonan(`tinjau-${status}`, status)))
    mocks.pengguna.listUsers.mockResolvedValue({
        data: [{ id: 'calon-1', email: 'calon@example.test', name: 'Calon pengguna', role: 'user', unitKerjaId: null, isActive: true }],
        pagination: { total: 1, totalPages: 1 },
    })
    mocks.pengguna.getRoles.mockResolvedValue({ data: [{ value: 'admin_unit', label: 'Admin Unit Kerja' }] })
    mocks.pengguna.getUnitKerja.mockResolvedValue({ data: [{ id: 'ditjen', name: 'Ditjen' }] })
})
afterEach(() => {
    cleanup()
    window.history.replaceState({}, '', '/')
})

describe('Persetujuan Akses dari tautan lencana', () => {
    it('Super Admin langsung melihat tab Perlu Keputusan', async () => {
        render(<MemoryRouter initialEntries={[TAUTAN_PERMOHONAN_AKSES]}><RecordAccessGrants /></MemoryRouter>)
        expect(await screen.findByRole('tab', { name: /Perlu Keputusan/ })).toHaveAttribute('aria-selected', 'true')
        expect(await screen.findByText('tinjau-pending')).toBeInTheDocument()
    })

    it('tanpa tautan itu, tab awal tetap Permohonan Saya', async () => {
        render(<MemoryRouter initialEntries={['/record-access-grants']}><RecordAccessGrants /></MemoryRouter>)
        expect(await screen.findByRole('tab', { name: /Permohonan Saya/ })).toHaveAttribute('aria-selected', 'true')
        expect(await screen.findByText('milik-saya')).toBeInTheDocument()
    })

    it('peran lain tidak mendapat tab peninjau walau memakai tautan itu', async () => {
        mocks.user = { id: 'admin', role: 'admin_unit' }
        render(<MemoryRouter initialEntries={[TAUTAN_PERMOHONAN_AKSES]}><RecordAccessGrants /></MemoryRouter>)
        expect(await screen.findByRole('tab', { name: /Permohonan Saya/ })).toHaveAttribute('aria-selected', 'true')
        expect(screen.queryByRole('tab', { name: /Perlu Keputusan/ })).not.toBeInTheDocument()
        expect(mocks.akses.listForReview).not.toHaveBeenCalled()
    })
})

describe('Manajemen Pengguna dari tautan lencana', () => {
    it('langsung menyaring akun yang menunggu persetujuan', async () => {
        window.history.replaceState({}, '', TAUTAN_AKUN_MENUNGGU)
        render(<UserManagement />)
        await screen.findByText('calon@example.test')
        expect(mocks.pengguna.listUsers.mock.calls[0][0]).toMatchObject({ role: 'user', isActive: true, page: 1 })
        expect(screen.getByRole('button', { name: 'Menunggu persetujuan', exact: true })).toHaveAttribute('aria-pressed', 'true')
    })

    it('tanpa tautan itu menampilkan semua pengguna', async () => {
        render(<UserManagement />)
        await screen.findByText('calon@example.test')
        await waitFor(() => expect(mocks.pengguna.listUsers).toHaveBeenCalled())
        expect(mocks.pengguna.listUsers.mock.calls[0][0]).not.toHaveProperty('role')
        expect(screen.getByRole('button', { name: 'Semua pengguna', exact: true })).toHaveAttribute('aria-pressed', 'true')
    })
})
