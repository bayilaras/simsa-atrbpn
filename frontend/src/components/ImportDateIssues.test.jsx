import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ImportDateIssues from './ImportDateIssues'

const reason = 'Tanggal "11/25/2026" tampaknya ditulis dengan bulan lebih dulu, sehingga tidak dipakai.'

describe('preview notice for rows with a rejected date', () => {
    afterEach(cleanup)

    it.each([[undefined], [{ total: 0, rows: [] }]])('shows nothing when no row is flagged (%j)', issues => {
        const { container } = render(<ImportDateIssues issues={issues} totalRows={3} />)
        expect(container).toBeEmptyDOMElement()
    })

    it('counts the flagged rows and lists each with its data row number and reason', () => {
        render(<ImportDateIssues totalRows={40} issues={{ total: 2, rows: [
            { row: 2, value: '11/25/2026', reason }, { row: 7, value: '', reason: 'Tanggal surat kosong.' }] }} />)
        const notice = screen.getByRole('alert')
        expect(notice).toHaveTextContent('2 dari 40 baris akan ditolak karena tanggalnya')
        expect(notice).toHaveTextContent('Baris lain tetap dapat diimpor. Perbaiki tanggal di sumber data, lalu buat pratinjau lagi agar baris ini ikut tersimpan.')
        expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
            `Baris data ke-2: ${reason}`, 'Baris data ke-7: Tanggal surat kosong.'])
    })

    it('says how many more rows are flagged than listed', () => {
        render(<ImportDateIssues totalRows={40} issues={{ total: 14, rows: [{ row: 2, value: '11/25/2026', reason }] }} />)
        expect(screen.getAllByRole('listitem').at(-1)).toHaveTextContent('dan 13 baris lainnya.')
    })
})
