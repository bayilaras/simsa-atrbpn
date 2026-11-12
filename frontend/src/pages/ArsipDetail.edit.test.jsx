import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ArsipDetail from './ArsipDetail'
import { PESAN_ARSIP_TIDAK_DAPAT_DIUBAH, PESAN_ITEM_BELUM_TERMUAT } from '@/components/arsip/edit-arsip-form'

const mocks = vi.hoisted(() => ({
    user: { id: 'admin-1', role: 'admin_unit', unitKerjaId: 'unit-1' },
    canWrite: vi.fn(),
    getById: vi.fn(),
    getRuleHistory: vi.fn(),
    update: vi.fn(),
    reconcileRules: vi.fn(),
    toast: vi.fn(),
}))

vi.mock('@/components/tunjuk-silang/KartuTunjukSilang', () => ({ KartuTunjukSilang: ({ tipe, id }) => <div data-testid="kartu-tunjuk-silang">{`${tipe}:${id}`}</div> }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, canWrite: mocks.canWrite }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/arsip.service', () => ({
    arsipService: {
        getById: mocks.getById,
        getRuleHistory: mocks.getRuleHistory,
        update: mocks.update,
        reconcileRules: mocks.reconcileRules,
    },
}))
vi.mock('@/components/KlasifikasiPicker', () => ({
    KlasifikasiPicker: ({ onChange }) => (
        <button type="button" onClick={() => onChange('KU.01', { id: 10, kode: 'KU.01', jenis: 'Keuangan' }, { id: 20, kode: 'F.UJI', uraian: 'Uji' })}>
            Pilih aturan uji
        </button>
    ),
}))

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
    aksiDiizinkan: ['ubah_metadata', 'rekonsiliasi_aturan'],
    alasanTerkunci: null,
    izinAkses: null,
}

// Respons backend lama yang belum membawa hak aksi.
function tanpaHakAksi(patch = {}) {
    const { aksiDiizinkan: _aksi, alasanTerkunci: _alasan, izinAkses: _izin, ...lama } = rekod
    return { ...lama, ...patch }
}

const KALIMAT_HOLD_REKONSILIASI = 'Rekonsiliasi dikunci karena arsip berada dalam legal hold atau workflow penyusutan.'

function tampilkan() {
    render(<MemoryRouter initialEntries={['/arsip/detail/arsip-1']}><Routes>
        <Route path="/arsip/detail/:id" element={<ArsipDetail />} />
    </Routes></MemoryRouter>)
}

const tombolUbah = () => screen.queryAllByRole('button', { name: 'Ubah Metadata' })
const tombolRekonsiliasiSamping = () => screen.getByRole('button', { name: 'Rekonsiliasi Klasifikasi/JRA' })

async function bukaJejakAturan() {
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Jejak Aturan/ }), { button: 0, ctrlKey: false })
    return screen.findByRole('button', { name: 'Rekonsiliasi Aturan' })
}

const toastMuatUlang = () => mocks.toast.mock.calls
    .map(([argumen]) => argumen)
    .find(argumen => argumen?.title === 'Data terbaru belum dapat dimuat')

