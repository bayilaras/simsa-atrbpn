import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KoreksiBerkasSection from '../KoreksiBerkasSection'

const mocks = vi.hoisted(() => ({
    user: { id: 'super-b', role: 'super_admin' },
    getKoreksiBerkas: vi.fn(), ajukanKoreksiBerkas: vi.fn(), putuskanKoreksiBerkas: vi.fn(),
    toast: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/rangkaian.service', () => ({
    rangkaianService: {
        getKoreksiBerkas: mocks.getKoreksiBerkas,
        ajukanKoreksiBerkas: mocks.ajukanKoreksiBerkas,
        putuskanKoreksiBerkas: mocks.putuskanKoreksiBerkas,
    },
}))
vi.mock('@/components/KlasifikasiPicker', () => ({
    KlasifikasiPicker: ({ onChange, id }) => (
        <button type="button" id={id} onClick={() => onChange('KU.02', { id: 7, kode: 'KU.02', jenis: 'Keuangan anggaran' })}>Pilih KU.02</button>
    ),
}))

/** Bentuk nyata: backend publicErrorResponse (error = nama kelas, message = pesan domain) lewat api.js createApiError. */
function galatApi(status, kelas, pesan) {
    const body = { success: false, error: kelas, message: pesan, code: status === 403 ? 'FORBIDDEN' : 'REQUEST_REJECTED' }
    return Object.assign(new Error(pesan), { status, data: body, response: { status, data: body } })
}

const BPPT = { id: 'dir_bppt', nama: 'Dit. BPPT' }
const PTEP = { id: 'dir_ptep', nama: 'Dit. PTEP' }
const SES = { id: 'sesditjen', nama: 'Sekretariat Ditjen' }
const KLAS3 = { id: 3, kode: 'PT.01', jenis: 'Penetapan hak' }
const KLAS7 = { id: 7, kode: 'KU.02', jenis: 'Keuangan anggaran' }

const dataKosong = {
    rangkaian: { id: 'r1', kode: 'RS-2026-000001', status: 'diberkaskan', unitPengolah: BPPT, klasifikasi: KLAS3 },
    dapatMengajukan: true,
    kandidatUnit: [{ id: 'dir_bppt', name: 'Dit. BPPT' }, { id: 'dir_ptep', name: 'Dit. PTEP' }],
    koreksi: [],
}

const koreksiPending = {
    id: 'k1', status: 'pending', unitPengolahLama: BPPT, unitPengolahBaru: PTEP, klasifikasiLama: KLAS3, klasifikasiBaru: KLAS7,
    alasan: 'Salah pilih unit pengolah', unitKehilanganAkses: ['dir_bppt'], dapatDiputuskan: true,
}
const koreksiDitolak = {
    id: 'k0', status: 'denied', unitPengolahLama: BPPT, unitPengolahBaru: SES, klasifikasiLama: KLAS3, klasifikasiBaru: KLAS3,
    alasan: 'Percobaan sebelumnya', unitKehilanganAkses: [], dapatDiputuskan: false,
}

