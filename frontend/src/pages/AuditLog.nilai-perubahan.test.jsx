import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listLogs: vi.fn() }))
vi.mock('@/services/audit-log.service', () => ({ default: { listLogs: mocks.listLogs } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'sa', role: 'super_admin', unitKerjaId: null } }) }))

import AuditLog from './AuditLog'

const WAKTU_IMPOR = '2026-10-20T15:13:21.652927+00:00'

function tampilkan(changes) {
    mocks.listLogs.mockResolvedValue({
        data: [{ id: 'log-1', action: 'update', entityType: 'surat_keluar', entityId: 's-1', userName: 'Admin Unit', createdAt: '2026-11-25T12:30:15.000Z', changes }],
        pagination: { total: 1, totalPages: 1 },
    })
    render(<AuditLog />)
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.listLogs.mockResolvedValue({ data: [], pagination: { total: 0, totalPages: 0 } })
})
afterEach(cleanup)

it('menulis nilai kosong, ya/tidak, daftar, tanggal, dan waktu sebagai kata-kata', async () => {
    tampilkan({
        before: { diimporAt: null, isActive: false, disposisi: [], tanggalSurat: '2026-01-01', catatan: '' },
        after: { diimporAt: WAKTU_IMPOR, isActive: true, disposisi: ['Direktorat BPPT', 'Direktorat PTEP'], tanggalSurat: '2026-01-02', catatan: 'Sudah dicek' },
    })

    // 15.13.21 UTC adalah 22.13.21 WIB.
    const waktu = await screen.findByText(/^20 Okt 2026.+22[.:]13[.:]21 WIB$/)
    expect(waktu).toHaveAttribute('title', WAKTU_IMPOR)
    expect(screen.getAllByText('(kosong)')).toHaveLength(3)
    expect(screen.getByText('Tidak')).toBeInTheDocument()
    expect(screen.getByText('Ya')).toBeInTheDocument()
    expect(screen.getByText('Direktorat BPPT, Direktorat PTEP')).toBeInTheDocument()
    expect(screen.getByText('1 Januari 2026')).toHaveAttribute('title', '2026-01-01')
    expect(screen.getByText('2 Januari 2026')).toBeInTheDocument()
    expect(screen.getByText('Sudah dicek')).toBeInTheDocument()
    for (const mentah of ['null', 'false', 'true', WAKTU_IMPOR, '2026-01-01']) expect(screen.queryByText(mentah), mentah).toBeNull()
})

it('membiarkan teks biasa, angka, dan nilai yang hanya mirip tanggal', async () => {
    tampilkan({
        before: { nomorSurat: '2026-10/ND', jumlah: 0, kode: '2026-13-45T00:00:00Z', rincian: { halaman: 2 }, tenggat: '2026-02-30' },
        after: { nomorSurat: '2026-11/ND', jumlah: 12, kode: '2026-01-01 lampiran', rincian: { halaman: 3 }, tenggat: '2026-02-28' },
    })

    expect(await screen.findByText('2026-10/ND')).toBeInTheDocument()
    expect(screen.getByText('2026-11/ND')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    // Bulan ke-13 bukan waktu yang sah, jadi ditulis apa adanya.
    expect(screen.getByText('2026-13-45T00:00:00Z')).toBeInTheDocument()
    expect(screen.getByText('2026-01-01 lampiran')).toBeInTheDocument()
    // 30 Februari tidak ada di kalender.
    expect(screen.getByText('2026-02-30')).toBeInTheDocument()
    expect(screen.getByText('28 Februari 2026')).toBeInTheDocument()
    expect(screen.getByText('{"halaman":2}')).toBeInTheDocument()
    expect(screen.queryByText('[object Object]')).toBeNull()
})

it('kedua penyaring punya nama untuk pembaca layar', async () => {
    render(<AuditLog />)
    await waitFor(() => expect(mocks.listLogs).toHaveBeenCalled())

    expect(screen.getByRole('combobox', { name: 'Jenis data' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Aksi' })).toBeInTheDocument()
})
