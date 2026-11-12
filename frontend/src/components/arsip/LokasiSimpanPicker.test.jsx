import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ArchiveDialog } from '@/components/ArchiveDialog'
import { EditArsipDialog } from './EditArsipDialog'
import { LokasiSimpanPicker } from './LokasiSimpanPicker'
import { bolehMemilihLokasiUnit, daftarPilihanLokasi, namaJalurLokasi, tautanArsipLokasi } from './lokasi-simpan'

const mocks = vi.hoisted(() => ({
    user: { id: 'admin-1', role: 'admin_unit', unitKerjaId: 'unit-1' },
    getTree: vi.fn(),
    update: vi.fn(),
    toast: vi.fn(),
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/arsip.service', () => ({ arsipService: { update: mocks.update } }))
vi.mock('@/services/storage-location.service', () => ({ default: { getTree: mocks.getTree } }))
vi.mock('@/components/archive-registration-validation', () => ({ validateArchiveRegistration: () => '' }))
vi.mock('@/components/KlasifikasiPicker', () => ({ KlasifikasiPicker: () => null }))

const BOKS = '70000000-0000-4000-8000-000000000004'
const RAK = '70000000-0000-4000-8000-000000000003'
const pohon = [{
    id: 'gedung-1', code: 'G1', name: 'Gedung Arsip', level: 'gedung',
    children: [{
        id: RAK, code: 'G1-RAK1', name: 'Rak Satu', level: 'rak',
        children: [{ id: BOKS, code: 'G1-RAK1-B1', name: 'Boks Satu', level: 'box', children: [] }],
    }],
}]

beforeEach(() => {
    mocks.user = { id: 'admin-1', role: 'admin_unit', unitKerjaId: 'unit-1' }
    mocks.getTree.mockReset().mockResolvedValue({ success: true, data: pohon })
    mocks.update.mockReset().mockResolvedValue({ id: 'arsip-1' })
    mocks.toast.mockReset()
})
afterEach(cleanup)

describe('pembantu lokasi simpan', () => {
    it('menyusun pilihan berurutan dengan nama jalur dan kode', () => {
        expect(daftarPilihanLokasi(pohon)).toEqual([
            { id: 'gedung-1', label: 'Gedung Arsip (G1)' },
            { id: RAK, label: 'Gedung Arsip / Rak Satu (G1-RAK1)' },
            { id: BOKS, label: 'Gedung Arsip / Rak Satu / Boks Satu (G1-RAK1-B1)' },
        ])
        expect(namaJalurLokasi([], 'G1')).toBe('G1')
        expect(namaJalurLokasi()).toBe('')
    })

    it('lokasi unit hanya dapat dipilih pengguna unit itu atau Super Admin', () => {
        expect(bolehMemilihLokasiUnit({ role: 'admin_unit', unitKerjaId: 'unit-1' }, 'unit-1')).toBe(true)
        expect(bolehMemilihLokasiUnit({ role: 'admin_unit', unitKerjaId: 'unit-2' }, 'unit-1')).toBe(false)
        expect(bolehMemilihLokasiUnit({ role: 'admin_dirjen', unitKerjaId: 'unit-1' }, 'ditjen')).toBe(true)
        expect(bolehMemilihLokasiUnit({ role: 'super_admin' }, 'unit-1')).toBe(true)
        expect(bolehMemilihLokasiUnit({ role: 'super_admin' }, '')).toBe(false)
        expect(bolehMemilihLokasiUnit(null, 'unit-1')).toBe(false)
    })

    it('tautan daftar arsip membuka tab yang berisi arsip', () => {
        expect(tautanArsipLokasi({ id: BOKS, arsipMasukCount: 2, arsipKeluarCount: 0 }, 'unit-1')).toBe(`/arsip/masuk?lokasi=${BOKS}&unit=unit-1`)
        expect(tautanArsipLokasi({ id: BOKS, arsipMasukCount: 2, arsipKeluarCount: 1 }, 'unit-1')).toBe(`/arsip/keluar?lokasi=${BOKS}&unit=unit-1`)
        expect(tautanArsipLokasi({ id: BOKS })).toBe(`/arsip/keluar?lokasi=${BOKS}`)
    })
})

describe('LokasiSimpanPicker', () => {
    it('memuat lokasi unit dan melaporkan pilihan', async () => {
        const onChange = vi.fn()
        render(<><label htmlFor="lokasi">Lokasi Simpan</label><LokasiSimpanPicker id="lokasi" unitKerjaId="unit-1" value="" onChange={onChange} /></>)
        expect(screen.getByRole('status')).toHaveTextContent('Memuat daftar lokasi simpan…')
        await screen.findByRole('option', { name: 'Gedung Arsip / Rak Satu / Boks Satu (G1-RAK1-B1)' })
        expect(mocks.getTree).toHaveBeenCalledWith('unit-1')
        expect(screen.getByRole('option', { name: 'Belum ditentukan' }).selected).toBe(true)
        fireEvent.change(screen.getByLabelText('Lokasi Simpan'), { target: { value: BOKS } })
        expect(onChange).toHaveBeenCalledWith(BOKS)
    })

    it('unit tanpa lokasi mendapat petunjuk menambahkannya', async () => {
        mocks.getTree.mockResolvedValue({ success: true, data: [] })
        render(<LokasiSimpanPicker id="lokasi" unitKerjaId="unit-1" value="" onChange={vi.fn()} />)
        expect(await screen.findByText('Belum ada lokasi simpan untuk unit kerja ini. Tambahkan lebih dulu di menu Lokasi Simpan.')).toBeInTheDocument()
    })

    it('gagal memuat tetap menampilkan lokasi yang sudah tersimpan', async () => {
        mocks.getTree.mockRejectedValue(new Error('jaringan'))
        render(<LokasiSimpanPicker id="lokasi" unitKerjaId="unit-1" value={BOKS} onChange={vi.fn()}
            lokasiTersimpan={{ id: BOKS, code: 'G1-RAK1-B1', jalur: [{ name: 'Gedung Arsip' }, { name: 'Boks Satu' }] }} />)
        expect(await screen.findByRole('alert')).toHaveTextContent('Daftar lokasi simpan tidak dapat dimuat.')
        expect(screen.getByRole('option', { name: 'Gedung Arsip / Boks Satu (G1-RAK1-B1)' }).selected).toBe(true)
    })
})

describe('Ubah Metadata Arsip: Lokasi Simpan', () => {
    const rekod = {
        id: 'arsip-1', unitKerjaId: 'unit-1', nomorBerkas: 'B-001/2026', uraianBerkas: 'Berkas pengadaan',
        unitPengolah: 'Ditjen', mediaType: 'kertas', lokasiFc: 'FC-01', lokasiLaci: 'L-02', lokasiFolder: 'F-003',
        klasifikasiKeamanan: 'biasa', items: [],
    }
    const tampilkan = arsip => render(<EditArsipDialog open onOpenChange={vi.fn()} arsip={arsip} onSaved={vi.fn()} />)

    it('memilih lokasi hanya mengirim storageLocationId', async () => {
        tampilkan(rekod)
        await screen.findByRole('option', { name: 'Gedung Arsip / Rak Satu (G1-RAK1)' })
        fireEvent.change(screen.getByLabelText('Lokasi Simpan'), { target: { value: RAK } })
        fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('arsip-1', { storageLocationId: RAK }))
    })

    it('mengosongkan pilihan melepas arsip dari lokasinya', async () => {
        tampilkan({ ...rekod, storageLocationId: BOKS, lokasiSimpan: { id: BOKS, code: 'G1-RAK1-B1', jalur: [{ name: 'Boks Satu' }] } })
        await screen.findByRole('option', { name: 'Gedung Arsip / Rak Satu (G1-RAK1)' })
        expect(screen.getByLabelText('Lokasi Simpan')).toHaveValue(BOKS)
        fireEvent.change(screen.getByLabelText('Lokasi Simpan'), { target: { value: '' } })
        fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('arsip-1', { storageLocationId: null }))
    })

    it('arsip unit lain tidak menawarkan pilihan lokasi', () => {
        tampilkan({ ...rekod, unitKerjaId: 'unit-2' })
        expect(screen.queryByLabelText('Lokasi Simpan')).not.toBeInTheDocument()
        expect(mocks.getTree).not.toHaveBeenCalled()
    })
})

describe('Arsipkan Surat: Lokasi Simpan', () => {
    const surat = { id: 'surat-1', unitKerjaId: 'unit-1', nomorSurat: '001/2026', perihal: 'Arsip surat', tanggalSurat: '2026-09-12', sifatSurat: 'Biasa' }
    const buka = (suratData = surat) => {
        const onArchive = vi.fn().mockResolvedValue(undefined)
        render(<MemoryRouter><ArchiveDialog open onOpenChange={vi.fn()} suratType="masuk" suratData={suratData} onArchive={onArchive} /></MemoryRouter>)
        return onArchive
    }
    const setujuDanKirim = () => {
        const pernyataan = screen.queryByRole('checkbox')
        if (pernyataan) fireEvent.click(pernyataan)
        fireEvent.submit(document.getElementById('archive-form'))
    }

    it('lokasi yang dipilih ikut dikirim', async () => {
        const onArchive = buka()
        await screen.findByRole('option', { name: 'Gedung Arsip / Rak Satu / Boks Satu (G1-RAK1-B1)' })
        expect(mocks.getTree).toHaveBeenCalledWith('unit-1')
        fireEvent.change(screen.getByLabelText('Lokasi Simpan'), { target: { value: BOKS } })
        setujuDanKirim()
        await waitFor(() => expect(onArchive).toHaveBeenCalled())
        expect(onArchive.mock.calls[0][0]).toMatchObject({ storageLocationId: BOKS })
    })

    it('tanpa pilihan, storageLocationId tidak dikirim', async () => {
        const onArchive = buka()
        await screen.findByRole('option', { name: 'Gedung Arsip (G1)' })
        setujuDanKirim()
        await waitFor(() => expect(onArchive).toHaveBeenCalled())
        expect(onArchive.mock.calls[0][0]).not.toHaveProperty('storageLocationId')
    })

    it('surat unit lain tidak menawarkan pilihan lokasi', () => {
        buka({ ...surat, unitKerjaId: 'unit-2' })
        expect(screen.queryByLabelText('Lokasi Simpan')).not.toBeInTheDocument()
        expect(mocks.getTree).not.toHaveBeenCalled()
    })
})
