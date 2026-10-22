import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ImportRowReport from './ImportRowReport'

const rows = [
    { row: 1, no: '1', nomorSurat: '1/UND/I/2026', tanggal: '05/01/2026', perihal: 'Undangan rapat', status: 'imported' },
    { row: 2, no: '2', nomorSurat: '1/UND/I/2026', tanggal: '06/01/2026', perihal: 'Diketik ulang', status: 'duplicate', duplicate: 'source',
        reason: 'Nomor surat dan tahun sama dengan baris data ke-1 pada sumber ini.' },
    { row: 3, no: '3', nomorSurat: '3/UND/I/2026', tanggal: '', perihal: 'Tanpa tanggal', status: 'invalid', reason: 'Tanggal surat yang valid wajib diisi.' },
    { row: 4, no: '4', nomorSurat: '', tanggal: '', perihal: '', status: 'empty', reason: 'Nomor surat dan perihal kosong.' },
    { row: 5, no: '5', nomorSurat: '5/UND/I/2026', tanggal: '07/01/2026', perihal: 'Tercatat', status: 'duplicate', duplicate: 'recorded',
        reason: 'Sudah tercatat di SIMSA pada unit ini.' },
]
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const tableRows = () => within(screen.getByRole('table', { name: 'Rincian hasil impor per baris' })).getAllByRole('row').slice(1)

describe('import row report', () => {
    it('opens on the rows that need a look and can show every row', () => {
        render(<ImportRowReport rows={rows} type="surat-keluar" />)
        const filter = screen.getByLabelText('Tampilkan')
        expect(filter).toHaveDisplayValue('Perlu dicek (2)')
        expect(tableRows().map(row => within(row).getAllByRole('cell')[0].textContent)).toEqual(['2', '3'])
        expect(within(tableRows()[0]).getByText('Duplikat')).toBeInTheDocument()
        expect(within(tableRows()[0]).getByText('Nomor surat dan tahun sama dengan baris data ke-1 pada sumber ini.')).toBeInTheDocument()
        fireEvent.change(filter, { target: { value: 'all' } })
        expect(tableRows()).toHaveLength(5)
        fireEvent.change(filter, { target: { value: 'empty' } })
        expect(tableRows().map(row => within(row).getAllByRole('cell')[0].textContent)).toEqual(['4'])
    })

    it('opens on every row when none needs a look', () => {
        render(<ImportRowReport rows={[rows[0]]} type="surat-keluar" />)
        expect(screen.getByLabelText('Tampilkan')).toHaveDisplayValue('Semua (1)')
        expect(tableRows()).toHaveLength(1)
    })

    it('downloads every row as CSV whatever the filter shows', async () => {
        const created = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:report')
        vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {})
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
        render(<ImportRowReport rows={rows} type="surat-masuk" />)
        fireEvent.click(screen.getByRole('button', { name: 'Unduh laporan (CSV)' }))
        expect(click).toHaveBeenCalledTimes(1)
        expect(click.mock.contexts[0].getAttribute('download')).toMatch(/^laporan-impor-surat-masuk-\d{8}-\d{4}\.csv$/)
        const csv = await new Promise(resolve => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.readAsText(created.mock.calls[0][0])
        })
        expect(csv.split('\r\n')).toHaveLength(6)
        expect(csv.split('\r\n')[0]).toBe('Baris;No;Nomor Surat;Tanggal;Perihal;Status;Keterangan')
        expect(csv).toContain('Nomor surat dan perihal kosong.')
    })

    it('renders nothing for a server that reports no rows', () => {
        const { container } = render(<ImportRowReport rows={[]} type="surat-keluar" />)
        expect(container).toBeEmptyDOMElement()
    })
})
