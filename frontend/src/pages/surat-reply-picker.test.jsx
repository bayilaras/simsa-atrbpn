import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratKeluar from '@/pages/TambahSuratKeluar'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'review-user', role: 'admin_dirjen', unitKerjaId: 'ditjen' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
vi.mock('@/services/api', () => ({ default: { get: mocks.get }, api: { get: mocks.get } }))

const node = { anggotaId: null, jenis: 'surat_masuk', id: 'letter-101', nomorSurat: 'SM-101', perihal: 'UNIQUE-OLDER-LETTER',
    tanggalSurat: '2026-01-02', tahun: 2026, naskah: null, unitKerjaId: 'ditjen', unitNama: 'Ditjen', relasi: null, masked: false }
const kelompok101 = { kunci: 'surat:letter-101', skor: 90, tanggalTerbaru: '2026-01-02', rangkaian: null,
    cocok: [{ jenis: 'surat_masuk', id: 'letter-101', nomorSurat: 'SM-101', perihal: 'UNIQUE-OLDER-LETTER', tahun: 2026, skor: 90 }],
    pratinjau: [node], jumlahAnggota: 1, pratinjauTerpotong: false }
let router
beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.get.mockImplementation(async (url, params) => {
        if (url === '/api/surat-keluar/existing') return { data: { id: 'existing', unitKerjaId: 'ditjen', approvalStatus: 'draft', balasanUntuk: 'letter-101',
            naskahDinas: 'Nota Dinas', perihal: 'Balasan tersimpan', tanggalSurat: '2026-09-12' } }
        if (url === '/api/surat-masuk/letter-101') return { data: { id: 'letter-101', nomorSurat: 'SM-101', perihal: 'UNIQUE-OLDER-LETTER', status: 'sudah_dibalas' } }
        if (url === '/api/rangkaian/lacak') return { success: true, data: { q: params.q, mode: params.mode, jenisKueri: 'nomor',
            kelompok: params.q.includes('101') ? [kelompok101] : [] } }
        if (url === '/api/surat-keluar/next-number') return { data: { nomorSurat: '001/ND/09/2026' } }
        throw new Error(`Unexpected request ${url}`)
    })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

it('mencari lewat Lacak mode referensi (termasuk surat yang sudah dibalas) lalu memilih dengan keyboard', async () => {
    router = createMemoryRouter([{ path: '/', element: <TambahSuratKeluar /> }])
    render(<RouterProvider router={router} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Nomor Referensi' }))
    vi.useFakeTimers()
    fireEvent.change(screen.getByPlaceholderText('Ketik minimal 3 karakter nomor atau perihal...'), { target: { value: 'SM-101' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    vi.useRealTimers()
    await screen.findByText('SM-101')
    expect(mocks.get).toHaveBeenCalledWith('/api/rangkaian/lacak', { q: 'SM-101', mode: 'referensi', tahun: undefined, jenis: undefined, limit: 8 }, { signal: expect.any(AbortSignal) })
    fireEvent.keyDown(screen.getByPlaceholderText('Ketik minimal 3 karakter nomor atau perihal...'), { key: 'Enter' })
    await screen.findByRole('button', { name: 'Hapus surat rujukan yang dipilih' })
    expect(screen.getByText('SM-101')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Jenis relasi' })).toHaveValue('balasan')
})

it('kurang dari 3 karakter tidak memanggil server', async () => {
    router = createMemoryRouter([{ path: '/', element: <TambahSuratKeluar /> }])
    render(<RouterProvider router={router} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Nomor Referensi' }))
    vi.useFakeTimers()
    fireEvent.change(screen.getByPlaceholderText('Ketik minimal 3 karakter nomor atau perihal...'), { target: { value: 'SM' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    vi.useRealTimers()
    expect(mocks.get.mock.calls.some(([url]) => url === '/api/rangkaian/lacak')).toBe(false)
})

it('mode edit menampilkan rujukan tersimpan terkunci tanpa memanggil Lacak', async () => {
    router = createMemoryRouter([{ path: '/edit/:id', element: <TambahSuratKeluar /> }], { initialEntries: ['/edit/existing'] })
    render(<RouterProvider router={router} />)
    await screen.findByText('SM-101')
    expect(screen.getByLabelText('Nomor Referensi terkunci')).toBeInTheDocument()
    expect(mocks.get.mock.calls.some(([url]) => url === '/api/rangkaian/lacak')).toBe(false)
})

it("menampilkan Coba lagi saat pencarian gagal dan tidak menampilkan 'Tidak ada surat yang cocok'", async () => {
    mocks.get.mockImplementationOnce(async (url) => {
        if (url === '/api/rangkaian/lacak') throw new Error('Pencarian belum tersedia')
        throw new Error(`Unexpected request ${url}`)
    })
    router = createMemoryRouter([{ path: '/', element: <TambahSuratKeluar /> }])
    render(<RouterProvider router={router} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Nomor Referensi' }))
    vi.useFakeTimers()
    fireEvent.change(screen.getByPlaceholderText('Ketik minimal 3 karakter nomor atau perihal...'), { target: { value: 'SM-101' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    vi.useRealTimers()
    expect(await screen.findByRole('alert')).toHaveTextContent('Pencarian belum tersedia')
    expect(screen.queryByText('Tidak ada surat yang cocok')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    vi.useFakeTimers()
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    vi.useRealTimers()
    await screen.findByText('SM-101')
})
