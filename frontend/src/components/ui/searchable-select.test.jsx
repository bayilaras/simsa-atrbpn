import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { SearchableSelect } from './searchable-select'

// Pilihan Jenis Surat (45 jenis) harus dapat dipakai dengan papan ketik saja:
// tombol panah memindahkan sorotan, Enter memilih, dan pembaca layar diberi
// tahu pilihan yang sedang disorot lewat aria-activedescendant.
const JENIS = ['Keputusan', 'Surat Tugas', 'Nota Dinas', 'Memorandum']

function Pilihan({ onValueChange = () => {}, awal = '' }) {
    const [nilai, setNilai] = useState(awal)
    return (
        <SearchableSelect
            ariaLabel="Jenis surat"
            options={JENIS}
            value={nilai}
            onValueChange={(v) => { setNilai(v); onValueChange(v) }}
            placeholder="Pilih jenis naskah dinas..."
            searchPlaceholder="Cari jenis surat..."
        />
    )
}

afterEach(cleanup)

const buka = () => {
    fireEvent.click(screen.getByRole('combobox', { name: 'Jenis surat' }))
    return screen.getByRole('combobox', { name: 'Cari jenis surat...' })
}
const disorot = (cari) => document.getElementById(cari.getAttribute('aria-activedescendant'))

describe('SearchableSelect dengan papan ketik', () => {
    it('memindahkan sorotan dengan tombol panah dan memilih dengan Enter', () => {
        const onValueChange = vi.fn()
        render(<Pilihan onValueChange={onValueChange} />)
        const cari = buka()
        expect(cari).toHaveFocus()
        expect(screen.getByRole('listbox', { name: 'Jenis surat' })).toBeInTheDocument()
        expect(disorot(cari)).toHaveTextContent('Keputusan')

        fireEvent.keyDown(cari, { key: 'ArrowDown' })
        fireEvent.keyDown(cari, { key: 'ArrowDown' })
        expect(disorot(cari)).toHaveTextContent('Nota Dinas')
        fireEvent.keyDown(cari, { key: 'ArrowUp' })
        expect(disorot(cari)).toHaveTextContent('Surat Tugas')
        fireEvent.keyDown(cari, { key: 'ArrowUp' })
        fireEvent.keyDown(cari, { key: 'ArrowUp' })
        expect(disorot(cari)).toHaveTextContent('Memorandum')

        fireEvent.keyDown(cari, { key: 'Enter' })
        expect(onValueChange).toHaveBeenCalledWith('Memorandum')
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
        expect(screen.getByRole('combobox', { name: 'Jenis surat' })).toHaveTextContent('Memorandum')
    })

    it('menyorot hasil pencarian pertama dan pilihan yang sudah terpilih', () => {
        const onValueChange = vi.fn()
        render(<Pilihan awal="Nota Dinas" onValueChange={onValueChange} />)
        let cari = buka()
        expect(disorot(cari)).toHaveTextContent('Nota Dinas')
        expect(screen.getByRole('option', { name: 'Nota Dinas' })).toHaveAttribute('aria-selected', 'true')

        fireEvent.change(cari, { target: { value: 'surat' } })
        expect(screen.getAllByRole('option').map(opsi => opsi.textContent)).toEqual(['Surat Tugas'])
        expect(disorot(cari)).toHaveTextContent('Surat Tugas')
        fireEvent.keyDown(cari, { key: 'Enter' })
        expect(onValueChange).toHaveBeenLastCalledWith('Surat Tugas')

        cari = buka()
        fireEvent.change(cari, { target: { value: 'tidak ada' } })
        expect(cari).not.toHaveAttribute('aria-activedescendant')
        fireEvent.keyDown(cari, { key: 'Enter' })
        expect(onValueChange).toHaveBeenCalledTimes(1)
    })

    it('tetap dapat dipilih dengan tetikus', () => {
        const onValueChange = vi.fn()
        render(<Pilihan onValueChange={onValueChange} />)
        buka()
        fireEvent.click(screen.getByRole('option', { name: 'Nota Dinas' }))
        expect(onValueChange).toHaveBeenCalledWith('Nota Dinas')
    })
})
