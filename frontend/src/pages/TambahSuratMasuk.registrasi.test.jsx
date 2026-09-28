import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratMasuk from './TambahSuratMasuk'
import { clearOfflineStorage } from '@/lib/offline-storage'

const mocks = vi.hoisted(() => ({
    masuk: { create: vi.fn(), getNextNumber: vi.fn(), getById: vi.fn(), update: vi.fn() },
    dist: { getDistributableUnits: vi.fn(), getOpsi: vi.fn() },
    lacak: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-tu', role: 'admin_unit', unitKerjaId: 'sesditjen' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: mocks.masuk }))
vi.mock('@/services/distribution.service', () => ({ default: mocks.dist, distributionService: mocks.dist }))
vi.mock('@/services/rangkaian.service', () => ({ rangkaianService: { lacak: mocks.lacak }, default: { lacak: mocks.lacak } }))
vi.mock('@/components/ui/searchable-select', () => ({
    SearchableSelect: ({ id, ariaLabel, value, onValueChange, options }) => (
        <select id={id} aria-label={ariaLabel} value={value} onChange={event => onValueChange(event.target.value)}>
            <option value="">Pilih</option>
            {options.map(option => {
                const item = typeof option === 'string' ? { value: option, label: option } : option
                return <option key={item.value} value={item.value}>{item.label}</option>
            })}
        </select>
    ),
}))
vi.mock('@/components/ui/multi-select', () => ({
    MultiSelect: ({ id, ariaLabel, selected, onChange, options }) => (
        <select id={id} aria-label={ariaLabel} multiple value={selected}
            onChange={event => onChange(Array.from(event.target.selectedOptions, item => item.value))}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    ),
}))

const nodeSk = { anggotaId: null, jenis: 'surat_keluar', id: 'sk-1', nomorSurat: 'B-5/2026', perihal: 'Permintaan data',
    tanggalSurat: '2026-09-01', tahun: 2026, naskah: 'Surat Dinas', unitKerjaId: 'dir_bppt', unitNama: 'Dit. BPPT', relasi: null, masked: false }
const kelompokDasar = { skor: 90, tanggalTerbaru: '2026-09-01', cocok: [], jumlahAnggota: 1, pratinjauTerpotong: false }
let router

beforeEach(async () => {
    vi.clearAllMocks()
    await clearOfflineStorage()
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.masuk.create.mockResolvedValue({ data: { id: 'sm-baru' } })
    mocks.masuk.getNextNumber.mockResolvedValue({ nomorSurat: '001/SM/2026' })
    mocks.dist.getDistributableUnits.mockResolvedValue([
        { id: 'dir_bppt', name: 'Dit. BPPT', unitType: 'direktorat' },
        { id: 'dir_ptep', name: 'Dit. PTEP', unitType: 'direktorat' },
        { id: 'bagian_umum', name: 'Bagian Umum', unitType: 'bagian' },
    ])
    mocks.dist.getOpsi.mockResolvedValue({ instruksi: ['Mohon ditindaklanjuti sesuai ketentuan'], jalurAksesTerkendali: false })
    mocks.lacak.mockImplementation(async ({ q, mode }) => ({ q, mode, jenisKueri: 'nomor',
        kelompok: mode === 'cek' && q === 'B-12/2026'
            ? [{ ...kelompokDasar, kunci: 'rs-9', rangkaian: { id: 'rs-9', kode: 'RS-2026-000123', status: 'aktif', judul: 'X', tahun: 2026, asal: 'surat_masuk' }, pratinjau: [] }]
            : mode === 'referensi' ? [{ ...kelompokDasar, kunci: 'surat:sk-1', rangkaian: null, pratinjau: [nodeSk] }] : [] }))
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

async function tampilDanIsi() {
    router = createMemoryRouter([
        { path: '/surat/masuk/tambah', element: <TambahSuratMasuk /> },
        { path: '/surat/masuk', element: <h1>Daftar</h1> },
    ], { initialEntries: ['/surat/masuk/tambah'] })
    const view = render(<RouterProvider router={router} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Jenis surat' }), { target: { value: 'Nota Dinas' } })
    fireEvent.change(screen.getByLabelText(/Tanggal Surat/), { target: { value: '2026-09-23' } })
    fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Permohonan penetapan lokasi' } })
    fireEvent.change(screen.getByLabelText(/^Dari \(Pengirim\)/), { target: { value: 'Pemda Sintetis' } })
    fireEvent.change(screen.getByLabelText(/^Kepada \(Penerima\)/), { target: { value: 'Direktur Jenderal' } })
    await screen.findByRole('option', { name: 'Dit. BPPT' })
    return view
}

function pilihDisposisi(values) {
    const listbox = screen.getByRole('listbox', { name: 'Penerima disposisi' })
    for (const option of listbox.options) option.selected = values.includes(option.value)
    fireEvent.change(listbox)
}

describe('registrasi surat masuk', () => {
    it('disposisi multi-unit dengan penanggung jawab, instruksi, dan label Kabag saja', async () => {
        const view = await tampilDanIsi()
        expect(screen.queryByRole('option', { name: /Bagian Umum/ })).toBeNull()
        pilihDisposisi(['dir_bppt', 'dir_ptep', 'Kabag Program dan Hukum'])
        fireEvent.click(screen.getByRole('radio', { name: 'Dit. BPPT' }))
        fireEvent.click(screen.getByRole('button', { name: 'Mohon ditindaklanjuti sesuai ketentuan' }))
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.create).toHaveBeenCalled())
        const payload = mocks.masuk.create.mock.calls[0][0]
        expect(payload.disposisi).toEqual({
            targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep', penanggungJawab: false }],
            instruksi: 'Mohon ditindaklanjuti sesuai ketentuan',
            labelTambahan: ['Kabag Program dan Hukum'],
        })
        expect(payload).not.toHaveProperty('disposisiPj')
    })

    it('tanpa disposisi meminta konfirmasi; bila dibatalkan tidak menyimpan', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
        const view = await tampilDanIsi()
        fireEvent.submit(view.container.querySelector('form'))
        expect(confirm).toHaveBeenCalledWith('Surat belum didisposisikan. Simpan tanpa disposisi?')
        expect(mocks.masuk.create).not.toHaveBeenCalled()
    })

    it('surat terkendali dengan disposisi ditolak di klien selama jalur akses mati', async () => {
        const view = await tampilDanIsi()
        fireEvent.change(document.getElementById('sifat-surat'), { target: { value: 'rahasia' } })
        pilihDisposisi(['dir_bppt'])
        fireEvent.submit(view.container.querySelector('form'))
        expect(await screen.findByRole('alert')).toHaveTextContent('Surat terkendali belum dapat didisposisikan')
        expect(mocks.masuk.create).not.toHaveBeenCalled()
    })

    it('peringatan duplikat nomor memakai Lacak mode cek', async () => {
        await tampilDanIsi()
        vi.useFakeTimers()
        fireEvent.change(document.getElementById('nomor-surat'), { target: { value: 'B-12/2026' } })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        vi.useRealTimers()
        expect(await screen.findByText('Nomor sudah terdaftar / terkait RS-2026-000123')).toBeInTheDocument()
    })

    it('Nomor Referensi (surat kita) menyarankan disposisi ke pemilik surat rujukan', async () => {
        const view = await tampilDanIsi()
        fireEvent.click(screen.getByRole('combobox', { name: 'Nomor Referensi (surat kita)' }))
        vi.useFakeTimers()
        fireEvent.change(screen.getByPlaceholderText('Ketik minimal 3 karakter nomor atau perihal...'), { target: { value: 'B-5/2026' } })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        vi.useRealTimers()
        fireEvent.keyDown(screen.getByPlaceholderText('Ketik minimal 3 karakter nomor atau perihal...'), { key: 'Enter' })
        fireEvent.click(await screen.findByRole('button', { name: 'Disposisikan ke Dit. BPPT' }))
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.create).toHaveBeenCalled())
        const payload = mocks.masuk.create.mock.calls[0][0]
        expect(payload.referensi).toEqual({ jenis: 'surat_keluar', id: 'sk-1' })
        expect(payload.disposisi.targets).toEqual([{ unitKerjaId: 'dir_bppt', penanggungJawab: false }])
        expect(mocks.lacak).toHaveBeenCalledWith(expect.objectContaining({ mode: 'referensi', jenis: 'surat_keluar' }), expect.anything())
    })
})

// T24-3/T24-4 (amandemen pra-eksekusi): alasan koreksi wajib bila rangkaian ada dan identitas
// berubah; delete/edit selanjutnya digerbang aksiDiizinkan[] dari server (F5), bukan asumsi klien.
describe('edit mode: alasan koreksi dan gerbang aksiDiizinkan', () => {
    const recordDenganRangkaian = {
        id: 'sm-1', unitKerjaId: 'sesditjen', jenisSurat: 'Nota Dinas', sifatSurat: 'biasa',
        nomorSurat: 'B-1/2026', tanggalSurat: '2026-09-01', perihal: 'Perihal awal',
        dari: 'A', kepada: 'B', disposisi: ['Ditjen'], aksiDiizinkan: ['edit'],
        rangkaian: { id: 'r1', kode: 'RS-2026-000001', status: 'aktif' },
    }

    async function mountEdit(overrides = {}) {
        mocks.masuk.getById.mockResolvedValue({ ...recordDenganRangkaian, ...overrides })
        router = createMemoryRouter([
            { path: '/edit/:id', element: <TambahSuratMasuk /> },
            { path: '/surat/masuk/:id', element: <h1>Detail</h1> },
        ], { initialEntries: ['/edit/sm-1'] })
        const view = render(<RouterProvider router={router} />)
        await screen.findByDisplayValue('Perihal awal')
        return view
    }

    it('perubahan perihal pada surat dengan rangkaian meminta alasan koreksi dan mengirimkannya', async () => {
        const view = await mountEdit()
        fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Perihal baru' } })
        fireEvent.submit(view.container.querySelector('form'))
        expect(await screen.findByRole('alert')).toHaveTextContent('Alasan koreksi')
        expect(mocks.masuk.update).not.toHaveBeenCalled()
        fireEvent.change(screen.getByLabelText(/^Alasan koreksi/), { target: { value: 'Perbaikan redaksi perihal surat' } })
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.update).toHaveBeenCalled())
        expect(mocks.masuk.update.mock.calls[0][1]).toMatchObject({ alasan: 'Perbaikan redaksi perihal surat', perihal: 'Perihal baru' })
    })

    it('tidak meminta alasan koreksi bila tidak ada rangkaian', async () => {
        const view = await mountEdit({ rangkaian: null })
        fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Perihal baru tanpa rangkaian' } })
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.update).toHaveBeenCalled())
        expect(mocks.masuk.update.mock.calls[0][1]).not.toHaveProperty('alasan')
    })

    it('mengunci nomor/perihal/sifat bila rangkaian sudah diberkaskan', async () => {
        await mountEdit({ rangkaian: { id: 'r1', kode: 'RS-2026-000001', status: 'diberkaskan' } })
        expect(screen.getByText('Dikunci karena rangkaian sudah diberkaskan')).toBeInTheDocument()
        expect(screen.getByLabelText(/^Perihal/)).toBeDisabled()
        expect(document.getElementById('nomor-surat')).toBeDisabled()
    })

    it('mengalihkan ke halaman detail bila aksiDiizinkan tidak memuat edit', async () => {
        mocks.masuk.getById.mockResolvedValue({ ...recordDenganRangkaian, aksiDiizinkan: ['view'] })
        router = createMemoryRouter([
            { path: '/edit/:id', element: <TambahSuratMasuk /> },
            { path: '/surat/masuk/:id', element: <h1>Detail</h1> },
        ], { initialEntries: ['/edit/sm-1'] })
        render(<RouterProvider router={router} />)
        await waitFor(() => expect(router.state.location.pathname).toBe('/surat/masuk/sm-1'))
        expect(screen.getByText('Detail')).toBeInTheDocument()
    })
})
