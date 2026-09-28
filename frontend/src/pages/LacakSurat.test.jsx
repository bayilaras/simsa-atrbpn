import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ lacak: vi.fn(), panelDipasang: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => ({ default: { lacak: mocks.lacak }, rangkaianService: { lacak: mocks.lacak } }))
vi.mock('@/components/surat/AlurSuratPanel', async () => {
    const { useEffect } = await import('react')
    const Panel = ({ rangkaianId }) => {
        useEffect(() => { mocks.panelDipasang(rangkaianId) }, [rangkaianId])
        return <section aria-label="Panel Alur Surat">{rangkaianId}</section>
    }
    return { default: Panel, AlurSuratPanel: Panel }
})
vi.mock('@/components/lacak/BerkasRangkaianTab', () => ({ BerkasRangkaianTab: () => <p>Isi tab berkas</p> }))
import LacakSurat from './LacakSurat'

const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'
const kartu = (id, kode) => ({
    kunci: id, skor: 100, tanggalTerbaru: '2025-01-20',
    rangkaian: { id, kode, status: 'aktif', judul: `Judul ${kode}`, tahun: 2025, asal: 'inisiatif' },
    cocok: [], pratinjau: [], jumlahAnggota: 1, pratinjauTerpotong: false,
})
const hasil = (q, kelompok) => ({ q, mode: 'lacak', jenisKueri: 'nomor', kelompok })
function deferred() { let resolve; const promise = new Promise(res => { resolve = res }); return { promise, resolve } }

let router
function mount(url = '/surat/lacak') {
    router = createMemoryRouter([
        { path: '/surat/lacak', element: <LacakSurat /> },
        { path: '/surat/:jenis/:id', element: <p>Detail</p> },
    ], { initialEntries: [url] })
    render(<RouterProvider router={router} />)
}
const input = () => screen.getByRole('searchbox', { name: 'Nomor surat atau perihal' })
const ketik = value => fireEvent.change(input(), { target: { value } })
const maju = async ms => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const panel = () => screen.queryByRole('region', { name: 'Panel Alur Surat' })

beforeEach(() => {
    vi.useFakeTimers()
    mocks.lacak.mockReset()
    mocks.panelDipasang.mockReset()
    mocks.lacak.mockImplementation(async ({ q }) => hasil(q, [kartu(R1, 'RS-2025-000001'), kartu(R2, 'RS-2024-000002')]))
})
afterEach(() => { cleanup(); router?.dispose(); vi.useRealTimers() })

