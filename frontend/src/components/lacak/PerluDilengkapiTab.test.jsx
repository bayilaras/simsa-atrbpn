import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
    perluDilengkapi: vi.fn(), ringkasanPerluDilengkapi: vi.fn(), tandaiInisiatif: vi.fn(),
    toast: vi.fn(), distribute: vi.fn(), berkaskan: vi.fn(), tautkan: vi.fn(),
}))
vi.mock('@/services/rangkaian.service', () => {
    const service = {
        perluDilengkapi: mocks.perluDilengkapi, ringkasanPerluDilengkapi: mocks.ringkasanPerluDilengkapi, tandaiInisiatif: mocks.tandaiInisiatif,
    }
    return { default: service, rangkaianService: service }
})
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/DistributeDialog', () => ({
    DistributeDialog: (props) => { mocks.distribute(props); return <div role="dialog" aria-label="Disposisi">{props.suratData.nomorSurat}</div> },
}))
vi.mock('@/components/surat/BerkaskanDialog', () => ({
    BerkaskanDialog: (props) => { mocks.berkaskan(props); return <div role="dialog" aria-label="Berkaskan">{props.rangkaian.kode}</div> },
}))
vi.mock('@/components/surat/AlurSuratActions', () => ({
    TautkanDialog: (props) => { mocks.tautkan(props); return <div role="dialog" aria-label="Tautkan">{props.surat.nomorSurat}</div> },
}))
import { PerluDilengkapiTab } from './PerluDilengkapiTab'
import { PERLU_DILENGKAPI_EVENT } from '@/lib/perlu-dilengkapi'

const SM1 = '11111111-1111-4111-8111-111111111111'
const SK10 = '22222222-2222-4222-8222-222222222222'
const R6 = '33333333-3333-4333-8333-333333333333'
const D2 = '44444444-4444-4444-8444-444444444444'
const itemTersamar = {
    kunci: `disposisi_terbuka:${D2}`, kategori: 'disposisi_terbuka', masked: true, label: 'Dikecualikan', jenis: 'surat_masuk',
    unitNama: 'Sesditjen', surat: null, rangkaian: null,
    disposisi: { id: D2, status: 'sent', targetUnitNama: 'Dit. BPPT', batasWaktu: '2026-01-10', lewatBatas: true },
    dataLama: false, aksiDiizinkan: ['buka_kotak_disposisi'],
}
const itemSm = {
    kunci: `sm_belum_ditindaklanjuti:${SM1}`, kategori: 'sm_belum_ditindaklanjuti', masked: false, jenis: 'surat_masuk', unitNama: 'Sesditjen',
    surat: {
        jenis: 'surat_masuk', id: SM1, nomorSurat: 'SM-1/2026', perihal: 'Undangan rapat satu', tanggalSurat: '2026-09-01',
        naskahDinas: null, dari: 'Kanwil Jawa Barat', kepada: null, sifatSurat: 'Biasa', unitKerjaId: 'sesditjen', approvalStatus: null,
    },
    rangkaian: null, disposisi: null, dataLama: false, aksiDiizinkan: ['buka_surat', 'disposisi', 'tindak_lanjut'],
}
const itemSkTanpaAsal = {
    kunci: `sk_tanpa_asal:${SK10}`, kategori: 'sk_tanpa_asal', masked: false, jenis: 'surat_keluar', unitNama: 'Dit. BPPT',
    surat: {
        jenis: 'surat_keluar', id: SK10, nomorSurat: 'ND-10/2026', perihal: 'Undangan koordinasi sepuluh', tanggalSurat: '2026-09-10',
        naskahDinas: 'Nota Dinas', dari: null, kepada: 'Para Direktur', sifatSurat: 'biasa', unitKerjaId: 'dir_bppt', approvalStatus: 'approved',
    },
    rangkaian: null, disposisi: null, dataLama: false, aksiDiizinkan: ['buka_surat', 'tandai_inisiatif', 'tautkan'],
}
const itemSiap = {
    kunci: `siap_diberkaskan:${R6}`, kategori: 'siap_diberkaskan', masked: false, jenis: 'rangkaian', unitNama: 'Sesditjen', surat: null,
    rangkaian: {
        id: R6, kode: 'RS-2026-000006', status: 'selesai', judul: 'Permohonan data enam',
        unitPencatatId: 'sesditjen', unitPengolahId: 'dir_bppt', unitPengolahNama: 'Dit. BPPT', dapatDibuka: true,
    },
    disposisi: null, dataLama: false, aksiDiizinkan: ['berkaskan'],
}
const RINGKASAN = {
    perKategori: { sm_belum_ditindaklanjuti: 1, disposisi_terbuka: 1, sk_tanpa_nd_penjelas: 0, tindak_lanjut_tertahan: 0, siap_diberkaskan: 1, sk_tanpa_asal: 1 },
    total: 4, lewatBatas: 1, batasDataLama: '2025-12-31T17:00:00.000Z',
}
const respons = (rows) => ({
    success: true, data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 },
    meta: { batasDataLama: RINGKASAN.batasDataLama, tampilkanDataLama: false },
})

