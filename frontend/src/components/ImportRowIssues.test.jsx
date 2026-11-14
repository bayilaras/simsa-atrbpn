import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ImportRowIssues from './ImportRowIssues'

const reason = 'Tanggal "11/25/2026" tampaknya ditulis dengan bulan lebih dulu, sehingga tidak dipakai.'
const ceiling = 'Klasifikasi keamanan melebihi kewenangan pengguna. Kelas Rahasia dan Sangat Rahasia hanya dapat ditetapkan oleh Super Admin.'

describe('preview notice for rows the import will reject or skip', () => {
    afterEach(cleanup)

    it.each([[undefined, undefined], [{ total: 0, rows: [] }, { source: 0, recorded: 0, deleted: 0 }]])('shows nothing when no row is flagged (%j)', (issues, duplicates) => {
        const { container } = render(<ImportRowIssues issues={issues} duplicates={duplicates} totalRows={3} />)
        expect(container).toBeEmptyDOMElement()
    })

    it('counts the rejected rows and lists each with its data row number and reason, whatever the reason', () => {
        render(<ImportRowIssues totalRows={40} issues={{ total: 3, rows: [
            { row: 2, reason }, { row: 5, reason: ceiling }, { row: 7, reason: 'Tanggal surat yang valid wajib diisi untuk identitas impor yang stabil.' }] }} />)
        const notice = screen.getByRole('alert')
        expect(notice).toHaveTextContent('3 dari 40 baris akan ditolak')
        expect(notice).toHaveTextContent('Baris lain tetap dapat diimpor. Baris yang ditolak tidak disimpan; alasannya tercantum di bawah. Setelah sumber data diperbaiki, buat pratinjau lagi.')
        expect(within(notice).getAllByRole('listitem').map(item => item.textContent)).toEqual([
            `Baris data ke-2: ${reason}`, `Baris data ke-5: ${ceiling}`, 'Baris data ke-7: Tanggal surat yang valid wajib diisi untuk identitas impor yang stabil.'])
    })

    it('says how many more rows are rejected than listed', () => {
        render(<ImportRowIssues totalRows={40} issues={{ total: 24, rows: [{ row: 2, reason }] }} />)
        expect(screen.getAllByRole('listitem').at(-1)).toHaveTextContent('dan 23 baris lainnya.')
    })

    it('lists the rows the import will skip as duplicates, by kind', () => {
        render(<ImportRowIssues totalRows={40} issues={{ total: 0, rows: [] }} duplicates={{ source: 1, recorded: 12, deleted: 2 }} />)
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(within(screen.getByRole('list', { name: 'Baris yang akan dilewati' })).getAllByRole('listitem').map(item => item.textContent)).toEqual([
            '12 baris sudah tercatat di SIMSA pada unit ini dan akan dilewati, atau diperbarui bila Sinkronkan dipilih dan sumbernya berubah.',
            '1 baris ganda di sumber akan dilewati.',
            '2 baris cocok dengan surat yang sudah dihapus dan tidak akan dibuat ulang.'])
    })
})
