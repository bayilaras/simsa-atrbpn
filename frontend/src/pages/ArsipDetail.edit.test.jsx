import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ArsipDetail from './ArsipDetail'

const mocks = vi.hoisted(() => ({
    user: { id: 'admin-1', role: 'admin_unit', unitKerjaId: 'unit-1' },
    canWrite: vi.fn(),
    getById: vi.fn(),
    getRuleHistory: vi.fn(),
    update: vi.fn(),
    toast: vi.fn(),
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, canWrite: mocks.canWrite }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/arsip.service', () => ({
    arsipService: {
        getById: mocks.getById,
        getRuleHistory: mocks.getRuleHistory,
        update: mocks.update,
        reconcileRules: vi.fn(),
    },
}))
vi.mock('@/components/KlasifikasiPicker', () => ({ KlasifikasiPicker: () => null }))

const rekod = {
    id: 'arsip-1',
    unitKerjaId: 'unit-1',
    jenisArsip: 'masuk',
    nomorBerkas: 'B-001/2026',
    uraianBerkas: 'Berkas pengadaan',
    unitPengolah: 'Ditjen',
    kurunWaktu: '2026-01-01 s/d 2026-12-31',
    tanggalArsip: '2026-03-04',
    nomorItem: '1',
    uraianItem: 'Surat permohonan',
    tingkatPerkembangan: 'Asli',
    jumlah: 1,
    mediaType: 'kertas',
    lokasiFc: 'FC-01',
    lokasiLaci: 'L-02',
    lokasiFolder: 'F-003',
    klasifikasiKeamanan: 'biasa',
    personInCharge: 'Rina',
    disposalStatus: 'active',
    legalHold: false,
    disposalBatchId: null,
    lendingStatus: 'available',
    ruleProvenanceStatus: 'verified',
    createdAt: '2026-03-04T00:00:00.000Z',
    updatedAt: '2026-03-04T00:00:00.000Z',
    items: [],
}

function tampilkan() {
    render(<MemoryRouter initialEntries={['/arsip/detail/arsip-1']}><Routes>
        <Route path="/arsip/detail/:id" element={<ArsipDetail />} />
    </Routes></MemoryRouter>)
}

const tombolUbah = () => screen.queryAllByRole('button', { name: 'Ubah Metadata' })

beforeEach(() => {
    mocks.canWrite.mockReset().mockReturnValue(true)
    mocks.getById.mockReset().mockResolvedValue(rekod)
    mocks.getRuleHistory.mockReset().mockResolvedValue([])
    mocks.update.mockReset().mockResolvedValue({ ...rekod })
    mocks.toast.mockReset()
})
afterEach(cleanup)

describe('ArsipDetail - Ubah Metadata', () => {
    it('tidak menampilkan tombol bagi pengguna tanpa hak tulis', async () => {
        mocks.canWrite.mockReturnValue(false)
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        expect(tombolUbah()).toHaveLength(0)
    })

    it('menampilkan tombol bagi pengguna dengan hak tulis atas unit arsip', async () => {
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        expect(mocks.canWrite).toHaveBeenCalledWith('unit-1')
        expect(tombolUbah().length).toBeGreaterThan(0)
        tombolUbah().forEach(button => expect(button).toBeEnabled())
        fireEvent.click(tombolUbah()[0])
        expect(await screen.findByRole('dialog', { name: 'Ubah Metadata Arsip' })).toBeInTheDocument()
    })

    it('mengunci tombol dengan alasan saat arsip dalam legal hold', async () => {
        mocks.getById.mockResolvedValue({ ...rekod, legalHold: true })
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        tombolUbah().forEach(button => expect(button).toBeDisabled())
        expect(document.getElementById('alasan-metadata-dikunci')).toHaveTextContent('Metadata dikunci karena arsip sedang dalam legal hold.')
        // Salinan di bagian atas untuk layar ponsel, tempat kartu Aksi Cepat jauh di bawah.
        expect(screen.getAllByText('Metadata dikunci karena arsip sedang dalam legal hold.')).toHaveLength(2)
    })

    it('mengunci tombol saat arsip masuk proses penyusutan', async () => {
        mocks.getById.mockResolvedValue({ ...rekod, disposalStatus: 'proposed', disposalBatchId: 'batch-1' })
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        tombolUbah().forEach(button => expect(button).toBeDisabled())
        expect(document.getElementById('alasan-metadata-dikunci')).toHaveTextContent('Metadata dikunci karena arsip sedang dalam proses penyusutan.')
    })

    it('menyimpan perubahan lalu memuat ulang detail', async () => {
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        fireEvent.click(tombolUbah()[0])
        await screen.findByRole('dialog', { name: 'Ubah Metadata Arsip' })

        mocks.getById.mockResolvedValue({ ...rekod, nomorBerkas: 'B-009/2026' })
        fireEvent.change(screen.getByLabelText(/^Nomor Berkas/), { target: { value: 'B-009/2026' } })
        fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('arsip-1', { nomorBerkas: 'B-009/2026' }))
        await waitFor(() => expect(mocks.getById).toHaveBeenCalledTimes(2))
        expect(mocks.toast).toHaveBeenCalledWith({ title: 'Metadata arsip diperbarui' })
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(screen.getAllByText('B-009/2026').length).toBeGreaterThan(0)
    })

    it('tetap menampilkan data bila muat ulang gagal setelah kelas dinaikkan', async () => {
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        fireEvent.click(tombolUbah()[0])
        await screen.findByRole('dialog', { name: 'Ubah Metadata Arsip' })

        mocks.update.mockResolvedValue({ ...rekod, klasifikasiKeamanan: 'terbatas' })
        mocks.getById.mockRejectedValue(Object.assign(new Error('Arsip not found'), { status: 404 }))
        fireEvent.change(document.querySelector('select[name="klasifikasiKeamanan"]'), { target: { value: 'terbatas' } })
        fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Data terbaru belum dapat dimuat',
            description: expect.stringMatching(/memerlukan persetujuan akses/),
        })))
        expect(screen.queryByText('Arsip Tidak Ditemukan')).not.toBeInTheDocument()
        expect(screen.getAllByText('terbatas').length).toBeGreaterThan(0)
    })
})
