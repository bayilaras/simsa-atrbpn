import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listLogs: vi.fn() }))
vi.mock('@/services/audit-log.service', () => ({ default: { listLogs: mocks.listLogs } }))

import AuditLog from './AuditLog'

const AKSI_BARU = [
    ['merge', 'rangkaian_surat', 'Menggabungkan'],
    ['link', 'rangkaian_relasi', 'Menautkan'],
    ['cancel', 'rangkaian_relasi', 'Membatalkan'],
    ['distribute', 'surat_distribution', 'Mendisposisikan'],
    ['receive_distribution', 'surat_distribution', 'Menerima Disposisi'],
    ['process_distribution', 'surat_distribution', 'Menyelesaikan Disposisi'],
    ['reject_distribution', 'surat_distribution', 'Menolak Disposisi'],
]

beforeEach(() => {
    vi.clearAllMocks()
    mocks.listLogs.mockResolvedValue({
        data: AKSI_BARU.map(([action, entityType], index) => ({
            id: `log-${index}`, action, entityType, entityId: `e-${index}`, userName: 'Admin Pengawas',
            createdAt: '2026-09-27T01:00:00.000Z', changes: null,
        })),
        pagination: { total: AKSI_BARU.length, totalPages: 1 },
    })
})
afterEach(cleanup)

it('menampilkan label Indonesia untuk kode aksi dan entitas audit P3', async () => {
    render(<AuditLog />)
    for (const [action, , label] of AKSI_BARU) {
        expect(await screen.findByText(label), action).toBeInTheDocument()
        expect(screen.queryByText(action)).toBeNull()
    }
    expect(screen.getAllByText('Relasi Rangkaian')).toHaveLength(2)
    expect(screen.getAllByText('Disposisi')).toHaveLength(4)
    expect(screen.queryByText('rangkaian_relasi')).toBeNull()
    expect(screen.queryByText('surat_distribution')).toBeNull()
})
