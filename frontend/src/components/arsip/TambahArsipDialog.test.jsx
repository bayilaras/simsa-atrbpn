import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TambahArsipDialog } from './TambahArsipDialog'
import { adaPerubahanBelumDisimpan } from '@/lib/perubahan-belum-disimpan'

const mocks = vi.hoisted(() => ({
    user: { id: 'admin-1', role: 'admin_unit', unitKerjaId: 'sesditjen' },
    createManual: vi.fn(),
    toast: vi.fn(),
    getTree: vi.fn(),
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/arsip.service', () => ({ arsipService: { createManual: mocks.createManual } }))
vi.mock('@/services/storage-location.service', () => ({ default: { getTree: mocks.getTree } }))

const ketik = (label, value) => fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } })

function bukaDialog(props = {}) {
    const onSaved = vi.fn()
    render(<TambahArsipDialog unitKerjaId="sesditjen" jenisAwal="lainnya" onSaved={onSaved} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Tambah Arsip/ }))
    return { onSaved }
}

function isiWajib() {
    ketik('Nomor Berkas', 'SK-001/2025')
    ketik('Tanggal Arsip', '2025-03-14')
    ketik('Uraian Berkas', 'Keputusan tim pengadaan')
    ketik('No. Filing Cabinet', 'FC-01')
    ketik('No. Laci', 'L-02')
    ketik('No. Folder', 'F-003')
}

beforeEach(() => {
    mocks.user = { id: 'admin-1', role: 'admin_unit', unitKerjaId: 'sesditjen' }
    mocks.createManual.mockReset().mockResolvedValue({ id: 'arsip-baru' })
    mocks.toast.mockReset()
    mocks.getTree.mockReset().mockResolvedValue({ data: [{ id: 'lok-1', code: 'B07', name: 'Boks Tujuh', level: 'box', children: [] }] })
})
afterEach(cleanup)

