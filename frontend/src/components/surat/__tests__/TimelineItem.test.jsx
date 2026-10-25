import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { TimelineItem } from '../TimelineItem'

afterEach(cleanup)

function renderItem(item) {
    return render(
        <MemoryRouter initialEntries={['/']}>
            <Routes>
                <Route path="/" element={<TimelineItem item={item} isLast />} />
                <Route path="/surat/:type/:id" element={<p>Halaman detail</p>} />
            </Routes>
        </MemoryRouter>,
    )
}

it('menampilkan surat terlihat dan menavigasi ke detail', () => {
    renderItem({ type: 'keluar', id: 's2', tanggal: '2026-09-07', perihal: 'Tanggapan PTEP', nomorSurat: 'ND-1/PTEP/2026', kepada: 'Sesditjen', unitNama: 'Dit. PTEP', relasiLabel: 'Tindak lanjut' })
    expect(screen.getByText('Tanggapan PTEP')).toBeInTheDocument()
    expect(screen.getByText('ND-1/PTEP/2026')).toBeInTheDocument()
    expect(screen.getByText('Tindak lanjut')).toBeInTheDocument()
    expect(screen.getByText(/Dit\. PTEP/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /detail/i }))
    expect(screen.getByText('Halaman detail')).toBeInTheDocument()
})

it('menampilkan node tersamar tanpa isi dan tanpa tombol detail', () => {
    const { container } = renderItem({ type: 'masuk', masked: true, unitNama: 'Sekretariat Ditjen' })
    expect(screen.getByText('Dikecualikan')).toBeInTheDocument()
    expect(screen.getByText('Sekretariat Ditjen')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /detail/i })).toBeNull()
    expect(container.querySelector('[data-masked="true"]')).not.toBeNull()
})

it('tidak gagal saat tanggal tidak tersedia', () => {
    renderItem({ type: 'masuk', id: 's1', tanggal: null, perihal: 'Tanpa tanggal', nomorSurat: 'SM-9', dari: 'Kanwil' })
    expect(screen.getByText('Tanpa tanggal')).toBeInTheDocument()
})

it('merender slot aksi opsional pada node terlihat dan tersamar', () => {
    const { unmount } = renderItem({ type: 'keluar', id: 's2', perihal: 'Tanggapan', nomorSurat: 'ND-1' })
    expect(screen.queryByRole('button', { name: 'Aksi uji' })).toBeNull()
    unmount()
    render(<MemoryRouter><TimelineItem item={{ type: 'masuk', masked: true, unitNama: 'Sekretariat Ditjen' }} isLast aksi={<button type="button">Aksi uji</button>} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Aksi uji' })).toBeInTheDocument()
    cleanup()
    render(<MemoryRouter><TimelineItem item={{ type: 'keluar', id: 's2', perihal: 'Tanggapan', nomorSurat: 'ND-1' }} isLast aksi={<button type="button">Aksi uji</button>} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Aksi uji' })).toBeInTheDocument()
})