async function simpanKelasTerbatas() {
    fireEvent.click(tombolUbah()[0])
    await screen.findByRole('dialog', { name: 'Ubah Metadata Arsip' })
    mocks.update.mockResolvedValue({ ...rekod, klasifikasiKeamanan: 'terbatas' })
    fireEvent.change(document.querySelector('select[name="klasifikasiKeamanan"]'), { target: { value: 'terbatas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Data terbaru belum dapat dimuat' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

beforeEach(() => {
    mocks.canWrite.mockReset().mockReturnValue(true)
    mocks.getById.mockReset().mockResolvedValue(rekod)
    mocks.getRuleHistory.mockReset().mockResolvedValue([])
    mocks.update.mockReset().mockResolvedValue({ ...rekod })
    mocks.reconcileRules.mockReset()
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

    it('tanpa hak aksi dari server: mengunci tombol dengan alasan saat arsip dalam legal hold', async () => {
        mocks.getById.mockResolvedValue(tanpaHakAksi({ legalHold: true }))
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        tombolUbah().forEach(button => expect(button).toBeDisabled())
        expect(document.getElementById('alasan-metadata-dikunci')).toHaveTextContent('Metadata dikunci karena arsip sedang dalam legal hold.')
        // Salinan di bagian atas untuk layar ponsel, tempat kartu Aksi Cepat jauh di bawah.
        expect(screen.getAllByText('Metadata dikunci karena arsip sedang dalam legal hold.')).toHaveLength(2)
        expect(tombolRekonsiliasiSamping()).toBeDisabled()
        expect(await bukaJejakAturan()).toBeDisabled()
        expect(screen.getByText(KALIMAT_HOLD_REKONSILIASI)).toBeInTheDocument()
    })

    it('tanpa hak aksi dari server: mengunci tombol saat arsip masuk proses penyusutan', async () => {
        mocks.getById.mockResolvedValue(tanpaHakAksi({ disposalStatus: 'proposed', disposalBatchId: 'batch-1' }))
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        tombolUbah().forEach(button => expect(button).toBeDisabled())
        expect(document.getElementById('alasan-metadata-dikunci')).toHaveTextContent('Metadata dikunci karena arsip sedang dalam proses penyusutan.')
        expect(tombolRekonsiliasiSamping()).toBeDisabled()
    })

    it('grant tayang saja pada arsip Terbatas mengunci ubah dan rekonsiliasi dengan alasan izin kelola', async () => {
        mocks.getById.mockResolvedValue({
            ...rekod,
            klasifikasiKeamanan: 'terbatas',
            aksiDiizinkan: [],
            alasanTerkunci: 'perlu_izin_kelola',
            izinAkses: { mode: 'view', berlakuSampai: null },
        })
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        expect(tombolUbah().length).toBeGreaterThan(0)
        tombolUbah().forEach(button => expect(button).toBeDisabled())
        const alasan = document.getElementById('alasan-metadata-dikunci')
        expect(alasan).toHaveTextContent('Persetujuan Akses Rekod')
        expect(alasan).toHaveTextContent('"Tayang saja"')
        expect(tombolRekonsiliasiSamping()).toBeDisabled()
        expect(tombolRekonsiliasiSamping()).toHaveAttribute('title', expect.stringContaining('Tayang dan kelola'))

        const tombolRiwayat = await bukaJejakAturan()
        expect(tombolRiwayat).toBeDisabled()
        expect(screen.queryByText(KALIMAT_HOLD_REKONSILIASI)).not.toBeInTheDocument()
        expect(screen.queryByText(/legal hold/)).not.toBeInTheDocument()

        tombolUbah().forEach(button => fireEvent.click(button))
        fireEvent.click(tombolRiwayat)
        fireEvent.click(tombolRekonsiliasiSamping())
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('hak aksi server menang walau keadaan rekod tampak aktif', async () => {
        mocks.getById.mockResolvedValue({ ...rekod, aksiDiizinkan: [], alasanTerkunci: 'tidak_berwenang' })
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        tombolUbah().forEach(button => expect(button).toBeDisabled())
        expect(document.getElementById('alasan-metadata-dikunci')).toHaveTextContent('Arsip ini tidak dapat diubah dengan akun Anda.')
        expect(tombolRekonsiliasiSamping()).toBeDisabled()
    })

    it('rekonsiliasi yang ditolak 404 menampilkan pesan berbahasa Indonesia', async () => {
        mocks.reconcileRules.mockRejectedValue(Object.assign(new Error('Arsip not found'), { status: 404 }))
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        fireEvent.click(tombolRekonsiliasiSamping())
        await screen.findByRole('dialog', { name: /Rekonsiliasi Klasifikasi & JRA/ })
        fireEvent.click(screen.getByRole('button', { name: 'Pilih aturan uji' }))
        fireEvent.change(screen.getByLabelText('Alasan rekonsiliasi'), { target: { value: 'Verifikasi ulang aturan aktif' } })
        fireEvent.click(screen.getByRole('button', { name: 'Simpan Revisi' }))

        expect(await screen.findByText(PESAN_ARSIP_TIDAK_DAPAT_DIUBAH)).toBeInTheDocument()
        expect(screen.queryByText('Arsip not found')).not.toBeInTheDocument()
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

    it('mengunci tombol bila muat ulang ditolak 404 setelah kelas dinaikkan', async () => {
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        mocks.getById.mockRejectedValue(Object.assign(new Error('Arsip not found'), { status: 404 }))
        await simpanKelasTerbatas()

        tombolUbah().forEach(button => expect(button).toBeDisabled())
        expect(document.getElementById('alasan-metadata-dikunci')).toHaveTextContent(
            'Arsip kini berkelas Terbatas atau lebih tinggi dan memerlukan persetujuan akses sebelum dapat dibuka atau diubah kembali.',
        )
        expect(tombolRekonsiliasiSamping()).toBeDisabled()
    })

    it('mengunci tombol bila muat ulang dijawab perlu persetujuan akses setelah kelas dinaikkan', async () => {
        mocks.getById.mockResolvedValue({ ...rekod, items: [{ id: 'item-1', nomorItem: '1', lokasiFc: 'FC-01' }] })
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        mocks.getById.mockRejectedValue(Object.assign(new Error('Rekaman ini berkelas keamanan terkendali.'), {
            status: 403,
            data: { error: 'Rekaman ini berkelas keamanan terkendali.', code: 'ACCESS_APPROVAL_REQUIRED', rekaman: { jenis: 'arsip', id: 'arsip-1', klasifikasi: 'terbatas' } },
        }))
        await simpanKelasTerbatas()

        tombolUbah().forEach(button => expect(button).toBeDisabled())
        expect(document.getElementById('alasan-metadata-dikunci')).toHaveTextContent(
            'Arsip kini berkelas Terbatas atau lebih tinggi dan memerlukan persetujuan akses sebelum dapat dibuka atau diubah kembali.',
        )
        expect(tombolRekonsiliasiSamping()).toBeDisabled()
        expect(toastMuatUlang().description).toMatch(/memerlukan persetujuan akses/)
        expect(screen.queryByText('Arsip Tidak Ditemukan')).not.toBeInTheDocument()
    })

    it('403 lain saat muat ulang tidak mengunci tombol', async () => {
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        mocks.getById.mockRejectedValue(Object.assign(new Error('Anda tidak memiliki izin.'), { status: 403, data: { error: 'Anda tidak memiliki izin.' } }))
        await simpanKelasTerbatas()

        tombolUbah().forEach(button => expect(button).toBeEnabled())
        expect(document.getElementById('alasan-metadata-dikunci')).toBeNull()
    })

    it('404 setelah kelas dan lokasi diubah menyebut daftar item yang belum termuat', async () => {
        const items = [
            { id: 'item-1', nomorItem: '1', uraianItem: 'Surat permohonan', lokasiFc: 'FC-01', lokasiLaci: 'L-02', lokasiFolder: 'F-003' },
            { id: 'item-2', nomorItem: '2', uraianItem: 'Lampiran', lokasiFc: 'FC-01', lokasiLaci: 'L-02', lokasiFolder: 'F-003' },
        ]
        mocks.getById.mockResolvedValue({ ...rekod, items })
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        fireEvent.click(tombolUbah()[0])
        await screen.findByRole('dialog', { name: 'Ubah Metadata Arsip' })

        mocks.update.mockResolvedValue({ ...rekod, items: undefined, klasifikasiKeamanan: 'terbatas', lokasiFc: 'FC-02' })
        mocks.getById.mockRejectedValue(Object.assign(new Error('Arsip not found'), { status: 404 }))
        fireEvent.change(document.querySelector('select[name="klasifikasiKeamanan"]'), { target: { value: 'terbatas' } })
        fireEvent.change(screen.getByLabelText(/^No\. Filing Cabinet/), { target: { value: 'FC-02' } })
        fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('arsip-1', { lokasiFc: 'FC-02', klasifikasiKeamanan: 'terbatas' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Data terbaru belum dapat dimuat',
            description: expect.stringContaining(PESAN_ITEM_BELUM_TERMUAT),
        })))
        expect(toastMuatUlang().description).toMatch(/memerlukan persetujuan akses/)
    })

    it('404 setelah hanya kelas diubah tidak menyebut daftar item', async () => {
        mocks.getById.mockResolvedValue({ ...rekod, items: [{ id: 'item-1', nomorItem: '1' }] })
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        mocks.getById.mockRejectedValue(Object.assign(new Error('Arsip not found'), { status: 404 }))
        await simpanKelasTerbatas()

        expect(toastMuatUlang().description).not.toContain(PESAN_ITEM_BELUM_TERMUAT)
    })

    it('galat jaringan saat muat ulang tidak mengunci tombol', async () => {
        tampilkan()
        await screen.findByRole('heading', { name: 'Detail Arsip' })
        mocks.getById.mockRejectedValue(new TypeError('Failed to fetch'))
        await simpanKelasTerbatas()

        tombolUbah().forEach(button => expect(button).toBeEnabled())
        expect(document.getElementById('alasan-metadata-dikunci')).toBeNull()
        expect(tombolRekonsiliasiSamping()).toBeEnabled()
    })
})

it('menyertakan kartu Tunjuk Silang untuk arsip ini', async () => {
    tampilkan()
    expect(await screen.findByTestId('kartu-tunjuk-silang')).toHaveTextContent('arsip:arsip-1')
})