describe('TambahArsipDialog', () => {
    it('menahan simpan sampai isian wajib dan pernyataan lengkap', async () => {
        bukaDialog()
        expect(screen.getByRole('dialog', { name: 'Tambah Arsip' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /Simpan Arsip/ }))
        expect(await screen.findByText('Nomor Berkas wajib diisi.')).toBeInTheDocument()
        expect(screen.getByText('Centang pernyataan sebelum menyimpan.')).toBeInTheDocument()
        expect(mocks.createManual).not.toHaveBeenCalled()
    })

    it('mengirim arsip lainnya beserta unit dan lokasi simpan, lalu membuka detailnya', async () => {
        const { onSaved } = bukaDialog()
        isiWajib()
        await waitFor(() => expect(screen.getByLabelText('Lokasi Simpan')).not.toBeDisabled())
        fireEvent.change(screen.getByLabelText('Lokasi Simpan'), { target: { value: 'lok-1' } })
        fireEvent.click(screen.getByRole('checkbox'))
        fireEvent.click(screen.getByRole('button', { name: /Simpan Arsip/ }))
        await waitFor(() => expect(mocks.createManual).toHaveBeenCalledTimes(1))
        expect(mocks.createManual).toHaveBeenCalledWith(expect.objectContaining({
            unitKerjaId: 'sesditjen',
            jenisArsip: 'lainnya',
            nomorBerkas: 'SK-001/2025',
            tanggalArsip: '2025-03-14',
            storageLocationId: 'lok-1',
            klasifikasiKeamanan: 'biasa',
        }))
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 'arsip-baru' }))
    })

    it('menampilkan pesan server bila nomor berkas sudah dipakai', async () => {
        mocks.createManual.mockRejectedValue(Object.assign(new Error('Nomor berkas SK-001/2025 sudah dipakai arsip lain di unit ini untuk tahun 2025.'), { status: 409 }))
        bukaDialog()
        isiWajib()
        fireEvent.click(screen.getByRole('checkbox'))
        fireEvent.click(screen.getByRole('button', { name: /Simpan Arsip/ }))
        expect(await screen.findByText(/sudah dipakai arsip lain/)).toBeInTheDocument()
        expect(screen.getByRole('dialog', { name: 'Tambah Arsip' })).toBeInTheDocument()
    })

    describe('menutup dialog yang sudah diisi', () => {
        // Radix baru mendengarkan klik di luar dialog setelah satu putaran timer,
        // dan memutuskan penutupan setelah klik selesai.
        const jeda = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))
        const tekanEsc = () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
        async function klikDiLuar() {
            const latar = document.querySelector('[data-slot="dialog-overlay"]')
            await jeda()
            fireEvent.pointerDown(latar)
            fireEvent.click(latar)
            await jeda()
        }
        // Selagi pertanyaan tampil, dialog di bawahnya tersembunyi dari pembaca layar.
        const dialogTambah = () => document.querySelector('[data-slot="dialog-content"]')

        it('formulir yang belum diubah tertutup tanpa pertanyaan', async () => {
            bukaDialog()
            tekanEsc()
            await waitFor(() => expect(dialogTambah()).toBeNull())
            expect(screen.queryByRole('alertdialog')).toBeNull()
        })

        it('Esc pada formulir terisi bertanya dulu; memilih lanjut mengisi mempertahankan isian', async () => {
            bukaDialog()
            isiWajib()
            ketik('Keterangan', 'Dari lemari lama')
            expect(adaPerubahanBelumDisimpan()).toBe(true)
            tekanEsc()

            const tanya = await screen.findByRole('alertdialog', { name: 'Buang isian?' })
            expect(tanya).toHaveTextContent('Isian arsip ini belum disimpan')
            fireEvent.click(screen.getByRole('button', { name: 'Lanjut mengisi' }))

            await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
            expect(dialogTambah()).toBeInTheDocument()
            expect(screen.getByLabelText('Nomor Berkas', { exact: false })).toHaveValue('SK-001/2025')
            expect(screen.getByLabelText('Uraian Berkas', { exact: false })).toHaveValue('Keputusan tim pengadaan')
            expect(screen.getByLabelText('No. Folder', { exact: false })).toHaveValue('F-003')
            expect(screen.getByLabelText('Keterangan')).toHaveValue('Dari lemari lama')
        })

        it('klik di luar dialog terisi bertanya dulu; memilih buang isian menutup dan mengosongkan formulir', async () => {
            bukaDialog()
            isiWajib()
            await klikDiLuar()

            expect(await screen.findByRole('alertdialog', { name: 'Buang isian?' })).toBeInTheDocument()
            expect(dialogTambah()).toBeInTheDocument()
            fireEvent.click(screen.getByRole('button', { name: 'Buang isian' }))

            await waitFor(() => expect(dialogTambah()).toBeNull())
            expect(adaPerubahanBelumDisimpan()).toBe(false)
            fireEvent.click(screen.getByRole('button', { name: /Tambah Arsip/ }))
            expect(screen.getByLabelText('Nomor Berkas', { exact: false })).toHaveValue('')
            tekanEsc()
            await waitFor(() => expect(dialogTambah()).toBeNull())
            expect(screen.queryByRole('alertdialog')).toBeNull()
        })

        it('tombol tutup pada formulir terisi juga bertanya dulu', async () => {
            bukaDialog()
            ketik('Nomor Berkas', 'SK-002/2025')
            fireEvent.click(screen.getByRole('button', { name: 'Tutup' }))
            expect(await screen.findByRole('alertdialog', { name: 'Buang isian?' })).toBeInTheDocument()
            expect(dialogTambah()).toBeInTheDocument()
        })

        it('Batal menutup dialog tanpa pertanyaan', async () => {
            bukaDialog()
            ketik('Nomor Berkas', 'SK-002/2025')
            fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
            await waitFor(() => expect(dialogTambah()).toBeNull())
            expect(screen.queryByRole('alertdialog')).toBeNull()
            expect(adaPerubahanBelumDisimpan()).toBe(false)
        })
    })

    it('tidak menawarkan kelas Rahasia kepada Admin Unit Kerja', () => {
        bukaDialog()
        const opsi = [...screen.getByLabelText(/Klasifikasi Keamanan/).options].map(option => option.value)
        expect(opsi).toEqual(['biasa', 'terbatas'])
    })
})
