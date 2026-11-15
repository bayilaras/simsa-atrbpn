import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratKeluar from '@/pages/TambahSuratKeluar'

// Peringatan nomor surat keluar yang sudah tercatat (Lacak mode cek), seperti
// pada formulir surat masuk; tidak menghalangi penyimpanan.

const mocks = vi.hoisted(() => ({
    keluar: { create: vi.fn(), getNextNumber: vi.fn(), getById: vi.fn(), update: vi.fn() },
    lacak: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-bppt', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: mocks.keluar }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: { getById: vi.fn() } }))
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

const tersimpan = {
    id: 'sk-1', unitKerjaId: 'dir_bppt', approvalStatus: 'draft', naskahDinas: 'Nota Dinas', sifatSurat: 'biasa',
    nomorSurat: 'ND-4/2026', tanggalSurat: '2026-01-03', perihal: 'Surat lama', kepada: 'Direktur',
    klasifikasiKeamanan: 'biasa', aksiDiizinkan: ['edit'],
}
const kelompokDasar = { skor: 100, tanggalTerbaru: '2026-09-01', cocok: [], jumlahAnggota: 1, pratinjauTerpotong: false, pratinjau: [] }
let router

beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.keluar.create.mockResolvedValue({ data: { id: 'sk-baru' } })
    mocks.keluar.getNextNumber.mockResolvedValue({ nomorSurat: '001/Nota Dinas/09/2026' })
    mocks.keluar.getById.mockResolvedValue(tersimpan)
    mocks.lacak.mockImplementation(async ({ q, mode, jenis }) => ({ q, mode, jenisKueri: 'nomor',
        kelompok: mode !== 'cek' || jenis !== 'surat_keluar' ? []
            : q === 'ND-12/2026' ? [{ ...kelompokDasar, kunci: 'surat:sk-9', rangkaian: null }]
                : q === 'ND-13/2026' ? [{ ...kelompokDasar, kunci: 'rs-7', rangkaian: { id: 'rs-7', kode: 'RS-2026-000077', status: 'aktif' } }]
                    : [] }))
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

function tampil(entry) {
    router = createMemoryRouter([
        { path: '/surat/keluar/tambah', element: <TambahSuratKeluar /> },
        { path: '/surat/keluar/edit/:id', element: <TambahSuratKeluar /> },
        { path: '/surat/keluar', element: <h1>Daftar</h1> },
    ], { initialEntries: [entry] })
    return render(<RouterProvider router={router} />)
}

async function ketikNomor(nomor) {
    vi.useFakeTimers()
    fireEvent.change(document.getElementById('nomor-surat-keluar'), { target: { value: nomor } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    vi.useRealTimers()
}

describe('peringatan nomor surat keluar yang sudah tercatat', () => {
    it('memakai Lacak mode cek untuk surat keluar saja dan tidak menghalangi penyimpanan', async () => {
        const view = tampil('/surat/keluar/tambah')
        fireEvent.change(document.getElementById('naskah-dinas'), { target: { value: 'Nota Dinas' } })
        fireEvent.change(document.getElementById('tanggal-surat-keluar'), { target: { value: '2026-09-24' } })
        fireEvent.change(document.getElementById('perihal-surat-keluar'), { target: { value: 'Undangan rapat' } })
        fireEvent.change(document.getElementById('penerima-surat-keluar'), { target: { value: 'Direktur Jenderal' } })
        await ketikNomor('ND-12/2026')
        expect(await screen.findByText('Nomor sudah terdaftar')).toBeInTheDocument()
        expect(mocks.lacak).toHaveBeenCalledWith(expect.objectContaining({ q: 'ND-12/2026', mode: 'cek', jenis: 'surat_keluar' }), expect.anything())

        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.keluar.create).toHaveBeenCalled())
        expect(mocks.keluar.create.mock.calls[0][0]).toMatchObject({ numberingMode: 'manual', nomorSurat: 'ND-12/2026' })
    })

    it('menyebut rangkaian surat yang memakai nomor itu', async () => {
        tampil('/surat/keluar/tambah')
        await ketikNomor('ND-13/2026')
        expect(await screen.findByText('Nomor sudah terdaftar / terkait RS-2026-000077')).toBeInTheDocument()
    })

    it('tidak memeriksa nomor saat mengubah surat', async () => {
        tampil('/surat/keluar/edit/sk-1')
        await screen.findByDisplayValue('Surat lama')
        await ketikNomor('ND-12/2026')
        expect(mocks.lacak).not.toHaveBeenCalledWith(expect.objectContaining({ mode: 'cek' }), expect.anything())
        expect(screen.queryByText('Nomor sudah terdaftar')).toBeNull()
    })
})
