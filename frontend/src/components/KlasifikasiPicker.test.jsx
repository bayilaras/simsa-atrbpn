import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KlasifikasiPicker } from './KlasifikasiPicker'

function classification(index) {
    const suffix = String(index).padStart(4, '0')
    return {
        id: `distractor-${index}`,
        kode: `XX.${suffix}`,
        sourceCode: `XX.${suffix}`,
        jenis: `Administrasi Struktural ${index}`,
        kategori: 'Umum',
        tipe: 'fasilitatif',
        isSelectable: true,
    }
}

describe('KlasifikasiPicker search rendering', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('renders results in bounded pages and narrows a classification code to its real match', async () => {
        const target = {
            id: 'target',
            kode: 'TU.02.01',
            sourceCode: 'TU.02.01',
            jenis: 'Pengelolaan Kearsipan',
            kategori: 'Ketatausahaan',
            tipe: 'fasilitatif',
            isSelectable: true,
        }
        const data = [target, ...Array.from({ length: 250 }, (_, index) => classification(index))]
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: async () => ({ success: true, data }),
        }))

        render(<KlasifikasiPicker value="" onChange={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: /Pilih Klasifikasi Arsip/i }))

        expect(await screen.findByText('Menampilkan 100 dari 251 hasil.')).toBeInTheDocument()

        fireEvent.change(screen.getByRole('textbox', { name: 'Cari klasifikasi arsip' }), {
            target: { value: 'TU.02.01' },
        })

        expect(await screen.findByText('Pengelolaan Kearsipan')).toBeInTheDocument()
        await waitFor(() => {
            expect(screen.queryByText('Administrasi Struktural 0')).not.toBeInTheDocument()
            expect(screen.queryByText(/Menampilkan 100 dari/)).not.toBeInTheDocument()
        })
    })
})
