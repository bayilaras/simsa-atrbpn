import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DisposisiRegistrasiSection } from '../DisposisiRegistrasiSection'
import { gantiPesanPeramban } from '@/lib/pesan-peramban'
import { galatBatasWaktu, hariIniJakarta } from '@/lib/tindak-lanjut'

const units = [{ id: 'dir_bppt', name: 'Direktorat BPPT' }]

function Formulir({ isEditMode = false, value = ['dir_bppt'] }) {
    const [batasWaktu, setBatasWaktu] = useState('')
    const [galat, setGalat] = useState()
    return (
        <form>
            <DisposisiRegistrasiSection
                isEditMode={isEditMode}
                units={units}
                value={value}
                onChange={() => {}}
                penanggungJawab=""
                onPenanggungJawab={() => {}}
                batasWaktu={batasWaktu}
                onBatasWaktu={(nilai) => { setBatasWaktu(nilai); setGalat(undefined) }}
                instruksi=""
                onInstruksi={() => {}}
                errorBatasWaktu={galat}
                onBatasWaktuInvalid={gantiPesanPeramban(v => galatBatasWaktu(v), setGalat)}
            />
        </form>
    )
}

beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Batas waktu pada disposisi saat registrasi', () => {
    // Atribut min membuat peramban menahan formulir sebelum submit; pesan aplikasi yang harus tampil.
    it('mengganti balon peramban dengan pesan aplikasi untuk tanggal yang sudah lewat', () => {
        render(<Formulir />)
        const isian = screen.getByLabelText('Batas waktu')
        expect(isian).toHaveAttribute('min', hariIniJakarta())

        fireEvent.change(isian, { target: { value: '2000-01-01' } })
        expect(fireEvent.invalid(isian)).toBe(false)
        expect(isian).toHaveAccessibleDescription('Batas waktu tidak boleh sebelum hari ini')
        expect(isian).toHaveAttribute('aria-invalid', 'true')

        fireEvent.change(isian, { target: { value: '2999-01-01' } })
        expect(document.getElementById('batas-waktu-registrasi-error')).toBeNull()
        expect(isian).not.toHaveAttribute('aria-invalid', 'true')
    })

    it('tidak menampilkan isian batas waktu tanpa unit tujuan atau saat mengubah surat', () => {
        const { unmount } = render(<Formulir value={[]} />)
        expect(screen.queryByLabelText('Batas waktu')).toBeNull()
        unmount()
        render(<Formulir isEditMode value={['Ditjen']} />)
        expect(screen.queryByLabelText('Batas waktu')).toBeNull()
    })
})