describe('KoreksiBerkasSection', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.user = { id: 'super-b', role: 'super_admin' }
    })
    afterEach(cleanup)

    it('tidak tampil untuk admin_unit atau rangkaian yang belum diberkaskan', () => {
        mocks.user = { id: 'u1', role: 'admin_unit' }
        const { container, rerender } = render(<KoreksiBerkasSection rangkaianId="r1" status="diberkaskan" />)
        expect(container).toBeEmptyDOMElement()
        mocks.user = { id: 'super-b', role: 'super_admin' }
        rerender(<KoreksiBerkasSection rangkaianId="r1" status="selesai" />)
        expect(container).toBeEmptyDOMElement()
        expect(mocks.getKoreksiBerkas).not.toHaveBeenCalled()
    })

    // FE-M1: komponen sudah null sebelum penolakan selesai, jadi penolakan harus di-flush dulu
    // agar test ini gagal bila cabang 403/404 berubah menjadi setError.
    it.each([
        [403, 'ForbiddenError', 'Koreksi Berkas hanya dapat dilakukan oleh super_admin aktif.'],
        [404, 'NotFoundError', 'Rangkaian tidak ditemukan'],
    ])('tetap tersembunyi bila server menolak akses (%i)', async (status, kelas, pesan) => {
        mocks.getKoreksiBerkas.mockRejectedValue(galatApi(status, kelas, pesan))
        const { container } = render(<KoreksiBerkasSection rangkaianId="r1" status="diberkaskan" />)
        await waitFor(() => expect(mocks.getKoreksiBerkas).toHaveBeenCalledTimes(1))
        await act(async () => {})
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(container).toBeEmptyDOMElement()
    })

    it('galat muat selain 403/404 ditampilkan sebagai alert (kontrol positif)', async () => {
        mocks.getKoreksiBerkas.mockRejectedValue(galatApi(500, 'Internal Server Error', 'Terjadi kesalahan pada server.'))
        render(<KoreksiBerkasSection rangkaianId="r1" status="diberkaskan" />)
        expect(await screen.findByRole('alert')).toHaveTextContent('Terjadi kesalahan pada server.')
    })

    it('tanpa hak mengajukan dari server, formulir tidak tampil', async () => {
        mocks.getKoreksiBerkas.mockResolvedValue({ ...dataKosong, dapatMengajukan: false })
        render(<KoreksiBerkasSection rangkaianId="r1" status="diberkaskan" />)
        expect(await screen.findByRole('heading', { name: 'Koreksi Berkas' })).toBeInTheDocument()
        expect(screen.queryByLabelText('Unit pengolah baru')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Lanjutkan' })).not.toBeInTheDocument()
    })

    it('mengajukan koreksi lewat konfirmasi dua langkah dengan nama, bukan id', async () => {
        mocks.getKoreksiBerkas.mockResolvedValue(dataKosong)
        mocks.ajukanKoreksiBerkas.mockResolvedValue({ id: 'k1', status: 'pending' })
        render(<KoreksiBerkasSection rangkaianId="r1" status="diberkaskan" />)
        fireEvent.change(await screen.findByLabelText('Unit pengolah baru'), { target: { value: 'dir_ptep' } })
        fireEvent.click(screen.getByRole('button', { name: 'Pilih KU.02' }))
        const lanjut = screen.getByRole('button', { name: 'Lanjutkan' })
        fireEvent.change(screen.getByLabelText('Alasan koreksi'), { target: { value: 'pendek' } })
        expect(lanjut).toBeDisabled()
        fireEvent.change(screen.getByLabelText('Alasan koreksi'), { target: { value: 'Salah pilih unit pengolah' } })
        fireEvent.click(lanjut)
        expect(screen.getByText(/Dit\. BPPT → Dit\. PTEP/)).toBeInTheDocument()
        expect(screen.getByText(/PT\.01 – Penetapan hak → KU\.02 – Keuangan anggaran/)).toBeInTheDocument()
        expect(screen.queryByText(/dir_bppt/)).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Ajukan Koreksi Berkas' }))
        await waitFor(() => expect(mocks.ajukanKoreksiBerkas).toHaveBeenCalledWith('r1', {
            unitPengolahBaru: 'dir_ptep', klasifikasiBaru: 7, alasan: 'Salah pilih unit pengolah',
        }))
        await waitFor(() => expect(mocks.getKoreksiBerkas).toHaveBeenCalledTimes(2))
        expect(mocks.toast).toHaveBeenCalled()
    })

    it('tombol Lanjutkan nonaktif bila tidak ada perubahan', async () => {
        mocks.getKoreksiBerkas.mockResolvedValue(dataKosong)
        render(<KoreksiBerkasSection rangkaianId="r1" status="diberkaskan" />)
        fireEvent.change(await screen.findByLabelText('Alasan koreksi'), { target: { value: 'Alasan yang cukup panjang' } })
        expect(screen.getByRole('button', { name: 'Lanjutkan' })).toBeDisabled()
    })

    it('dengan onChanged: memanggil onChanged tanpa memuat ulang sendiri', async () => {
        mocks.getKoreksiBerkas.mockResolvedValue(dataKosong)
        mocks.ajukanKoreksiBerkas.mockResolvedValue({ id: 'k1', status: 'pending' })
        const onChanged = vi.fn()
        render(<KoreksiBerkasSection rangkaianId="r1" status="diberkaskan" onChanged={onChanged} />)
        fireEvent.change(await screen.findByLabelText('Unit pengolah baru'), { target: { value: 'dir_ptep' } })
        fireEvent.change(screen.getByLabelText('Alasan koreksi'), { target: { value: 'Salah pilih unit pengolah' } })
        fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }))
        fireEvent.click(screen.getByRole('button', { name: 'Ajukan Koreksi Berkas' }))
        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
        expect(mocks.ajukanKoreksiBerkas).toHaveBeenCalledWith('r1', {
            unitPengolahBaru: 'dir_ptep', klasifikasiBaru: 3, alasan: 'Salah pilih unit pengolah',
        })
        expect(mocks.getKoreksiBerkas).toHaveBeenCalledTimes(1)
        expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Berhasil' }))
    })

    it('galat pengajuan ditampilkan dan tidak memanggil onChanged', async () => {
        mocks.getKoreksiBerkas.mockResolvedValue(dataKosong)
        mocks.ajukanKoreksiBerkas.mockRejectedValue(galatApi(422, 'AppError', 'Disposisikan dulu ke unit ini.'))
        const onChanged = vi.fn()
        render(<KoreksiBerkasSection rangkaianId="r1" status="diberkaskan" onChanged={onChanged} />)
        fireEvent.change(await screen.findByLabelText('Unit pengolah baru'), { target: { value: 'dir_ptep' } })
        fireEvent.change(screen.getByLabelText('Alasan koreksi'), { target: { value: 'Salah pilih unit pengolah' } })
        fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }))
        fireEvent.click(screen.getByRole('button', { name: 'Ajukan Koreksi Berkas' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Disposisikan dulu ke unit ini.')
        expect(screen.getByRole('alert')).not.toHaveTextContent('AppError')
        expect(onChanged).not.toHaveBeenCalled()
    })

    it('hanya koreksi dengan dapatDiputuskan yang menampilkan Setujui/Tolak', async () => {
        mocks.getKoreksiBerkas.mockResolvedValue({ ...dataKosong, dapatMengajukan: false, koreksi: [koreksiPending, koreksiDitolak] })
        mocks.putuskanKoreksiBerkas.mockResolvedValue({ id: 'k1', status: 'applied' })
        render(<KoreksiBerkasSection rangkaianId="r1" status="diberkaskan" />)
        expect(await screen.findByText('Ditolak')).toBeInTheDocument()
        expect(screen.getByText(/Dit\. BPPT → Sekretariat Ditjen/)).toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: 'Setujui' })).toHaveLength(1)
        fireEvent.click(screen.getByRole('button', { name: 'Setujui' }))
        expect(screen.getByText(/Unit yang kehilangan akses: Dit\. BPPT/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Ya, terapkan koreksi' }))
        await waitFor(() => expect(mocks.putuskanKoreksiBerkas).toHaveBeenCalledWith('k1', { keputusan: 'setuju' }))
    })

    it('menolak koreksi pending', async () => {
        mocks.getKoreksiBerkas.mockResolvedValue({ ...dataKosong, dapatMengajukan: false, koreksi: [koreksiPending] })
        mocks.putuskanKoreksiBerkas.mockResolvedValue({ id: 'k1', status: 'denied' })
        const onChanged = vi.fn()
        render(<KoreksiBerkasSection rangkaianId="r1" status="diberkaskan" onChanged={onChanged} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Tolak' }))
        await waitFor(() => expect(mocks.putuskanKoreksiBerkas).toHaveBeenCalledWith('k1', { keputusan: 'tolak' }))
        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    })

    it('pengaju melihat koreksinya menunggu keputusan tanpa tombol keputusan', async () => {
        mocks.getKoreksiBerkas.mockResolvedValue({
            ...dataKosong, dapatMengajukan: false, koreksi: [{ ...koreksiPending, dapatDiputuskan: false }],
        })
        render(<KoreksiBerkasSection rangkaianId="r1" status="diberkaskan" />)
        expect(await screen.findByText('Menunggu keputusan')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Setujui' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Tolak' })).not.toBeInTheDocument()
    })
})