describe('Halaman Lacak Surat', () => {
    it('menunda pencarian 300 ms, menyinkronkan ?q= dengan replace, dan mengirim satu permintaan', async () => {
        mount()
        ketik('B-1')
        ketik('B-12')
        ketik('B-12/PTPP')
        expect(router.state.location.search).toBe('?q=B-12%2FPTPP')
        expect(router.state.historyAction).toBe('REPLACE')
        await maju(299)
        expect(mocks.lacak).not.toHaveBeenCalled()
        await maju(1)
        expect(mocks.lacak).toHaveBeenCalledTimes(1)
        expect(mocks.lacak.mock.calls[0][0]).toEqual({ q: 'B-12/PTPP', mode: 'lacak', tahun: undefined })
        expect(screen.getByRole('heading', { name: 'Judul RS-2025-000001' })).toBeVisible()
        expect(panel()).toBeNull()
    })

    it('membatalkan permintaan sebelumnya ketika kueri berubah dan mengabaikan hasil basi', async () => {
        const lama = deferred()
        mocks.lacak.mockImplementationOnce(() => lama.promise)
            .mockImplementation(async ({ q }) => hasil(q, [kartu(R2, 'RS-2024-000002')]))
        mount()
        ketik('rapat')
        await maju(300)
        const sinyalLama = mocks.lacak.mock.calls[0][1].signal
        ketik('rapat koordinasi')
        expect(sinyalLama.aborted).toBe(true)
        await maju(300)
        await act(async () => { lama.resolve(hasil('rapat', [kartu(R1, 'RS-2025-000001')])) })
        expect(screen.queryByText('RS-2025-000001')).toBeNull()
        expect(screen.getByText('RS-2024-000002')).toBeVisible()
    })

    it('membuka langsung bila hanya satu kelompok tanpa menulis URL; menutupnya tidak membuka ulang', async () => {
        mocks.lacak.mockResolvedValue(hasil('SK-01', [kartu(R1, 'RS-2025-000001')]))
        mount('/surat/lacak?q=SK-01')
        expect(input()).toHaveValue('SK-01')
        await maju(300)
        expect(panel()).toHaveTextContent(R1)
        expect(router.state.location.search).toBe('?q=SK-01')
        fireEvent.click(screen.getByRole('button', { name: 'Tutup rangkaian' }))
        expect(panel()).toBeNull()
        expect(screen.getByRole('button', { name: 'Buka rangkaian' })).toHaveAttribute('aria-expanded', 'false')
    })

    it('tautan ?rangkaian= membuka kartu itu; tombol Buka/Tutup memperbarui URL', async () => {
        mount(`/surat/lacak?q=rapat&rangkaian=${R2}`)
        await maju(300)
        expect(panel()).toHaveTextContent(R2)
        fireEvent.click(screen.getByRole('button', { name: 'Buka rangkaian' }))
        expect(new URLSearchParams(router.state.location.search).get('rangkaian')).toBe(R1)
        expect(panel()).toHaveTextContent(R1)
        fireEvent.click(screen.getByRole('button', { name: 'Tutup rangkaian' }))
        expect(new URLSearchParams(router.state.location.search).get('rangkaian')).toBeNull()
        expect(panel()).toBeNull()
    })

    it('Buka rangkaian pada kartu ke-N memasang panel di dalam <li> kartu itu (ekspansi di tempat)', async () => {
        mount('/surat/lacak?q=rapat')
        await maju(300)
        const daftar = screen.getByRole('list', { name: 'Hasil lacak surat' })
        const kartuKedua = screen.getByRole('heading', { name: 'Judul RS-2024-000002' }).closest('li')
        fireEvent.click(within(kartuKedua).getByRole('button', { name: 'Buka rangkaian' }))
        expect(new URLSearchParams(router.state.location.search).get('rangkaian')).toBe(R2)
        const item = screen.getByRole('heading', { name: 'Judul RS-2024-000002' }).closest('li')
        expect(item.parentElement).toBe(daftar)
        expect(Array.from(daftar.children).indexOf(item)).toBe(1)
        expect(within(item).getByRole('region', { name: 'Panel Alur Surat' })).toHaveTextContent(R2)
        expect(screen.getAllByRole('region', { name: 'Panel Alur Surat' })).toHaveLength(1)
        expect(screen.queryByText('Rangkaian terpilih')).toBeNull()
        expect(screen.queryByText(/ditampilkan pada bagian Rangkaian terpilih/)).toBeNull()
    })

    it('panel ?rangkaian= pindah dari kepala ke <li> kartunya (bukan kartu pertama) tanpa dipasang ulang', async () => {
        const hasilTertunda = deferred()
        mocks.lacak.mockImplementationOnce(() => hasilTertunda.promise)
        mount(`/surat/lacak?q=rapat&rangkaian=${R2}`)
        expect(screen.getByText('Rangkaian terpilih')).toBeVisible()
        expect(panel()).toHaveTextContent(R2)
        await maju(300)
        await act(async () => { hasilTertunda.resolve(hasil('rapat', [kartu(R1, 'RS-2025-000001'), kartu(R2, 'RS-2024-000002')])) })
        const daftar = screen.getByRole('list', { name: 'Hasil lacak surat' })
        const item = screen.getByRole('heading', { name: 'Judul RS-2024-000002' }).closest('li')
        expect(Array.from(daftar.children).indexOf(item)).toBe(1)
        expect(within(item).getByRole('region', { name: 'Panel Alur Surat' })).toHaveTextContent(R2)
        expect(screen.queryByText('Rangkaian terpilih')).toBeNull()
        expect(mocks.panelDipasang).toHaveBeenCalledTimes(1)
    })

    it('?rangkaian= yang tidak ada di hasil tampil paling atas, hasil lain tetap tampil', async () => {
        const R3 = '33333333-3333-4333-8333-333333333333'
        mount(`/surat/lacak?q=rapat&rangkaian=${R3}`)
        await maju(300)
        const daftar = screen.getByRole('list', { name: 'Hasil lacak surat' })
        expect(daftar.children).toHaveLength(3)
        expect(within(daftar.children[0]).getByText('Rangkaian terpilih')).toBeVisible()
        expect(within(daftar.children[0]).getByRole('region', { name: 'Panel Alur Surat' })).toHaveTextContent(R3)
        expect(screen.getByRole('heading', { name: 'Judul RS-2025-000001' })).toBeVisible()
        expect(screen.getByRole('heading', { name: 'Judul RS-2024-000002' })).toBeVisible()
    })

    it('tautan ?rangkaian= tanpa kueri tetap menampilkan panelnya', async () => {
        mount(`/surat/lacak?rangkaian=${R1}`)
        expect(panel()).toHaveTextContent(R1)
        await maju(1000)
        expect(mocks.lacak).not.toHaveBeenCalled()
    })

    it('panel dari ?rangkaian= tetap terpasang (sekali) selama kueri baru dimuat, tanpa kartu basi', async () => {
        const kedua = deferred()
        mocks.lacak
            .mockImplementationOnce(async ({ q }) => hasil(q, [kartu(R1, 'RS-2025-000001')]))
            .mockImplementationOnce(async ({ q }) => hasil(q, [kartu(R1, 'RS-2025-000001')]))
            .mockImplementationOnce(() => kedua.promise)
        mount(`/surat/lacak?q=rapat&rangkaian=${R1}`)
        await maju(300)
        expect(screen.getAllByRole('region', { name: 'Panel Alur Surat' })).toHaveLength(1)
        ketik('rapat koor')
        await maju(300)
        ketik('rapat koordinasi')
        await maju(300)
        expect(mocks.lacak).toHaveBeenCalledTimes(3)
        // Saat kueri ketiga masih dimuat: tidak ada kartu lama yang bisa diklik, panel tetap ada.
        expect(screen.queryByRole('heading', { name: 'Judul RS-2025-000001' })).toBeNull()
        expect(panel()).toHaveTextContent(R1)
        await act(async () => { kedua.resolve(hasil('rapat koordinasi', [kartu(R1, 'RS-2025-000001')])) })
        expect(screen.getByRole('heading', { name: 'Judul RS-2025-000001' })).toBeVisible()
        expect(screen.getAllByRole('region', { name: 'Panel Alur Surat' })).toHaveLength(1)
        expect(mocks.panelDipasang).toHaveBeenCalledTimes(1)
        expect(new URLSearchParams(router.state.location.search).get('rangkaian')).toBe(R1)
    })

    it('tombol Tutup panel rangkaian menghapus ?rangkaian= walau kartunya tidak ada di hasil', async () => {
        mocks.lacak.mockImplementation(async ({ q }) => hasil(q, []))
        mount(`/surat/lacak?q=rapat&rangkaian=${R2}`)
        await maju(300)
        expect(panel()).toHaveTextContent(R2)
        fireEvent.click(screen.getByRole('button', { name: 'Tutup panel rangkaian' }))
        expect(new URLSearchParams(router.state.location.search).get('rangkaian')).toBeNull()
        expect(panel()).toBeNull()
    })

    it('mengikuti navigasi luar (Back/GlobalSearch) yang mengganti ?q=', async () => {
        mocks.lacak.mockImplementation(async ({ q }) => hasil(q, []))
        mount('/surat/lacak?q=rapat')
        await maju(300)
        await act(async () => { await router.navigate('/surat/lacak?q=PTPP.1') })
        expect(input()).toHaveValue('PTPP.1')
        await maju(300)
        expect(mocks.lacak).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'PTPP.1' }), expect.anything())
        expect(screen.getByText('Tidak ada surat yang cocok dengan “PTPP.1” dalam jangkauan Anda.')).toBeVisible()
    })

    it('menampilkan petunjuk minimal 3 karakter, galat, dan Coba lagi', async () => {
        mocks.lacak.mockRejectedValueOnce(new Error('Terlalu banyak permintaan. Coba lagi nanti.'))
        mount()
        ketik('ab')
        expect(screen.getByText(/Ketik minimal 3 karakter/)).toBeVisible()
        await maju(1000)
        expect(mocks.lacak).not.toHaveBeenCalled()
        ketik('rapat')
        await maju(300)
        expect(screen.getByRole('alert')).toHaveTextContent('Terlalu banyak permintaan. Coba lagi nanti.')
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        await maju(300)
        expect(screen.getByRole('heading', { name: 'Judul RS-2025-000001' })).toBeVisible()
    })

    it('tab Berkas Rangkaian lewat ?tab=berkas', () => {
        mount('/surat/lacak?tab=berkas')
        expect(screen.getByText('Isi tab berkas')).toBeVisible()
        expect(screen.getByRole('tab', { name: 'Berkas Rangkaian' })).toHaveAttribute('aria-selected', 'true')
    })
})
