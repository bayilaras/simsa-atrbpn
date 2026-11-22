import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ getById: vi.fn(), getBySurat: vi.fn() }))
vi.mock('@/components/surat/KoreksiBerkasSection', () => ({ default: () => null }))
vi.mock('@/services/rangkaian.service', () => ({ default: mocks, rangkaianService: mocks }))
import { AlurSuratPanel } from '../AlurSuratPanel'

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getById.mockReturnValue(new Promise(() => {}))
    mocks.getBySurat.mockReturnValue(new Promise(() => {}))
})
afterEach(cleanup)

describe('AlurSuratPanel dengan rangkaianId (Lacak Surat)', () => {
    it('memuat lewat getById bila rangkaianId diberikan', () => {
        render(<MemoryRouter><AlurSuratPanel rangkaianId="11111111-1111-4111-8111-111111111111" /></MemoryRouter>)
        expect(mocks.getById).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
        expect(mocks.getBySurat).not.toHaveBeenCalled()
        expect(screen.getByText('Memuat alur surat…')).toBeVisible()
    })
    it('tetap memakai getBySurat tanpa rangkaianId (perilaku P2)', () => {
        render(<MemoryRouter><AlurSuratPanel jenis="surat_masuk" suratId="s1" /></MemoryRouter>)
        expect(mocks.getBySurat).toHaveBeenCalledWith('surat_masuk', 's1')
        expect(mocks.getById).not.toHaveBeenCalled()
    })
    // Server melaporkan tier 'pengawas' juga untuk rangkaian yang dicatat unit pembaca sendiri.
    const milikDitjen = {
        rangkaian: {
            id: 'r1', kode: 'RS-2026-000003', status: 'aktif', asal: 'surat_masuk', judul: 'Rangkaian uji', tahun: 2026,
            unitPencatat: { id: 'ditjen', nama: 'Ditjen' }, unitPengolah: null,
            diberkaskanAt: null, createdAt: '2026-11-23T00:00:00.000Z',
        },
        peserta: [{ id: 'ditjen', nama: 'Ditjen' }], anggota: [], relasi: [], disposisi: [], rangkaianTerkait: [], aksiDiizinkan: ['gabung'], truncated: false, aksesMelalui: 'pengawas',
    }
    it('tidak menampilkan pita pengawas untuk rangkaian yang dicatat unit sendiri', async () => {
        mocks.getById.mockResolvedValue(milikDitjen)
        render(<MemoryRouter><AlurSuratPanel rangkaianId="r1" unitSendiriId="ditjen" /></MemoryRouter>)
        expect(await screen.findByText('RS-2026-000003')).toBeVisible()
        expect(screen.queryByRole('note')).toBeNull()
    })
    it('tetap menampilkan pita pengawas untuk rangkaian unit lain', async () => {
        mocks.getById.mockResolvedValue(milikDitjen)
        render(<MemoryRouter><AlurSuratPanel rangkaianId="r1" unitSendiriId="sesditjen" /></MemoryRouter>)
        expect(await screen.findByRole('note')).toHaveTextContent('Anda melihat surat ini sebagai unit pengawas.')
    })
    it('rangkaianId yang 404 menampilkan keadaan netral, bukan galat', async () => {
        mocks.getById.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))
        render(<MemoryRouter><AlurSuratPanel rangkaianId="11111111-1111-4111-8111-111111111111" /></MemoryRouter>)
        expect(await screen.findByRole('status')).toHaveTextContent('Alur surat tidak tersedia untuk Anda.')
        expect(screen.queryByRole('alert')).toBeNull()
    })
})
