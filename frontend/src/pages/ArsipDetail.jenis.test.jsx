import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ArsipDetail from './ArsipDetail'

const mocks = vi.hoisted(() => ({
    getById: vi.fn(),
    getRuleHistory: vi.fn(),
}))

vi.mock('@/components/tunjuk-silang/KartuTunjukSilang', () => ({ KartuTunjukSilang: () => null }))
vi.mock('@/components/arsip/KartuPeminjamanArsip', () => ({ KartuPeminjamanArsip: () => null }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-1', role: 'admin_unit', unitKerjaId: 'unit-1' }, canWrite: () => false }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/services/storage-location.service', () => ({ default: { getTree: vi.fn().mockResolvedValue({ success: true, data: [] }) } }))
vi.mock('@/services/arsip.service', () => ({ arsipService: { getById: mocks.getById, getRuleHistory: mocks.getRuleHistory } }))

const rekod = (extra = {}) => ({
    id: 'arsip-1', unitKerjaId: 'unit-1', jenisArsip: 'lainnya', nomorBerkas: 'SK-001/2025',
    uraianBerkas: 'Keputusan tim pengadaan', klasifikasiKeamanan: 'biasa', disposalStatus: 'active',
    legalHold: false, lendingStatus: 'available', ruleProvenanceStatus: 'legacy_unverified',
    createdAt: '2026-03-04T00:00:00.000Z', updatedAt: '2026-03-04T00:00:00.000Z',
    items: [], aksiDiizinkan: [], alasanTerkunci: null, izinAkses: null,
    ...extra,
})

function tampilkan() {
    render(<MemoryRouter initialEntries={['/arsip/detail/arsip-1']}><Routes>
        <Route path="/arsip/detail/:id" element={<ArsipDetail />} />
    </Routes></MemoryRouter>)
}

beforeEach(() => {
    mocks.getById.mockReset()
    mocks.getRuleHistory.mockReset().mockResolvedValue([])
})
afterEach(cleanup)

describe('ArsipDetail - jenis arsip', () => {
    it('arsip lainnya berlabel Arsip Lainnya dan tanpa tab Surat Asli', async () => {
        mocks.getById.mockResolvedValue(rekod())
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        expect(screen.getAllByText('Arsip Lainnya').length).toBeGreaterThan(0)
        expect(screen.queryByText('Surat Keluar')).not.toBeInTheDocument()
        expect(screen.queryByRole('tab', { name: /Surat Asli/ })).not.toBeInTheDocument()
    })

    it('arsip surat masuk tetap berlabel Surat Masuk, tab Surat Asli tampil, dan riwayat tidak menulis "Surat" dua kali', async () => {
        mocks.getById.mockResolvedValue(rekod({ jenisArsip: 'masuk', sourceSuratId: 'sm-1', tanggalSuratOriginal: '2026-03-01' }))
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        expect(screen.getAllByText('Surat Masuk').length).toBeGreaterThan(0)
        expect(screen.getByRole('tab', { name: /Surat Asli/ })).toBeInTheDocument()
        expect(screen.queryByText(/Surat Surat/)).not.toBeInTheDocument()
    })
})
