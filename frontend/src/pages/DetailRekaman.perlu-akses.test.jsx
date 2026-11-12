import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

// Detail rekaman berkelas terkendali tanpa persetujuan akses: halaman
// menjelaskan keadaannya dan membawa rekaman itu ke formulir permohonan,
// bukan menampilkan "Tidak Ditemukan".
const mocks = vi.hoisted(() => ({
    suratMasuk: vi.fn(), suratKeluar: vi.fn(), arsip: vi.fn(), riwayatAturan: vi.fn(), toast: vi.fn(),
}))
vi.mock('@/components/surat/KoreksiBerkasSection', () => ({ default: () => null }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getById: mocks.suratMasuk } }))
vi.mock('@/services/surat-keluar.service', () => ({ default: { getById: mocks.suratKeluar } }))
vi.mock('@/services/arsip.service', () => ({ arsipService: { getById: mocks.arsip, getRuleHistory: mocks.riwayatAturan } }))
vi.mock('@/services/rangkaian.service', () => ({ default: { getBySurat: vi.fn().mockResolvedValue(null) } }))
vi.mock('@/services/approval.service', () => ({ default: { getHistory: vi.fn().mockResolvedValue([]), getEligibleApprovers: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ canWrite: () => true, user: { id: 'user-a', role: 'admin_unit', unitKerjaId: 'sesditjen' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/KlasifikasiPicker', () => ({ KlasifikasiPicker: () => null }))

import SuratMasukDetail from './SuratMasukDetail'
import SuratKeluarDetail from './SuratKeluarDetail'
import ArsipDetail from './ArsipDetail'

const ID = '30000000-0000-4000-8000-000000000002'

function galatPerluAkses(rekaman) {
    return Object.assign(new Error('Rekaman ini berkelas keamanan terkendali.'), {
        status: 403,
        data: { error: 'Rekaman ini berkelas keamanan terkendali.', code: 'ACCESS_APPROVAL_REQUIRED', rekaman },
    })
}
const galatTidakAda = () => Object.assign(new Error('Surat masuk not found'), { status: 404, data: { error: 'Surat masuk not found' } })

function TujuanPermohonan() {
    const location = useLocation()
    return <pre data-testid="state-permohonan">{JSON.stringify(location.state)}</pre>
}

function renderHalaman(path, pola, Halaman) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path={pola} element={<Halaman />} />
                <Route path="/record-access-grants" element={<TujuanPermohonan />} />
            </Routes>
        </MemoryRouter>,
    )
}

const KASUS = [
    {
        nama: 'surat masuk', jenis: 'surat_masuk', mock: () => mocks.suratMasuk, Halaman: SuratMasukDetail,
        path: `/surat/masuk/${ID}`, pola: '/surat/masuk/:id', sebutan: 'Surat', label: 'Surat Masuk', daftar: 'Kembali ke Daftar Surat',
        tidakAda: 'Surat Tidak Ditemukan',
    },
    {
        nama: 'surat keluar', jenis: 'surat_keluar', mock: () => mocks.suratKeluar, Halaman: SuratKeluarDetail,
        path: `/surat/keluar/${ID}`, pola: '/surat/keluar/:id', sebutan: 'Surat', label: 'Surat Keluar', daftar: 'Kembali ke Daftar Surat',
        tidakAda: 'Surat Tidak Ditemukan',
    },
    {
        nama: 'arsip', jenis: 'arsip', mock: () => mocks.arsip, Halaman: ArsipDetail,
        path: `/arsip/detail/${ID}`, pola: '/arsip/detail/:id', sebutan: 'Arsip', label: 'Arsip', daftar: 'Kembali ke Daftar Arsip',
        tidakAda: 'Arsip Tidak Ditemukan',
    },
]

beforeEach(() => {
    vi.clearAllMocks()
    mocks.riwayatAturan.mockRejectedValue(galatTidakAda())
})
afterEach(cleanup)

describe.each(KASUS)('detail $nama yang perlu persetujuan akses', (kasus) => {
    it('menjelaskan keadaannya dan membuka permohonan yang sudah terisi', async () => {
        kasus.mock().mockRejectedValue(galatPerluAkses({
            jenis: kasus.jenis, id: ID, nomor: 'SM-2/RHS/2026', perihal: 'Perihal terbatas', klasifikasi: 'terbatas',
        }))
        renderHalaman(kasus.path, kasus.pola, kasus.Halaman)

        expect(await screen.findByRole('heading', { name: 'Perlu persetujuan akses' })).toBeInTheDocument()
        expect(screen.getByText(
            `${kasus.sebutan} ini berkelas keamanan Terbatas. Datanya tetap tersimpan dan tidak dihapus, tetapi isinya baru dapat dibuka setelah permohonan akses Anda disetujui Super Admin.`,
        )).toBeInTheDocument()
        expect(screen.getByText(kasus.label)).toBeInTheDocument()
        expect(screen.getByText('SM-2/RHS/2026')).toBeInTheDocument()
        expect(screen.getByText('Perihal terbatas')).toBeInTheDocument()
        expect(screen.getByText('Sudah mengajukan? Status permohonan dapat dipantau di menu Persetujuan Akses Arsip.')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: kasus.daftar })).toBeInTheDocument()
        expect(screen.queryByText(kasus.tidakAda)).not.toBeInTheDocument()
        expect(screen.queryByText(ID)).not.toBeInTheDocument()
        expect(mocks.toast).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Minta Akses' }))
        expect(JSON.parse((await screen.findByTestId('state-permohonan')).textContent)).toEqual({
            mintaAkses: { entityType: kasus.jenis, entityId: ID, nomor: 'SM-2/RHS/2026', perihal: 'Perihal terbatas' },
        })
    })

    it('tetap menampilkan "tidak ditemukan" untuk penolakan lain', async () => {
        kasus.mock().mockRejectedValue(galatTidakAda())
        renderHalaman(kasus.path, kasus.pola, kasus.Halaman)

        expect(await screen.findByText(kasus.tidakAda)).toBeInTheDocument()
        expect(screen.queryByText('Perlu persetujuan akses')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Minta Akses' })).not.toBeInTheDocument()
    })
})

it('403 lain tanpa kode persetujuan tidak dianggap perlu persetujuan akses', async () => {
    mocks.suratMasuk.mockRejectedValue(Object.assign(new Error('Anda tidak memiliki izin.'), { status: 403, data: { error: 'Anda tidak memiliki izin.' } }))
    renderHalaman(`/surat/masuk/${ID}`, '/surat/masuk/:id', SuratMasukDetail)

    expect(await screen.findByText('Surat Tidak Ditemukan')).toBeInTheDocument()
    expect(screen.queryByText('Perlu persetujuan akses')).not.toBeInTheDocument()
})
