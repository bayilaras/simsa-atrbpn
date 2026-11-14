import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DaftarSuratTerhapus } from '../DaftarSuratTerhapus'

const mocks = vi.hoisted(() => ({ daftar: vi.fn(), pulihkan: vi.fn(), toast: vi.fn() }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/surat-terhapus.service', () => ({ default: { daftar: mocks.daftar, pulihkan: mocks.pulihkan } }))

const baris = {
    id: 'sm-1', nomorSurat: 'SM-3/2026', perihal: 'Surat tunggal TU', unitKerjaId: 'sesditjen',
    unitKerjaNama: 'Sekretariat Direktorat Jenderal', dihapusOleh: 'Petugas TU',
    deletedAt: '2026-11-14T02:30:00.000Z', alasanHapus: 'Surat ganda, sudah dicatat ulang',
}
const lama = { id: 'sm-2', nomorSurat: 'SM-9/2025', perihal: 'Surat lama', unitKerjaNama: 'Direktorat BPPT', dihapusOleh: null, deletedAt: null, alasanHapus: null }
const halaman = (rows) => ({ success: true, data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 } })
const galatApi = (status, body) => Object.assign(new Error(body.message), { status, data: body, response: { status, data: body } })

beforeEach(() => {
    vi.clearAllMocks()
    mocks.daftar.mockResolvedValue(halaman([baris, lama]))
    mocks.pulihkan.mockResolvedValue({ id: 'sm-1' })
})
afterEach(cleanup)

const tampil = (props = {}) => render(<DaftarSuratTerhapus jenis="masuk" unitKerjaId={undefined} {...props} />)

it('menampilkan nomor, perihal, nama unit, penghapus, waktu, dan alasan hapus', async () => {
    tampil({ unitKerjaId: 'sesditjen' })
    const sel = within((await screen.findByText('SM-3/2026')).closest('tr'))
    expect(mocks.daftar).toHaveBeenCalledWith('masuk', { unitKerjaId: 'sesditjen', search: undefined, page: 1, limit: 20 })
    expect(sel.getByText('Surat tunggal TU')).toBeInTheDocument()
    expect(sel.getByText('Sekretariat Direktorat Jenderal')).toBeInTheDocument()
    expect(sel.getByText('Petugas TU')).toBeInTheDocument()
    expect(sel.getByText(/14 Nov 2026/)).toBeInTheDocument()
    expect(sel.getByText('Surat ganda, sudah dicatat ulang')).toBeInTheDocument()
    expect(screen.queryByText('sesditjen')).not.toBeInTheDocument()
    const selLama = within(screen.getByText('SM-9/2025').closest('tr'))
    expect(selLama.getByText('Tidak tercatat')).toBeInTheDocument()
    expect(selLama.getByText('Tidak dicatat')).toBeInTheDocument()
})

it('daftar kosong menampilkan keterangan', async () => {
    mocks.daftar.mockResolvedValue(halaman([]))
    tampil()
    expect(await screen.findByText('Tidak ada surat terhapus.')).toBeInTheDocument()
})

it('Pulihkan mewajibkan alasan minimal 10 karakter, lalu memuat ulang daftar dan memberi tahu halaman', async () => {
    const onDipulihkan = vi.fn()
    tampil({ onDipulihkan })
    fireEvent.click(await screen.findByRole('button', { name: 'Pulihkan surat SM-3/2026' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Pulihkan surat?' }))
    const kirim = dialog.getByRole('button', { name: 'Pulihkan' })
    expect(kirim).toBeDisabled()
    fireEvent.change(dialog.getByLabelText('Alasan pemulihan'), { target: { value: 'pendek' } })
    expect(kirim).toBeDisabled()
    fireEvent.change(dialog.getByLabelText('Alasan pemulihan'), { target: { value: ' Salah hapus, surat masih dipakai ' } })
    fireEvent.click(kirim)
    await waitFor(() => expect(mocks.pulihkan).toHaveBeenCalledWith('masuk', 'sm-1', 'Salah hapus, surat masih dipakai'))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
        title: 'Surat dipulihkan', description: 'Surat SM-3/2026 kembali ke daftar dengan nomor semula.',
    }))
    expect(onDipulihkan).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mocks.daftar).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('penolakan server tampil di dialog dengan pesannya, bukan nama kelas galat', async () => {
    const pesan = 'Surat ini bagian dari berkas rangkaian yang sudah diberkaskan, sehingga tidak dapat dipulihkan.'
    mocks.pulihkan.mockRejectedValue(galatApi(409, { success: false, error: 'ConflictError', message: pesan, code: 'CONFLICT' }))
    const onDipulihkan = vi.fn()
    tampil({ onDipulihkan })
    fireEvent.click(await screen.findByRole('button', { name: 'Pulihkan surat SM-3/2026' }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('Alasan pemulihan'), { target: { value: 'Salah hapus, surat masih dipakai' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Pulihkan' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent(pesan)
    expect(onDipulihkan).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
})
