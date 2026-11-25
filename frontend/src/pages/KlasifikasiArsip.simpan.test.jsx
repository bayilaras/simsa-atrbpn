import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import KlasifikasiArsip from './KlasifikasiArsip'
import JadwalRetensi from './JadwalRetensi'

const mocks = vi.hoisted(() => ({
    get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn(), toast: vi.fn(), getById: vi.fn(), getActive: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'sa', role: 'super_admin' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/api', () => ({ api: mocks, default: mocks }))
vi.mock('@/services/regulatory-rule-set.service', () => ({ default: { getById: mocks.getById, getActive: mocks.getActive } }))

// Bentuk galat services/api.js untuk AppError backend.
const galatApi = (status, body) => Object.assign(new Error(body.message), { status, data: body, response: { status, data: body } })
const butirKlasifikasi = { id: 11, kode: 'HK.01', jenis: 'Produk hukum sintetis', level: 0, children: [] }
const butirJra = { id: 21, kode: 'HK.01', uraian: 'Retensi produk hukum sintetis', level: 0, children: [] }

const halaman = {
    klasifikasi: { Komponen: KlasifikasiArsip, butir: butirKlasifikasi, nama: 'Klasifikasi', namaKecil: 'klasifikasi', teks: butirKlasifikasi.jenis, ubah: '/api/klasifikasi/items/11', hapus: '/api/klasifikasi/items/11?ruleSetId=rs-1' },
    jra: { Komponen: JadwalRetensi, butir: butirJra, nama: 'JRA', namaKecil: 'JRA', teks: butirJra.uraian, ubah: '/api/jra/items/21', hapus: '/api/jra/items/21?ruleSetId=rs-1' },
}

const tampilkan = async ({ Komponen, butir, teks }) => {
    mocks.get.mockImplementation(async (url) => (
        url.endsWith('/stats') ? { success: true, data: null } : { success: true, data: [butir] }
    ))
    render(<MemoryRouter initialEntries={['/master?ruleSetId=rs-1&mode=draft']}><Komponen /></MemoryRouter>)
    await screen.findByText(teks)
    // Tombol ubah baru muncul setelah versi aturan terbaca sebagai rancangan.
    return screen.findByRole('button', { name: 'Edit HK.01' })
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getById.mockResolvedValue({ success: true, data: { id: 'rs-1', status: 'draft' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('window.confirm tidak boleh dipakai') })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe.each(Object.entries(halaman))('simpan dan nonaktifkan butir %s', (_kunci, data) => {
    it('simpan yang ditolak server menampilkan alasannya dan dialog tetap terbuka', async () => {
        const message = 'Butir tidak dapat diubah karena versi aturan sudah diterbitkan.'
        mocks.put.mockRejectedValue(galatApi(409, { success: false, error: 'ConflictError', message }))
        fireEvent.click(await tampilkan(data))
        fireEvent.click(await screen.findByRole('button', { name: 'Simpan Perubahan' }))
        expect(await screen.findByRole('alert')).toHaveTextContent(message)
        expect(screen.getByRole('button', { name: 'Simpan Perubahan' })).toBeEnabled()
        expect(mocks.put).toHaveBeenCalledWith(data.ubah, expect.objectContaining({ ruleSetId: 'rs-1' }))
        expect(mocks.toast).not.toHaveBeenCalled()
    })

    it('simpan yang berhasil menutup dialog dan memberi tahu pengguna', async () => {
        mocks.put.mockResolvedValue({ success: true, data: data.butir })
        fireEvent.click(await tampilkan(data))
        fireEvent.click(await screen.findByRole('button', { name: 'Simpan Perubahan' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: `${data.nama} berhasil diperbarui` }))
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Simpan Perubahan' })).not.toBeInTheDocument())
    })

    it('nonaktifkan memakai dialog aplikasi dan menampilkan penolakan server', async () => {
        const message = 'Butir masih dipakai oleh arsip.'
        mocks.delete.mockRejectedValue(galatApi(409, { success: false, error: 'ConflictError', message }))
        await tampilkan(data)
        fireEvent.click(screen.getByRole('button', { name: 'Nonaktifkan HK.01' }))
        const dialog = await screen.findByRole('alertdialog')
        expect(dialog).toHaveTextContent(`Nonaktifkan ${data.namaKecil}?`)
        fireEvent.click(within(dialog).getByRole('button', { name: 'Nonaktifkan' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
            variant: 'destructive', title: `Gagal menonaktifkan ${data.namaKecil}`, description: message,
        }))
        expect(mocks.delete).toHaveBeenCalledWith(data.hapus)
    })

    it('nonaktifkan yang berhasil memberi tahu pengguna; yang dibatalkan tidak memanggil server', async () => {
        mocks.delete.mockResolvedValue({ success: true })
        await tampilkan(data)
        fireEvent.click(screen.getByRole('button', { name: 'Nonaktifkan HK.01' }))
        fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Batal' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
        expect(mocks.delete).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Nonaktifkan HK.01' }))
        fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Nonaktifkan' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: `${data.nama} berhasil dinonaktifkan` }))
    })
})
