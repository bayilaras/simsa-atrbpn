import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listLogs: vi.fn() }))
vi.mock('@/services/audit-log.service', () => ({ default: { listLogs: mocks.listLogs } }))

import AuditLog from './AuditLog'

function logUbahArsip(id, changes) {
    return {
        id, action: 'update', entityType: 'arsip', entityId: 'arsip-1', userName: 'Admin Unit',
        createdAt: '2026-11-07T01:00:00.000Z', changes,
    }
}

const ITEM_UTAMA = '11111111-1111-4111-8111-111111111111'
const ITEM_SELOKASI = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
    vi.clearAllMocks()
})
afterEach(cleanup)

function tampilkan(logs) {
    mocks.listLogs.mockResolvedValue({ data: logs, pagination: { total: logs.length, totalPages: 1 } })
    render(<AuditLog />)
}

it('menampilkan item arsip yang ikut diperbarui di bawah rincian perubahan arsip', async () => {
    tampilkan([logUbahArsip('log-1', {
        before: { lokasiFolder: 'F-001' },
        after: { lokasiFolder: 'F-002' },
        fields: ['lokasiFolder'],
        items: [
            { id: ITEM_UTAMA, before: { nomorItem: '1A', lokasiFolder: 'F-001' }, after: { nomorItem: '1', lokasiFolder: 'F-002' } },
            { id: ITEM_SELOKASI, before: { lokasiFolder: 'F-001' }, after: { lokasiFolder: 'F-002' } },
        ],
        itemSync: 'disinkronkan',
    })])

    const judul = await screen.findByText('Daftar Item Arsip')
    const bagian = judul.parentElement
    expect(within(bagian).getByText(ITEM_UTAMA)).toBeInTheDocument()
    expect(within(bagian).getByText(ITEM_SELOKASI)).toBeInTheDocument()
    expect(within(bagian).getByText('1A')).toBeInTheDocument()
    expect(within(bagian).getByText('1')).toBeInTheDocument()
    expect(within(bagian).getAllByText('F-002')).toHaveLength(2)
    expect(screen.queryByText(/tidak dapat dikenali/)).toBeNull()
})

it('menjelaskan bila item ringkasan berkas tidak dapat dikenali', async () => {
    tampilkan([logUbahArsip('log-1', {
        before: { uraianItem: 'Lama' },
        after: { uraianItem: 'Baru' },
        fields: ['uraianItem'],
        items: [],
        itemSync: 'item_utama_ambigu',
    })])

    expect(await screen.findByText('Daftar Item Arsip')).toBeInTheDocument()
    expect(screen.getByText(/Item yang menjadi ringkasan berkas tidak dapat dikenali/)).toBeInTheDocument()
})

it('tidak menampilkan bagian item untuk perubahan tanpa sinkron item', async () => {
    tampilkan([
        logUbahArsip('log-1', {
            before: { keterangan: 'a' }, after: { keterangan: 'b' }, fields: ['keterangan'], items: [], itemSync: 'tidak_perlu',
        }),
        logUbahArsip('log-2', { before: { keterangan: 'b' }, after: { keterangan: 'c' }, fields: ['keterangan'] }),
    ])

    expect(await screen.findAllByText('Detail Perubahan')).toHaveLength(2)
    expect(screen.queryByText('Daftar Item Arsip')).toBeNull()
})
