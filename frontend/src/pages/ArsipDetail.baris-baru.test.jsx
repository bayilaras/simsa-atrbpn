import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ArsipDetail from './ArsipDetail'

const mocks = vi.hoisted(() => ({
    getById: vi.fn(),
    getRuleHistory: vi.fn(),
}))

vi.mock('@/components/tunjuk-silang/KartuTunjukSilang', () => ({ KartuTunjukSilang: () => null }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-1', role: 'admin_unit', unitKerjaId: 'unit-1' }, canWrite: () => false }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/services/storage-location.service', () => ({ default: { getTree: vi.fn().mockResolvedValue({ success: true, data: [] }) } }))
vi.mock('@/services/arsip.service', () => ({ arsipService: { getById: mocks.getById, getRuleHistory: mocks.getRuleHistory } }))

const rekod = {
    id: 'arsip-1', unitKerjaId: 'unit-1', jenisArsip: 'masuk', nomorBerkas: 'B-001/2026',
    uraianBerkas: 'Berkas pengadaan\ntanah tahap II', keterangan: 'Catatan pertama\nCatatan kedua',
    klasifikasiKeamanan: 'biasa', disposalStatus: 'active', legalHold: false, lendingStatus: 'available',
    ruleProvenanceStatus: 'verified', createdAt: '2026-03-04T00:00:00.000Z', updatedAt: '2026-03-04T00:00:00.000Z',
    items: [], aksiDiizinkan: [], alasanTerkunci: null, izinAkses: null,
}

function tampilkan() {
    render(<MemoryRouter initialEntries={['/arsip/detail/arsip-1']}><Routes>
        <Route path="/arsip/detail/:id" element={<ArsipDetail />} />
    </Routes></MemoryRouter>)
}

const bukaTab = (nama) => fireEvent.mouseDown(screen.getByRole('tab', { name: nama }), { button: 0, ctrlKey: false })
// Kotak bidang (EnhancedInfoField) dengan label tersebut.
const kotakBidang = (label) => screen.getAllByText(label).map(el => el.closest('.group')).find(Boolean)

beforeEach(() => {
    mocks.getById.mockReset().mockResolvedValue(rekod)
    mocks.getRuleHistory.mockReset().mockResolvedValue([{
        id: 'riwayat-1', revision: 1, status: 'verified', createdAt: '2026-03-04T00:00:00.000Z', snapshot: {},
        reason: 'Kode klasifikasi diperbaiki\nsesuai nota dinas',
    }])
})
afterEach(cleanup)

describe('ArsipDetail - isian multi-baris', () => {
    it('uraian berkas, keterangan, dan alasan rekonsiliasi tampil dengan baris barunya', async () => {
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        expect(kotakBidang('Uraian Berkas')).toHaveClass('whitespace-pre-line')
        expect(kotakBidang('Uraian Berkas')).toHaveTextContent('tanah tahap II')

        bukaTab(/Keamanan/)
        await screen.findByText(/Catatan kedua/)
        expect(kotakBidang('Keterangan')).toHaveClass('whitespace-pre-line')

        bukaTab(/Jejak Aturan/)
        expect(await screen.findByText(/sesuai nota dinas/)).toHaveClass('whitespace-pre-line')
    })
})