function Lokasi() {
    const { state } = useLocation()
    return <p>{`${state?.tindakLanjut?.suratId}|${state?.tindakLanjut?.jenisRelasi}`}</p>
}
let router
function mount() {
    router = createMemoryRouter([
        { path: '/surat/lacak', element: <PerluDilengkapiTab /> },
        { path: '/surat/keluar/tambah', element: <Lokasi /> },
    ], { initialEntries: ['/surat/lacak?tab=perlu-dilengkapi'] })
    render(<RouterProvider router={router} />)
}
const baris = async () => within(await screen.findByRole('list', { name: 'Daftar perlu dilengkapi' })).findAllByRole('listitem')

beforeEach(() => {
    vi.clearAllMocks()
    mocks.perluDilengkapi.mockResolvedValue(respons([itemTersamar, itemSm, itemSkTanpaAsal, itemSiap]))
    mocks.ringkasanPerluDilengkapi.mockResolvedValue(RINGKASAN)
    mocks.tandaiInisiatif.mockResolvedValue({ id: SK10, asalNaskah: 'inisiatif' })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals() })

describe('Tab Perlu Dilengkapi (D7)', () => {
    it('memuat ringkasan dan daftar tanpa data lama, lalu mengumumkan total untuk badge sidebar', async () => {
        const diumumkan = vi.fn()
        window.addEventListener(PERLU_DILENGKAPI_EVENT, diumumkan)
        mount()
        await baris()
        expect(mocks.perluDilengkapi).toHaveBeenCalledWith({ kategori: undefined, tampilkanDataLama: false, page: 1, limit: 20 })
        expect(mocks.ringkasanPerluDilengkapi).toHaveBeenCalledWith({ tampilkanDataLama: false })
        expect(await screen.findByRole('button', { name: 'Semua (4)' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'Surat masuk belum ditindaklanjuti (1)' })).toHaveAttribute('aria-pressed', 'false')
        await waitFor(() => expect(diumumkan).toHaveBeenCalledTimes(1))
        expect(diumumkan.mock.calls[0][0].detail).toEqual({ total: 4 })
        window.removeEventListener(PERLU_DILENGKAPI_EVENT, diumumkan)
    })

    it('aksi hanya dari aksiDiizinkan; baris tersamar tanpa nomor, perihal, atau tautan surat', async () => {
        mount()
        const [tersamar, sm, skTanpaAsal, siap] = await baris()
        expect(within(tersamar).getByText('Dikecualikan')).toBeVisible()
        expect(within(tersamar).getByText('Lewat batas waktu')).toBeVisible()
        expect(within(tersamar).getByRole('link', { name: 'Buka Kotak Disposisi' })).toHaveAttribute('href', '/distribusi')
        expect(within(tersamar).queryByRole('link', { name: 'Buka surat' })).toBeNull()
        expect(within(tersamar).queryAllByRole('button')).toHaveLength(0)

        expect(within(sm).getByText('SM-1/2026 — Undangan rapat satu')).toBeVisible()
        expect(within(sm).getByRole('button', { name: 'Tindak Lanjut' })).toBeVisible()
        expect(within(sm).getByRole('button', { name: 'Disposisi' })).toBeVisible()
        expect(within(sm).getByRole('link', { name: 'Buka surat' })).toHaveAttribute('href', `/surat/masuk/${SM1}`)
        expect(within(sm).queryByRole('button', { name: 'Tandai Inisiatif' })).toBeNull()

        expect(within(skTanpaAsal).getByRole('button', { name: 'Tandai Inisiatif' })).toBeVisible()
        expect(within(skTanpaAsal).getByRole('button', { name: 'Tautkan' })).toBeVisible()
        expect(within(skTanpaAsal).getByRole('link', { name: 'Buka surat' })).toHaveAttribute('href', `/surat/keluar/${SK10}`)

        expect(within(siap).getByText('Permohonan data enam')).toBeVisible()
        expect(within(siap).getByRole('link', { name: 'RS-2026-000006' })).toHaveAttribute('href', `/surat/lacak?rangkaian=${R6}`)
        expect(within(siap).getByRole('button', { name: 'Berkaskan ke Direktorat' })).toBeVisible()
        expect(within(siap).queryByRole('link', { name: 'Buka surat' })).toBeNull()
    })

    it('Tindak Lanjut membuka form surat keluar dengan Nomor Referensi terkunci', async () => {
        mount()
        const [, sm] = await baris()
        fireEvent.click(within(sm).getByRole('button', { name: 'Tindak Lanjut' }))
        expect(await screen.findByText(`${SM1}|balasan`)).toBeVisible()
    })

    it('Berkaskan, Tautkan, dan Disposisi membuka dialog P3 dengan data baris, lalu memuat ulang setelah berhasil', async () => {
        mount()
        const [, sm, skTanpaAsal, siap] = await baris()
        await waitFor(() => expect(mocks.ringkasanPerluDilengkapi).toHaveBeenCalledTimes(1))

        fireEvent.click(within(siap).getByRole('button', { name: 'Berkaskan ke Direktorat' }))
        expect(screen.getByRole('dialog', { name: 'Berkaskan' })).toHaveTextContent('RS-2026-000006')
        expect(mocks.berkaskan).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, rangkaian: { id: R6, kode: 'RS-2026-000006' } }))
        act(() => { mocks.berkaskan.mock.lastCall[0].onOpenChange(false) })
        expect(screen.queryByRole('dialog', { name: 'Berkaskan' })).toBeNull()

        fireEvent.click(within(skTanpaAsal).getByRole('button', { name: 'Tautkan' }))
        expect(mocks.tautkan).toHaveBeenLastCalledWith(expect.objectContaining({
            open: true, jenis: 'surat_keluar', surat: { id: SK10, nomorSurat: 'ND-10/2026', perihal: 'Undangan koordinasi sepuluh' },
        }))
        act(() => { mocks.tautkan.mock.lastCall[0].onOpenChange(false) })
        expect(screen.queryByRole('dialog', { name: 'Tautkan' })).toBeNull()

        fireEvent.click(within(sm).getByRole('button', { name: 'Disposisi' }))
        expect(screen.getByRole('dialog', { name: 'Disposisi' })).toHaveTextContent('SM-1/2026')
        expect(mocks.distribute).toHaveBeenLastCalledWith(expect.objectContaining({
            open: true, sourceUnitId: 'sesditjen',
            suratData: { id: SM1, nomorSurat: 'SM-1/2026', perihal: 'Undangan rapat satu', sifatSurat: 'Biasa' },
        }))
        await act(async () => { mocks.distribute.mock.lastCall[0].onSuccess() })
        expect(screen.queryByRole('dialog', { name: 'Disposisi' })).toBeNull()
        // DistributeDialog P3 sudah menampilkan toast sendiri; tab tidak menambah toast kedua [P4-T20-1].
        expect(mocks.toast).not.toHaveBeenCalled()
        await waitFor(() => expect(mocks.perluDilengkapi).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(mocks.ringkasanPerluDilengkapi).toHaveBeenCalledTimes(2))
    })

    it('Tandai Inisiatif meminta konfirmasi, menampilkan galat server, lalu memuat ulang setelah berhasil', async () => {
        mocks.tandaiInisiatif.mockRejectedValueOnce(new Error('Asal naskah surat ini sudah ditetapkan.'))
        mount()
        const [, , skTanpaAsal] = await baris()
        fireEvent.click(within(skTanpaAsal).getByRole('button', { name: 'Tandai Inisiatif' }))
        const dialog = await screen.findByRole('dialog', { name: 'Tandai sebagai Surat Inisiatif?' })
        expect(dialog).toHaveTextContent('ND-10/2026')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Ya, tandai inisiatif' }))
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Asal naskah surat ini sudah ditetapkan.')
        expect(mocks.perluDilengkapi).toHaveBeenCalledTimes(1)

        fireEvent.click(within(dialog).getByRole('button', { name: 'Ya, tandai inisiatif' }))
        await waitFor(() => expect(mocks.tandaiInisiatif).toHaveBeenCalledTimes(2))
        expect(mocks.tandaiInisiatif).toHaveBeenLastCalledWith(SK10)
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tandai sebagai Surat Inisiatif?' })).toBeNull())
        expect(mocks.toast).toHaveBeenCalledWith({ title: 'Surat ditandai sebagai Surat Inisiatif' })
        await waitFor(() => expect(mocks.perluDilengkapi).toHaveBeenCalledTimes(2))
    })

    it('Tampilkan data lama meminta server secara eksplisit tanpa mengubah badge sidebar', async () => {
        const diumumkan = vi.fn()
        window.addEventListener(PERLU_DILENGKAPI_EVENT, diumumkan)
        mount()
        await baris()
        await waitFor(() => expect(diumumkan).toHaveBeenCalledTimes(1))
        fireEvent.click(screen.getByLabelText('Tampilkan data lama'))
        await waitFor(() => expect(mocks.perluDilengkapi).toHaveBeenLastCalledWith({ kategori: undefined, tampilkanDataLama: true, page: 1, limit: 20 }))
        await waitFor(() => expect(mocks.ringkasanPerluDilengkapi).toHaveBeenLastCalledWith({ tampilkanDataLama: true }))
        await act(async () => { await Promise.resolve() })
        expect(diumumkan).toHaveBeenCalledTimes(1)
        window.removeEventListener(PERLU_DILENGKAPI_EVENT, diumumkan)
    })

    it('filter kategori dikirim ke server', async () => {
        mount()
        await baris()
        fireEvent.click(await screen.findByRole('button', { name: 'Siap diberkaskan (1)' }))
        await waitFor(() => expect(mocks.perluDilengkapi).toHaveBeenLastCalledWith({ kategori: 'siap_diberkaskan', tampilkanDataLama: false, page: 1, limit: 20 }))
        expect(screen.getByRole('button', { name: 'Siap diberkaskan (1)' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('FE-I1: kode rangkaian hanya ditautkan bila dapatDibuka (FR:35); selain itu teks biasa', async () => {
        const R2 = '55555555-5555-4555-8555-555555555555'
        const rangkaianTertutup = { id: R2, kode: 'RS-2026-000002', status: 'aktif', judul: null, unitPencatatId: 'sesditjen', unitPengolahId: null, unitPengolahNama: null }
        mocks.perluDilengkapi.mockResolvedValue(respons([
            { ...itemSm, rangkaian: { ...rangkaianTertutup, dapatDibuka: false } },
            { ...itemSkTanpaAsal, rangkaian: rangkaianTertutup },
            itemSiap,
        ]))
        mount()
        const [sm, sk, siap] = await baris()
        expect(within(sm).getByText('RS-2026-000002')).toBeVisible()
        expect(within(sm).queryByRole('link', { name: 'RS-2026-000002' })).toBeNull()
        expect(within(sm).getByText('RS-2026-000002')).toHaveAttribute('title', 'Rangkaian ini tidak dapat Anda buka')
        // Tanpa flag (kontrak lama): fail closed, tidak ditautkan.
        expect(within(sk).queryByRole('link', { name: 'RS-2026-000002' })).toBeNull()
        expect(within(siap).getByRole('link', { name: 'RS-2026-000006' })).toHaveAttribute('href', `/surat/lacak?rangkaian=${R6}`)
    })
})
