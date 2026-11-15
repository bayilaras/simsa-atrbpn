import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Arsip from './Arsip'

const mocks = vi.hoisted(() => ({ user: {}, units: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, canWrite: () => false }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/services/arsip.service', () => ({ arsipService: {
    getAll: vi.fn(async () => ({ data: [], pagination: { total: 0 } })),
    getStats: vi.fn(async () => ({ total: 0, arsipMasuk: 0, arsipKeluar: 0 })),
} }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: mocks.units } }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ArchiveLifecycleWidget', () => ({
    ArchiveLifecycleWidget: ({ unitKerjaId, perluPilihUnit }) => (
        <output data-testid="status-retensi">{`unit=${unitKerjaId ?? '-'} pilih=${perluPilihUnit ? 'ya' : 'tidak'}`}</output>
    ),
}))

const tampilkan = entry => render(<MemoryRouter initialEntries={[entry]}><Routes>
    <Route path="/arsip/:tab" element={<Arsip />} />
</Routes></MemoryRouter>)

describe('tab Status Retensi mengikuti unit kerja', () => {
    beforeEach(() => {
        mocks.units.mockReset().mockResolvedValue([{ id: 'unit-a', name: 'Unit A' }, { id: 'unit-b', name: 'Unit B' }])
    })
    afterEach(cleanup)

    it('Super Admin dengan Semua Unit Kerja diminta memilih unit', async () => {
        mocks.user = { id: 'super-1', role: 'super_admin', unitKerjaId: null }
        tampilkan('/arsip/retensi')
        expect(await screen.findByTestId('status-retensi')).toHaveTextContent('unit=- pilih=ya')
    })

    it('Super Admin meneruskan unit yang dipilih', async () => {
        mocks.user = { id: 'super-1', role: 'super_admin', unitKerjaId: null }
        tampilkan('/arsip/retensi?unit=unit-b')
        expect(await screen.findByTestId('status-retensi')).toHaveTextContent('unit=unit-b pilih=tidak')
    })

    it('admin unit memakai unitnya sendiri, bukan unit dari tautan', async () => {
        mocks.user = { id: 'admin-a', role: 'admin_unit', unitKerjaId: 'unit-a' }
        tampilkan('/arsip/retensi?unit=unit-b')
        expect(await screen.findByTestId('status-retensi')).toHaveTextContent('unit=unit-a pilih=tidak')
    })
})
