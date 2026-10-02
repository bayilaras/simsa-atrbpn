import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LacakKelompokCard } from './LacakKelompokCard'

afterEach(cleanup)
const R = '11111111-1111-4111-8111-111111111111'
const kelompokRangkaian = {
    kunci: R, skor: 100, tanggalTerbaru: '2025-01-20',
    rangkaian: { id: R, kode: 'RS-2025-000001', status: 'aktif', judul: 'Penetapan tim arsip 2025', tahun: 2025, asal: 'inisiatif' },
    cocok: [{ jenis: 'surat_keluar', id: 'sk-25', nomorSurat: 'SK-01/DJ-PTPP', perihal: 'Penetapan tim arsip 2025', tahun: 2025, skor: 100 }],
    pratinjau: [
        { anggotaId: 'a-1', jenis: 'surat_keluar', id: 'nd-25', nomorSurat: 'ND-3/DJ-PTPP/2025', perihal: 'Penjelasan Keputusan', tanggalSurat: '2025-01-20', tahun: 2025, naskah: 'Nota Dinas', unitNama: 'Dit. BPPT', relasi: 'menjelaskan', masked: false },
        { anggotaId: 'a-2', jenis: 'surat_masuk', unitNama: 'Sesditjen', label: 'Dikecualikan', masked: true, dapatAjukanAkses: true },
    ],
    jumlahAnggota: 5, pratinjauTerpotong: true,
}
const mount = props => render(<MemoryRouter><LacakKelompokCard {...props} /></MemoryRouter>)

describe('LacakKelompokCard', () => {
    it('menampilkan kode RS, status, tahun, pratinjau dengan label relasi, dan node tersamar tanpa tautan', () => {
        const onToggle = vi.fn()
        mount({ kelompok: kelompokRangkaian, onToggle })
        expect(screen.getByText('RS-2025-000001')).toBeVisible()
        expect(screen.getByText('Aktif')).toBeVisible()
        expect(screen.getByText('Tahun 2025')).toBeVisible()
        expect(screen.getByRole('heading', { name: 'Penetapan tim arsip 2025' })).toBeVisible()
        expect(screen.getByRole('link', { name: 'ND-3/DJ-PTPP/2025' })).toHaveAttribute('href', '/surat/keluar/nd-25')
        expect(screen.getByText('Menjelaskan')).toBeVisible()
        const tersamar = screen.getByText(/Dikecualikan/).closest('li')
        expect(tersamar).toHaveAttribute('data-masked', 'true')
        expect(tersamar).toHaveTextContent('Surat masuk · Sesditjen · Dikecualikan')
        expect(within(tersamar).queryByRole('link')).toBeNull()
        expect(tersamar.textContent).not.toMatch(/undefined|null/)
        expect(screen.getByText('+3 surat lain dalam rangkaian ini')).toBeVisible()
        const tombol = screen.getByRole('button', { name: 'Buka rangkaian' })
        expect(tombol).toHaveAttribute('aria-expanded', 'false')
        fireEvent.click(tombol)
        expect(onToggle).toHaveBeenCalledTimes(1)
    })

    it('merender panel di tempat hanya ketika terbuka', () => {
        mount({ kelompok: kelompokRangkaian, terbuka: true, onToggle: vi.fn(), children: <section aria-label="Panel Alur Surat">panel</section> })
        expect(screen.getByRole('button', { name: 'Tutup rangkaian' })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('region', { name: 'Panel Alur Surat' })).toBeVisible()
    })

    it('surat tunggal: tanpa tombol ekspansi, dengan tahun dan tautan detail', () => {
        mount({ kelompok: { kunci: 'surat:sm-1', skor: 100, tanggalTerbaru: '2023-01-05', rangkaian: null,
            cocok: [{ jenis: 'surat_masuk', id: 'sm-1', nomorSurat: 'SK-01/DJ-PTPP', perihal: 'Penetapan 2023', tahun: 2023, skor: 100 }],
            pratinjau: [{ anggotaId: null, jenis: 'surat_masuk', id: 'sm-1', nomorSurat: 'SK-01/DJ-PTPP', perihal: 'Penetapan 2023', tanggalSurat: '2023-01-05', tahun: 2023, naskah: null, unitKerjaId: 'sesditjen', unitNama: 'Sesditjen', relasi: null, masked: false }],
            jumlahAnggota: 1, pratinjauTerpotong: false } })
        expect(screen.getByText('Surat tunggal')).toBeVisible()
        expect(screen.getByText('Tahun 2023')).toBeVisible()
        expect(screen.getByRole('link', { name: 'Buka detail surat' })).toHaveAttribute('href', '/surat/masuk/sm-1')
        expect(screen.queryByRole('button', { name: 'Buka rangkaian' })).toBeNull()
        expect(screen.getAllByText('SK-01/DJ-PTPP')).toHaveLength(1)
    })

    it('surat tunggal tersamar (mode baca): judul dari cocok tetap, tanpa tautan detail', () => {
        mount({ kelompok: { kunci: 'surat:sm-2', skor: 90, tanggalTerbaru: '2026-09-01', rangkaian: null,
            cocok: [{ jenis: 'surat_masuk', id: 'sm-2', nomorSurat: 'T-2/2026', perihal: 'Terbatas tanpa grant', tahun: 2026, skor: 90 }],
            pratinjau: [{ anggotaId: null, jenis: 'surat_masuk', unitNama: 'Sesditjen', label: 'Dikecualikan', masked: true, dapatAjukanAkses: false }],
            jumlahAnggota: 1, pratinjauTerpotong: false } })
        expect(screen.getByRole('heading', { name: 'T-2/2026' })).toBeVisible()
        expect(screen.queryByRole('link', { name: 'Buka detail surat' })).toBeNull()
        expect(screen.getByText('Surat masuk · Sesditjen · Dikecualikan')).toBeVisible()
    })
})
