import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LembarDisposisi from './LembarDisposisi'

const mocks = vi.hoisted(() => ({
    getById: vi.fn(),
    getHistoryBySurat: vi.fn(),
    get: vi.fn(),
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1', name: 'Petugas TU', role: 'admin_unit' } }) }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getById: mocks.getById } }))
vi.mock('@/services/distribution.service', () => ({ default: { getHistoryBySurat: mocks.getHistoryBySurat } }))
vi.mock('@/services/api', () => ({ default: { get: mocks.get } }))

const SURAT = {
    id: 'sm-1', unitKerjaId: 'sesditjen', noUrut: 57, nomorSurat: '12/BPN/XI/2026', tanggalSurat: '2026-11-02',
    tanggalDiterima: '2026-11-03', dari: 'Kantah Bogor', perihal: 'Permohonan data bidang', sifatSurat: 'segera', disposisi: [],
}

function tampilkan() {
    render(
        <MemoryRouter initialEntries={['/surat/masuk/sm-1/lembar-disposisi']}>
            <Routes><Route path="/surat/masuk/:id/lembar-disposisi" element={<LembarDisposisi />} /></Routes>
        </MemoryRouter>,
    )
}

beforeEach(() => {
    mocks.getById.mockReset().mockResolvedValue(SURAT)
    mocks.get.mockReset().mockResolvedValue({ data: [{ id: 'sesditjen', name: 'Sekretariat Ditjen' }, { id: 'dir_bppt', name: 'Direktorat BPPT' }] })
    mocks.getHistoryBySurat.mockReset().mockResolvedValue([{
        distribution: { id: 'd-1', targetUnitId: 'dir_bppt', instruction: 'Mohon ditindaklanjuti', status: 'sent', sentAt: '2026-11-03T02:00:00.000Z', batasWaktu: '2026-11-10' },
        targetUnit: { id: 'dir_bppt', name: 'Direktorat BPPT' },
    }])
})
afterEach(cleanup)

describe('LembarDisposisi', () => {
    it('mencetak identitas surat, disposisi terkirim, dan baris kosong untuk diisi tangan', async () => {
        const print = vi.spyOn(window, 'print').mockImplementation(() => {})
        tampilkan()
        expect(await screen.findByRole('heading', { name: 'LEMBAR DISPOSISI' })).toBeInTheDocument()
        expect(screen.getByText('Sekretariat Ditjen')).toBeInTheDocument()
        expect(screen.getByRole('row', { name: /No. Agenda 57/ })).toBeInTheDocument()
        expect(screen.getByRole('row', { name: /Tanggal Diterima 3 November 2026/ })).toBeInTheDocument()
        const tujuan = screen.getByRole('row', { name: /Direktorat BPPT/ })
        expect(within(tujuan).getByText('Mohon ditindaklanjuti')).toBeInTheDocument()
        expect(within(tujuan).getByText('10 November 2026')).toBeInTheDocument()
        // 1 baris terisi + 4 baris kosong, di bawah satu baris judul.
        expect(screen.getAllByRole('row', { hidden: true }).filter(row => row.closest('thead') === null && row.querySelectorAll('td').length === 5)).toHaveLength(5)
        expect(screen.getByText(/Dicetak dari SIMSA pada .* oleh Petugas TU/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /Cetak/ }))
        expect(print).toHaveBeenCalled()
    })

    it('tetap dapat dicetak bila belum ada disposisi', async () => {
        mocks.getHistoryBySurat.mockRejectedValue(Object.assign(new Error('Riwayat disposisi tidak ditemukan.'), { status: 404 }))
        tampilkan()
        expect(await screen.findByRole('heading', { name: 'LEMBAR DISPOSISI' })).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: 'Catatan / instruksi pimpinan' })).toBeInTheDocument()
    })

    it.each([
        ['riwayat disposisi', () => mocks.getHistoryBySurat.mockRejectedValueOnce(Object.assign(new Error('Layanan sibuk'), { status: 503 }))],
        ['riwayat disposisi (jaringan putus)', () => mocks.getHistoryBySurat.mockRejectedValueOnce(new TypeError('Failed to fetch'))],
        ['daftar unit kerja', () => mocks.get.mockRejectedValueOnce(Object.assign(new Error('Terlalu banyak permintaan'), { status: 429 }))],
    ])('tidak dapat dicetak selama %s gagal dimuat, lalu tampil utuh setelah Coba lagi', async (_label, gagalkan) => {
        gagalkan()
        tampilkan()
        expect(await screen.findByRole('alert')).toHaveTextContent('Riwayat disposisi surat ini belum dapat dimuat')
        expect(screen.queryByRole('heading', { name: 'LEMBAR DISPOSISI' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Cetak/ })).not.toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Kembali ke detail surat' })).toHaveAttribute('href', '/surat/masuk/sm-1')

        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        expect(await screen.findByRole('heading', { name: 'LEMBAR DISPOSISI' })).toBeInTheDocument()
        expect(screen.getByRole('row', { name: /Direktorat BPPT/ })).toBeInTheDocument()
        expect(screen.getByText('Sekretariat Ditjen')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Cetak/ })).toBeInTheDocument()
    })

    it('meminta persetujuan akses untuk surat terkendali', async () => {
        mocks.getById.mockRejectedValue(Object.assign(new Error('Perlu persetujuan'), {
            status: 403, code: 'ACCESS_APPROVAL_REQUIRED', data: { code: 'ACCESS_APPROVAL_REQUIRED', entityType: 'surat_masuk', entityId: 'sm-1' },
        }))
        tampilkan()
        expect(await screen.findByRole('alert')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Kembali ke detail surat' })).toHaveAttribute('href', '/surat/masuk/sm-1')
    })
})
