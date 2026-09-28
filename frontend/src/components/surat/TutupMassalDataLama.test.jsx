import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TutupMassalDataLama from './TutupMassalDataLama'

const mocks = vi.hoisted(() => ({ ringkasan: vi.fn(), tutup: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => ({
    rangkaianService: { getRingkasanDataLama: mocks.ringkasan, tutupMassalDataLama: mocks.tutup },
}))
vi.mock('@/components/KlasifikasiPicker', () => ({
    KlasifikasiPicker: ({ onChange }) => <button type="button" onClick={() => onChange('KU.01', { id: 3 })}>Pilih KU.01</button>,
}))

describe('TutupMassalDataLama', () => {
    beforeEach(() => vi.clearAllMocks())
    afterEach(cleanup)

    it('tersembunyi bila pengguna bukan pengawas atau layanan belum tersedia', async () => {
        mocks.ringkasan.mockResolvedValue({ dapatMenutup: false, perTahun: [] })
        const { container } = render(<TutupMassalDataLama />)
        await waitFor(() => expect(mocks.ringkasan).toHaveBeenCalled())
        expect(container).toBeEmptyDOMElement()
    })

    it('pratinjau lalu penerapan mengirim expectedCount dari pratinjau', async () => {
        mocks.ringkasan.mockResolvedValue({ dapatMenutup: true, perTahun: [{ tahun: 2022, jumlah: 5 }, { tahun: 2023, jumlah: 2 }] })
        mocks.tutup
            .mockResolvedValueOnce({ jumlah: 4, tanpaKlasifikasi: 1, contoh: ['RS-2022-000001'], contohTanpaKlasifikasi: ['RS-2022-000009'], terpotong: false, diterapkan: 0 })
            .mockResolvedValueOnce({ jumlah: 4, tanpaKlasifikasi: 1, contoh: [], contohTanpaKlasifikasi: [], terpotong: false, diterapkan: 4 })
        render(<TutupMassalDataLama />)
        fireEvent.change(await screen.findByLabelText('Tahun'), { target: { value: '2022' } })
        fireEvent.click(screen.getByRole('button', { name: 'Pratinjau' }))
        expect(await screen.findByText(/4 rangkaian siap diberkaskan/)).toBeInTheDocument()
        const terapkan = screen.getByRole('button', { name: 'Tutup massal 4 rangkaian' })
        expect(terapkan).toBeDisabled()
        fireEvent.click(screen.getByLabelText(/Saya memahami/))
        fireEvent.click(terapkan)
        await waitFor(() => expect(mocks.tutup).toHaveBeenLastCalledWith({ tahun: 2022, dryRun: false, konfirmasi: true, expectedCount: 4 }))
        expect(await screen.findByText('4 rangkaian diberkaskan.')).toBeInTheDocument()
    })

    it('memanggil onSelesai setelah penerapan agar daftar dimuat ulang', async () => {
        const onSelesai = vi.fn()
        mocks.ringkasan.mockResolvedValue({ dapatMenutup: true, perTahun: [{ tahun: 2022, jumlah: 1 }] })
        mocks.tutup
            .mockResolvedValueOnce({ jumlah: 1, tanpaKlasifikasi: 0, contoh: [], contohTanpaKlasifikasi: [], terpotong: false, diterapkan: 0 })
            .mockResolvedValueOnce({ jumlah: 1, tanpaKlasifikasi: 0, contoh: [], contohTanpaKlasifikasi: [], terpotong: false, diterapkan: 1 })
        render(<TutupMassalDataLama onSelesai={onSelesai} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Pratinjau' }))
        fireEvent.click(await screen.findByLabelText(/Saya memahami/))
        fireEvent.click(screen.getByRole('button', { name: 'Tutup massal 1 rangkaian' }))
        await waitFor(() => expect(onSelesai).toHaveBeenCalledTimes(1))
    })

    it('mengubah filter membatalkan pratinjau', async () => {
        mocks.ringkasan.mockResolvedValue({ dapatMenutup: true, perTahun: [{ tahun: 2022, jumlah: 5 }] })
        mocks.tutup.mockResolvedValue({ jumlah: 5, tanpaKlasifikasi: 0, contoh: [], contohTanpaKlasifikasi: [], terpotong: false, diterapkan: 0 })
        render(<TutupMassalDataLama />)
        fireEvent.click(await screen.findByRole('button', { name: 'Pratinjau' }))
        await screen.findByText(/5 rangkaian siap diberkaskan/)
        fireEvent.click(screen.getByRole('button', { name: 'Pilih KU.01' }))
        expect(screen.queryByRole('button', { name: /Tutup massal 5/ })).not.toBeInTheDocument()
    })
})
