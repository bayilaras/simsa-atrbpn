import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PESAN_KELAS_TERBATAS_PERAN } from '@/lib/kelas-keamanan'
import { EditArsipDialog } from './EditArsipDialog'
import { PESAN_ARSIP_TIDAK_DAPAT_DIUBAH } from './edit-arsip-form'

const mocks = vi.hoisted(() => ({
    user: { id: 'admin-1', role: 'admin_unit', unitKerjaId: 'unit-1' },
    update: vi.fn(),
    toast: vi.fn(),
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/arsip.service', () => ({ arsipService: { update: mocks.update } }))

const rekod = {
    id: 'arsip-1',
    nomorBerkas: 'B-001/2026',
    uraianBerkas: 'Berkas pengadaan',
    unitPengolah: 'Ditjen',
    kurunWaktu: '2026-01-01 s/d 2026-12-31',
    tanggalArsip: '2026-03-04',
    nomorItem: '1',
    uraianItem: 'Surat permohonan',
    tingkatPerkembangan: 'Asli',
    jumlah: 2,
    mediaType: 'kertas',
    lokasiFc: 'FC-01',
    lokasiLaci: 'L-02',
    lokasiFolder: 'F-003',
    klasifikasiKeamanan: 'biasa',
    personInCharge: 'Rina',
    keterangan: '',
    sourceSuratId: 'surat-1',
    items: [],
    // Field retensi ikut terbaca dari detail tetapi tidak boleh terkirim.
    jraKode: 'F.VI.01',
    retensiAktif: '2 tahun',
    hasilAkhir: 'Musnah',
    tanggalKadaluarsa: '2031-01-01',
}

// Radix Select di dalam <form> merender <select> native tersembunyi bernama
// sama; nilai dan opsinya mencerminkan Select yang tampil.
const selectNative = name => document.querySelector(`select[name="${name}"]`)
const opsi = name => [...selectNative(name).options].map(option => option.value).filter(Boolean)
const pilih = (name, value) => fireEvent.change(selectNative(name), { target: { value } })
const ketik = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const tombolSimpan = () => screen.getByRole('button', { name: 'Simpan' })

function tampilkan(arsip = rekod, props = {}) {
    const onOpenChange = vi.fn()
    const onSaved = vi.fn()
    render(<EditArsipDialog open onOpenChange={onOpenChange} arsip={arsip} onSaved={onSaved} {...props} />)
    return { onOpenChange, onSaved }
}

beforeEach(() => {
    mocks.user = { id: 'admin-1', role: 'admin_unit', unitKerjaId: 'unit-1' }
    mocks.update.mockReset().mockResolvedValue({ id: 'arsip-1' })
    mocks.toast.mockReset()
})
afterEach(cleanup)

describe('EditArsipDialog', () => {
    it('mengisi formulir dari rekod', () => {
        tampilkan()
        expect(screen.getByRole('dialog', { name: 'Ubah Metadata Arsip' })).toBeInTheDocument()
        expect(screen.getByLabelText(/^Nomor Berkas/)).toHaveValue('B-001/2026')
        expect(screen.getByLabelText(/^Uraian Berkas/)).toHaveValue('Berkas pengadaan')
        expect(screen.getByLabelText('Dari')).toHaveValue('2026-01-01')
        expect(screen.getByLabelText('Sampai')).toHaveValue('2026-12-31')
        expect(screen.getByLabelText('Tanggal Arsip')).toHaveValue('2026-03-04')
        expect(screen.getByLabelText('Jumlah')).toHaveValue(2)
        expect(screen.getByLabelText(/^No\. Filing Cabinet/)).toHaveValue('FC-01')
        expect(screen.getByLabelText(/^No\. Laci/)).toHaveValue('L-02')
        expect(screen.getByLabelText(/^No\. Folder/)).toHaveValue('F-003')
        expect(screen.getByLabelText('Person In Charge (PIC)')).toHaveValue('Rina')
        expect(selectNative('unitPengolah')).toHaveValue('Ditjen')
        expect(selectNative('tingkatPerkembangan')).toHaveValue('Asli')
        expect(selectNative('mediaType')).toHaveValue('kertas')
        expect(selectNative('klasifikasiKeamanan')).toHaveValue('biasa')
        expect(screen.getByText(/Kode klasifikasi arsip dan JRA tidak diubah di sini/)).toBeInTheDocument()
    })

    it('Simpan nonaktif selama belum ada perubahan', () => {
        tampilkan()
        expect(tombolSimpan()).toBeDisabled()
        expect(screen.getByText('Belum ada perubahan untuk disimpan.')).toBeInTheDocument()

        ketik(/^Uraian Berkas/, 'Berkas pengadaan barang')
        expect(tombolSimpan()).toBeEnabled()

        // Spasi di tepi tidak dihitung sebagai perubahan.
        ketik(/^Uraian Berkas/, '  Berkas pengadaan  ')
        expect(tombolSimpan()).toBeDisabled()
    })

    it('hanya mengirim field yang berubah, tanpa field retensi', async () => {
        const { onOpenChange, onSaved } = tampilkan()
        ketik(/^Nomor Berkas/, '  B-002/2026  ')
        ketik('Jumlah', '3')
        pilih('tingkatPerkembangan', 'Salinan')
        fireEvent.click(tombolSimpan())

        await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
        const harapan = { nomorBerkas: 'B-002/2026', tingkatPerkembangan: 'Salinan', jumlah: 3 }
        expect(mocks.update).toHaveBeenCalledWith('arsip-1', harapan)
        expect(mocks.toast).toHaveBeenCalledWith({ title: 'Metadata arsip diperbarui' })
        expect(onOpenChange).toHaveBeenCalledWith(false)
        expect(onSaved).toHaveBeenCalledWith(harapan, { id: 'arsip-1' })
    })

    it('menampilkan galat validasi dan tidak mengirim', async () => {
        tampilkan()
        ketik(/^Nomor Berkas/, '   ')
        ketik(/^No\. Filing Cabinet/, '')
        ketik('Jumlah', '0')
        ketik('Sampai', '2025-12-31')
        ketik('Tanggal Arsip', '')
        ketik(/^Uraian Berkas/, 'x'.repeat(2001))
        fireEvent.click(tombolSimpan())

        expect(await screen.findByText('Nomor Berkas wajib diisi.')).toBeInTheDocument()
        expect(screen.getByText('No. Filing Cabinet wajib diisi.')).toBeInTheDocument()
        expect(screen.getByText('Jumlah harus bilangan bulat 1 sampai 10.000.')).toBeInTheDocument()
        expect(screen.getByText('Tanggal akhir kurun waktu tidak boleh sebelum tanggal awal.')).toBeInTheDocument()
        expect(screen.getByText('Tanggal arsip tidak boleh dikosongkan.')).toBeInTheDocument()
        expect(screen.getByText(/Uraian Berkas maksimal 2\.000 karakter/)).toBeInTheDocument()
        expect(screen.getByText('Periksa kembali isian yang ditandai sebelum menyimpan.')).toBeInTheDocument()
        expect(screen.getByLabelText(/^Nomor Berkas/)).toHaveAttribute('aria-invalid', 'true')
        expect(screen.getByLabelText(/^Nomor Berkas/)).toHaveFocus()
        expect(mocks.update).not.toHaveBeenCalled()
    })

    it('admin unit tidak melihat Rahasia/Sangat Rahasia untuk rekod Biasa', () => {
        tampilkan()
        expect(opsi('klasifikasiKeamanan')).toEqual(['biasa', 'terbatas'])
        expect(screen.getByText(PESAN_KELAS_TERBATAS_PERAN)).toBeInTheDocument()
    })

    it('admin unit tetap melihat kelas yang sudah melekat pada rekod', () => {
        tampilkan({ ...rekod, klasifikasiKeamanan: 'rahasia' })
        expect(opsi('klasifikasiKeamanan')).toEqual(['biasa', 'terbatas', 'rahasia'])
        expect(selectNative('klasifikasiKeamanan')).toHaveValue('rahasia')
        expect(screen.getByText(/Kelas Rahasia yang sudah tersimpan boleh dipertahankan/)).toBeInTheDocument()
        expect(screen.queryByText(PESAN_KELAS_TERBATAS_PERAN)).not.toBeInTheDocument()
    })

    it('super admin melihat semua kelas tanpa teks pembatasan', () => {
        mocks.user = { id: 'root-1', role: 'super_admin' }
        tampilkan()
        expect(opsi('klasifikasiKeamanan')).toEqual(['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'])
        expect(screen.queryByText(PESAN_KELAS_TERBATAS_PERAN)).not.toBeInTheDocument()
    })

    it('menaikkan kelas ke Terbatas menampilkan peringatan persetujuan akses', async () => {
        tampilkan()
        expect(screen.queryByText(/memerlukan persetujuan akses berjangka/)).not.toBeInTheDocument()
        pilih('klasifikasiKeamanan', 'terbatas')
        expect(screen.getByText(/memerlukan persetujuan akses berjangka/)).toBeInTheDocument()
        fireEvent.click(tombolSimpan())
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('arsip-1', { klasifikasiKeamanan: 'terbatas' }))
    })

    it('403 plafon kelas dari server ditampilkan sebagai pesan kewenangan peran', async () => {
        mocks.update.mockRejectedValue(Object.assign(new Error('Klasifikasi keamanan melebihi kewenangan pengguna'), { status: 403 }))
        const { onOpenChange, onSaved } = tampilkan()
        pilih('klasifikasiKeamanan', 'terbatas')
        fireEvent.click(tombolSimpan())
        const alert = await screen.findByRole('alert')
        expect(within(alert).getByText(PESAN_KELAS_TERBATAS_PERAN)).toBeInTheDocument()
        expect(onOpenChange).not.toHaveBeenCalled()
        expect(onSaved).not.toHaveBeenCalled()
        expect(mocks.toast).not.toHaveBeenCalled()
    })

    it('404 dijelaskan sebagai arsip yang tidak dapat diubah', async () => {
        mocks.update.mockRejectedValue(Object.assign(new Error('Arsip not found'), { status: 404 }))
        tampilkan()
        ketik(/^Nomor Berkas/, 'B-003/2026')
        fireEvent.click(tombolSimpan())
        expect(await screen.findByText(PESAN_ARSIP_TIDAK_DAPAT_DIUBAH)).toBeInTheDocument()
    })

    it('kurun waktu lama berformat bebas tetap disunting sebagai teks', async () => {
        tampilkan({ ...rekod, kurunWaktu: 'Januari s/d Maret 2020', items: [{ id: 'item-1' }] })
        expect(screen.getByLabelText('Kurun Waktu')).toHaveValue('Januari s/d Maret 2020')
        expect(screen.getByText(/item yang menjadi ringkasan berkas di tab Item Arsip disamakan dengan semua isian tersebut pada formulir ini, termasuk yang tidak diubah/)).toBeInTheDocument()
        ketik('Kurun Waktu', 'Januari s/d April 2020')
        fireEvent.click(tombolSimpan())
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('arsip-1', { kurunWaktu: 'Januari s/d April 2020' }))
    })

    it('catatan sinkron item dan lokasi hanya tampil bila berkas punya daftar item', () => {
        tampilkan({ ...rekod, items: [{ id: 'item-1' }, { id: 'item-2' }] })
        expect(screen.getByText(/Jumlah dan media tidak mengubah daftar item\./)).toBeInTheDocument()
        expect(screen.getByText('Lokasi baru juga diterapkan pada item yang tersimpan di lokasi lama yang sama.')).toBeInTheDocument()
        cleanup()

        tampilkan()
        expect(screen.queryByText(/Jumlah dan media tidak mengubah daftar item\./)).not.toBeInTheDocument()
        expect(screen.queryByText(/Lokasi baru juga diterapkan/)).not.toBeInTheDocument()
    })

    it('409 dari server ditampilkan apa adanya dan dialog tetap terbuka', async () => {
        const pesan = 'Ringkasan item dan lokasi arsip tidak dapat diubah selama appraisal JRA masih terbuka atau sedang ditelaah.'
        mocks.update.mockRejectedValue(Object.assign(new Error('ConflictError'), { status: 409, data: { error: 'ConflictError', message: pesan } }))
        const { onOpenChange, onSaved } = tampilkan({ ...rekod, items: [{ id: 'item-1' }] })
        ketik(/^No\. Folder/, 'F-004')
        fireEvent.click(tombolSimpan())
        const alert = await screen.findByRole('alert')
        expect(within(alert).getByText(pesan)).toBeInTheDocument()
        expect(onOpenChange).not.toHaveBeenCalled()
        expect(onSaved).not.toHaveBeenCalled()
        expect(mocks.toast).not.toHaveBeenCalled()
    })
})

// Induk seperti ArsipDetail: Muat ulang mengganti rekod dengan data terbaru.
function IndukMuatUlang({ awal, terbaru, onMuatUlang }) {
    const [arsip, setArsip] = useState(awal)
    return <EditArsipDialog open onOpenChange={() => {}} arsip={arsip} onSaved={() => {}}
        onMuatUlang={async () => { onMuatUlang(); setArsip(terbaru); return true }} />
}

describe('EditArsipDialog: arsip diubah orang lain sejak dialog dibuka', () => {
    const PESAN_VERSI = 'Data ini sudah diubah pengguna lain sejak Anda membukanya. Muat ulang halaman untuk melihat perubahan terbaru, lalu ulangi perubahan Anda.'
    const galatVersi = () => Object.assign(new Error(PESAN_VERSI), {
        status: 409, data: { success: false, error: 'DataSudahBerubahError', message: PESAN_VERSI, code: 'DATA_SUDAH_BERUBAH' },
    })

    it('mengirim updatedAt yang dimuat bersama perubahan, bukan sebagai metadata', async () => {
        const { onSaved } = tampilkan({ ...rekod, updatedAt: '2026-03-04T08:00:00.123Z' })
        ketik(/^Nomor Berkas/, 'B-002/2026')
        fireEvent.click(tombolSimpan())
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('arsip-1', { nomorBerkas: 'B-002/2026', expectedUpdatedAt: '2026-03-04T08:00:00.123Z' }))
        expect(onSaved).toHaveBeenCalledWith({ nomorBerkas: 'B-002/2026' }, { id: 'arsip-1' })
    })

    it('menampilkan pesan dengan Muat ulang yang memasang ulang formulir dari data terbaru', async () => {
        mocks.update.mockRejectedValueOnce(galatVersi())
        const onMuatUlang = vi.fn()
        render(<IndukMuatUlang awal={{ ...rekod, updatedAt: '2026-03-04T08:00:00.123Z' }}
            terbaru={{ ...rekod, nomorBerkas: 'B-077/2026', updatedAt: '2026-03-04T09:30:00.000Z' }} onMuatUlang={onMuatUlang} />)
        ketik(/^Nomor Berkas/, 'B-002/2026')
        fireEvent.click(tombolSimpan())
        const alert = await screen.findByRole('alert')
        expect(within(alert).getByText(PESAN_VERSI)).toBeInTheDocument()

        fireEvent.click(within(alert).getByRole('button', { name: 'Muat ulang' }))
        expect(await screen.findByDisplayValue('B-077/2026')).toBeInTheDocument()
        expect(onMuatUlang).toHaveBeenCalledTimes(1)
        expect(screen.queryByText(PESAN_VERSI)).toBeNull()

        ketik(/^Uraian Berkas/, 'Berkas pengadaan barang')
        fireEvent.click(tombolSimpan())
        await waitFor(() => expect(mocks.update).toHaveBeenLastCalledWith('arsip-1',
            { uraianBerkas: 'Berkas pengadaan barang', expectedUpdatedAt: '2026-03-04T09:30:00.000Z' }))
    })

    it('konflik lain tidak menawarkan Muat ulang', async () => {
        mocks.update.mockRejectedValueOnce(Object.assign(new Error('Konflik'), { status: 409, data: { error: 'ConflictError', message: 'Konflik lain.', code: 'CONFLICT' } }))
        tampilkan()
        ketik(/^Nomor Berkas/, 'B-002/2026')
        fireEvent.click(tombolSimpan())
        const alert = await screen.findByRole('alert')
        expect(within(alert).getByText('Konflik lain.')).toBeInTheDocument()
        expect(within(alert).queryByRole('button', { name: 'Muat ulang' })).toBeNull()
    })
})
