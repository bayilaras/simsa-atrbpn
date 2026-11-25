import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Ekspor Audit Log: tombol hanya untuk Super Admin; penyaring yang dikirim sama
// dengan penyaring daftar di layar, tanpa nomor halaman.
const mocks = vi.hoisted(() => ({ listLogs: vi.fn(), exportLogs: vi.fn(), user: { id: 'sa', role: 'super_admin', unitKerjaId: null } }))
vi.mock('@/services/audit-log.service', () => ({ default: { listLogs: mocks.listLogs, exportLogs: mocks.exportLogs } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
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

const halaman = {
    data: [{ id: 'log-1', action: 'update', entityType: 'arsip', entityId: 'e-1', userName: 'Petugas TU', createdAt: '2026-09-27T01:00:00.000Z', changes: null }],
    pagination: { total: 1, totalPages: 1 },
}

/** Penyaring panggilan terakhir yang memuat daftar, tanpa nomor halaman. */
function penyaringDaftar() {
    const { page: _page, limit: _limit, ...penyaring } = mocks.listLogs.mock.lastCall[0]
    return penyaring
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = { id: 'sa', role: 'super_admin', unitKerjaId: null }
    mocks.listLogs.mockResolvedValue(halaman)
    mocks.exportLogs.mockResolvedValue('audit-log.xlsx')
})
afterEach(cleanup)

describe('ekspor Audit Log', () => {
    it.each(['admin_unit', 'auditor', 'staff'])('%s tidak melihat tombol ekspor', async (role) => {
        mocks.user = { id: 'pengguna', role, unitKerjaId: 'ditjen' }
        render(<AuditLog />)
        await screen.findByText('Petugas TU', {}, { timeout: 3000 })
        expect(screen.queryByRole('button', { name: 'Ekspor Excel' })).toBeNull()
    })

    it('Super Admin mengekspor dengan penyaring yang sama dengan daftar di layar', async () => {
        render(<AuditLog />)
        await screen.findByText('Petugas TU', {}, { timeout: 3000 })

        // Tanpa penyaring.
        fireEvent.click(screen.getByRole('button', { name: 'Ekspor Excel' }))
        await waitFor(() => expect(mocks.exportLogs).toHaveBeenCalledTimes(1))
        expect(mocks.exportLogs).toHaveBeenLastCalledWith({})
        expect(mocks.exportLogs.mock.lastCall[0]).toEqual(penyaringDaftar())

        // Semua penyaring halaman: pencarian, rentang tanggal, jenis data, aksi.
        fireEvent.change(screen.getByLabelText('Cari audit log'), { target: { value: 'petugas' } })
        fireEvent.change(screen.getByLabelText('Tanggal mulai'), { target: { value: '2026-09-01' } })
        fireEvent.change(screen.getByLabelText('Tanggal akhir'), { target: { value: '2026-09-30' } })
        const [jenis, aksi] = screen.getAllByRole('combobox', { name: 'Pilihan' })
        fireEvent.change(jenis, { target: { value: 'arsip' } })
        fireEvent.change(aksi, { target: { value: 'export' } })
        const harapan = { entityType: 'arsip', action: 'export', search: 'petugas', startDate: '2026-09-01', endDate: '2026-09-30' }
        await waitFor(() => expect(mocks.listLogs).toHaveBeenLastCalledWith(expect.objectContaining(harapan)), { timeout: 3000 })
        await waitFor(() => expect(screen.getByRole('button', { name: 'Ekspor Excel' })).toBeEnabled())

        fireEvent.click(screen.getByRole('button', { name: 'Ekspor Excel' }))
        await waitFor(() => expect(mocks.exportLogs).toHaveBeenCalledTimes(2))
        expect(mocks.exportLogs).toHaveBeenLastCalledWith(harapan)
        expect(mocks.exportLogs.mock.lastCall[0]).toEqual(penyaringDaftar())
    })

    it('penolakan server ditampilkan dengan pesannya dan tombol aktif kembali', async () => {
        const pesan = 'Hasil filter berisi 10.001 rekod, melebihi batas ekspor 10.000. Persempit filter tahun, unit kerja, atau pencarian lalu ekspor kembali.'
        mocks.exportLogs.mockRejectedValue(Object.assign(new Error(pesan), { status: 422 }))
        render(<AuditLog />)
        await screen.findByText('Petugas TU', {}, { timeout: 3000 })
        fireEvent.click(screen.getByRole('button', { name: 'Ekspor Excel' }))
        expect(await screen.findByRole('alert')).toHaveTextContent(pesan)
        expect(screen.getByRole('button', { name: 'Ekspor Excel' })).toBeEnabled()

        // Percobaan berikutnya yang berhasil menghapus pesan lama.
        mocks.exportLogs.mockResolvedValue('audit-log.xlsx')
        fireEvent.click(screen.getByRole('button', { name: 'Ekspor Excel' }))
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    })
})
