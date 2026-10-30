import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listLogs: vi.fn() }))
vi.mock('@/services/audit-log.service', () => ({ default: { listLogs: mocks.listLogs } }))

import AuditLog from './AuditLog'

const page = userName => ({
    data: [{ id: userName, action: 'update', entityType: 'arsip', entityId: 'e-1', userName,
        createdAt: '2026-09-27T01:00:00.000Z', changes: null }],
    pagination: { total: 1, totalPages: 1 },
})

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

it('ignores an older log response that arrives after a newer search', async () => {
    let resolveOld
    mocks.listLogs.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
        .mockResolvedValue(page('Pengguna terbaru'))
    render(<AuditLog />)
    await waitFor(() => expect(mocks.listLogs).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByLabelText('Cari audit log'), { target: { value: 'terbaru' } })
    expect(await screen.findByText('Pengguna terbaru', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(mocks.listLogs).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'terbaru', page: 1 }))
    await act(async () => resolveOld(page('Pengguna lama')))
    expect(screen.queryByText('Pengguna lama')).toBeNull()
    expect(screen.getByText('Pengguna terbaru')).toBeInTheDocument()
})
