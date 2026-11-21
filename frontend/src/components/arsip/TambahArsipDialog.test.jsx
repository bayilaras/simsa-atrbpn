import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TambahArsipDialog } from './TambahArsipDialog'

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

    it('tidak menawarkan kelas Rahasia kepada Admin Unit Kerja', () => {
        bukaDialog()
        const opsi = [...screen.getByLabelText(/Klasifikasi Keamanan/).options].map(option => option.value)
        expect(opsi).toEqual(['biasa', 'terbatas'])
    })
})
