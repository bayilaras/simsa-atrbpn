import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ArchiveDialog } from './ArchiveDialog'
import { PESAN_KELAS_TERBATAS_PERAN } from '@/lib/kelas-keamanan'

const mocks = vi.hoisted(() => ({ user: null }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('./archive-registration-validation', () => ({ validateArchiveRegistration: () => '' }))
vi.mock('@/components/KlasifikasiPicker', () => ({ KlasifikasiPicker: ({ onChange, selectedClassification, selectedRetention }) => <div>
    <output aria-label="Pasangan aturan surat">{JSON.stringify({ classification: selectedClassification, retention: selectedRetention })}</output>
    <button type="button" onClick={() => onChange('TU.02.03', { id: 83, jenis: 'JRA baru' }, { id: 98, kode: 'F.VI.03', uraian: 'Retensi baru' })}>Koreksi aturan</button>
</div> }))

const source = { id: 'surat-1', nomorSurat: '001/2026', perihal: 'Arsip surat', tanggalSurat: '2026-09-12', klasifikasiItemId: 82, klasifikasiSubstantifKode: 'HT.01.01', klasifikasiSubstantif: 'Penetapan hak', jraItemId: 97, jraKode: 'S.III.01', jraUraian: 'Berkas penetapan hak', jraRetensiAktif: '2 tahun', jraRetensiInaktif: '3 tahun', jraKeterangan: 'Permanen', klasifikasiKeamanan: 'rahasia' }
const PERNYATAAN_PERMANEN = 'Saya memahami bahwa pengarsipan ini permanen dan tidak dapat dibatalkan.'
const setujuiPermanen = () => fireEvent.click(screen.getByRole('checkbox', { name: PERNYATAAN_PERMANEN }))
beforeEach(() => { mocks.user = { id: 'u-sa', role: 'super_admin' } })
afterEach(cleanup)

describe('surat to archive rule transfer', () => {
    it('prepopulates and submits the saved pair and security classification', async () => {
        const onArchive = vi.fn().mockResolvedValue(undefined)
        render(<MemoryRouter><ArchiveDialog open onOpenChange={vi.fn()} suratData={source} onArchive={onArchive} /></MemoryRouter>)
        expect(screen.getByLabelText('Pasangan aturan surat')).toHaveTextContent('Penetapan hak')
        expect(screen.getByLabelText('Pasangan aturan surat')).toHaveTextContent('S.III.01')
        expect(screen.getByDisplayValue('2 tahun')).toBeInTheDocument()
        setujuiPermanen()
        fireEvent.submit(document.getElementById('archive-form'))
        await waitFor(() => expect(onArchive).toHaveBeenCalled())
        expect(onArchive.mock.calls[0][0]).toMatchObject({ klasifikasiItemId: 82, jraItemId: 97, kodeKlasifikasi: 'HT.01.01', klasifikasiKeamanan: 'rahasia' })
        expect(onArchive.mock.calls[0][0]).not.toHaveProperty('ruleSelectionReason')
    })

    it('retains incoming labels and zero retention while completing archive metadata', async () => {
        const onArchive = vi.fn().mockResolvedValue(undefined)
        render(<MemoryRouter><ArchiveDialog open onOpenChange={vi.fn()} suratData={{ ...source, klasifikasiKode: 'TU.02.03', klasifikasiUraian: 'Pembinaan Kearsipan', jraRetensiAktif: 0 }} onArchive={onArchive} /></MemoryRouter>)
        expect(screen.getByLabelText('Pasangan aturan surat')).toHaveTextContent('Pembinaan Kearsipan')
        expect(screen.getByDisplayValue('0')).toBeInTheDocument()
        fireEvent.change(screen.getByPlaceholderText('Contoh: AT.02.02/2172-32/VIII/2025'), { target: { value: 'BERKAS-002' } })
        setujuiPermanen()
        fireEvent.submit(document.getElementById('archive-form'))
        await waitFor(() => expect(onArchive).toHaveBeenCalled())
        expect(onArchive.mock.calls[0][0]).toMatchObject({ nomorBerkas: 'BERKAS-002', klasifikasiItemId: 82, jraItemId: 97, kodeKlasifikasi: 'TU.02.03', klasifikasiArsip: 'Pembinaan Kearsipan' })
        expect(onArchive.mock.calls[0][0]).not.toHaveProperty('retensiAktifPreview')
    })

    it('refills the identity pair when the dialog switches to another source letter', async () => {
        const onOpenChange = vi.fn()
        const onArchive = vi.fn()
        const view = render(<MemoryRouter><ArchiveDialog open onOpenChange={onOpenChange} suratData={source} onArchive={onArchive} /></MemoryRouter>)
        view.rerender(<MemoryRouter><ArchiveDialog open onOpenChange={onOpenChange} suratData={{ ...source, id: 'surat-2', klasifikasiItemId: 92, jraItemId: 107, jraKode: 'F.II.01' }} onArchive={onArchive} /></MemoryRouter>)
        await waitFor(() => expect(screen.getByLabelText('Pasangan aturan surat')).toHaveTextContent('F.II.01'))
        expect(screen.getByLabelText('Pasangan aturan surat')).not.toHaveTextContent('S.III.01')
    })
})

// Radix Select tertutup tetap merender <select> native tersembunyi berisi
// semua opsi yang dirender (termasuk atribut disabled); pilih yang memuat
// opsi kelas. Biasa selalu tampil karena diizinkan bagi setiap peran.
const opsiKelas = () => {
    const native = [...document.querySelectorAll('select')].find(select => select.querySelector('option[value="biasa"]'))
    return Object.fromEntries([...native.options].filter(option => option.value).map(option => [option.value, option.disabled]))
}
const kirim = async (suratData, suratType) => {
    const onArchive = vi.fn().mockResolvedValue(undefined)
    render(<MemoryRouter><ArchiveDialog open onOpenChange={vi.fn()} suratType={suratType} suratData={suratData} onArchive={onArchive} /></MemoryRouter>)
    const opsi = opsiKelas()
    setujuiPermanen()
    fireEvent.submit(document.getElementById('archive-form'))
    await waitFor(() => expect(onArchive).toHaveBeenCalled())
    return { payload: onArchive.mock.calls[0][0], opsi }
}
const masuk = ({ klasifikasiKeamanan: _abaikan, ...rest }) => rest

describe('kelas keamanan arsip mengikuti surat sumber', () => {
    it('surat masuk Rahasia: terisi rahasia dan kelas yang lebih rendah nonaktif', async () => {
        const { payload, opsi } = await kirim({ ...masuk(source), sifatSurat: 'Rahasia' }, 'masuk')
        expect(payload.klasifikasiKeamanan).toBe('rahasia')
        expect(opsi).toEqual({ biasa: true, terbatas: true, rahasia: false, sangat_rahasia: false })
        expect(screen.getByText(/minimal Rahasia sesuai surat sumber/)).toBeInTheDocument()
    })

    it('surat masuk berurgensi Segera tetap biasa tanpa opsi nonaktif', async () => {
        const { payload, opsi } = await kirim({ ...masuk(source), sifatSurat: 'Segera' }, 'masuk')
        expect(payload.klasifikasiKeamanan).toBe('biasa')
        expect(opsi).toEqual({ biasa: false, terbatas: false, rahasia: false, sangat_rahasia: false })
    })

    it('surat masuk mengabaikan klasifikasiKeamanan yang tidak dimilikinya', async () => {
        const { payload } = await kirim({ ...source, sifatSurat: 'Sangat Rahasia', klasifikasiKeamanan: 'biasa' }, 'masuk')
        expect(payload.klasifikasiKeamanan).toBe('sangat_rahasia')
    })

    it('surat keluar lama tanpa kelas (NULL) terisi terbatas, biasa nonaktif', async () => {
        const { payload, opsi } = await kirim({ ...source, klasifikasiKeamanan: null, sifatSurat: 'biasa' }, 'keluar')
        expect(payload.klasifikasiKeamanan).toBe('terbatas')
        expect(opsi).toEqual({ biasa: true, terbatas: false, rahasia: false, sangat_rahasia: false })
    })

    it('sifat tak dikenal gagal-tertutup: semua opsi nonaktif dan kelas tidak dikirim', async () => {
        const { payload, opsi } = await kirim({ ...masuk(source), sifatSurat: 'Kilat Khusus' }, 'masuk')
        expect(payload).not.toHaveProperty('klasifikasiKeamanan')
        expect(opsi).toEqual({ biasa: true, terbatas: true, rahasia: true, sangat_rahasia: true })
        expect(screen.getByText(/tidak dikenali/)).toBeInTheDocument()
    })
})

describe('kelas keamanan arsip mengikuti plafon peran', () => {
    const adminUnit = { id: 'u-tu', role: 'admin_unit', unitKerjaId: 'sesditjen' }
    const bantuanKelas = () => {
        const trigger = screen.getByRole('combobox', { name: 'Klasifikasi keamanan arsip' })
        expect(trigger).toHaveAttribute('aria-describedby', 'klasifikasi-arsip-bantuan')
        return document.getElementById('klasifikasi-arsip-bantuan')
    }

    it('Super Admin melihat semua kelas tanpa teks pembatasan', async () => {
        const { opsi } = await kirim({ ...masuk(source), sifatSurat: 'Segera' }, 'masuk')
        expect(Object.keys(opsi)).toEqual(['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'])
        expect(screen.queryByText(PESAN_KELAS_TERBATAS_PERAN)).toBeNull()
        expect(screen.getByRole('combobox', { name: 'Klasifikasi keamanan arsip' })).not.toHaveAttribute('aria-describedby')
    })

    it('Admin Unit Kerja: Rahasia dan Sangat Rahasia disembunyikan beserta alasannya', async () => {
        mocks.user = adminUnit
        const { payload, opsi } = await kirim({ ...masuk(source), sifatSurat: 'Segera' }, 'masuk')
        expect(opsi).toEqual({ biasa: false, terbatas: false })
        expect(payload.klasifikasiKeamanan).toBe('biasa')
        expect(bantuanKelas()).toHaveTextContent(PESAN_KELAS_TERBATAS_PERAN)
    })

    it('Admin Unit Kerja: kelas surat sumber Rahasia tetap dapat dipertahankan', async () => {
        mocks.user = adminUnit
        const { payload, opsi } = await kirim({ ...masuk(source), sifatSurat: 'Rahasia' }, 'masuk')
        // Di bawah sumber nonaktif; Sangat Rahasia di atas plafon dan bukan kelas sumber.
        expect(opsi).toEqual({ biasa: true, terbatas: true, rahasia: false })
        expect(payload.klasifikasiKeamanan).toBe('rahasia')
        expect(screen.getByRole('button', { name: 'Simpan Arsip' })).toBeEnabled()
        // Pesan umum "hanya Super Admin" bertentangan dengan tombol simpan yang aktif.
        expect(screen.queryByText(PESAN_KELAS_TERBATAS_PERAN)).toBeNull()
        expect(bantuanKelas()).toHaveTextContent(
            'Kelas Rahasia dipertahankan sesuai surat sumber. Kelas yang lebih tinggi hanya dapat dipilih oleh Super Admin.',
        )
    })

    it('Admin Unit Kerja: kelas sumber Sangat Rahasia dipertahankan tanpa menyebut kelas yang lebih tinggi', async () => {
        mocks.user = adminUnit
        const { payload, opsi } = await kirim({ ...masuk(source), sifatSurat: 'Sangat Rahasia' }, 'masuk')
        expect(opsi).toEqual({ biasa: true, terbatas: true, sangat_rahasia: false })
        expect(payload.klasifikasiKeamanan).toBe('sangat_rahasia')
        expect(bantuanKelas().textContent).toBe('Kelas Sangat Rahasia dipertahankan sesuai surat sumber.')
    })

    it('staf: kelas sumber Terbatas dipertahankan, Biasa nonaktif karena di bawah sumber', async () => {
        mocks.user = { id: 'u-staf', role: 'staff', unitKerjaId: 'sesditjen' }
        const { payload, opsi } = await kirim({ ...source, klasifikasiKeamanan: null, sifatSurat: 'biasa' }, 'keluar')
        expect(opsi).toEqual({ biasa: true, terbatas: false })
        expect(payload.klasifikasiKeamanan).toBe('terbatas')
        expect(bantuanKelas()).toHaveTextContent(
            'Kelas Terbatas dipertahankan sesuai surat sumber. Kelas yang lebih tinggi hanya dapat dipilih oleh Super Admin.',
        )
    })
})

describe('peringatan permanen sebelum Simpan Arsip', () => {
    const buka = () => {
        const onArchive = vi.fn().mockResolvedValue(undefined)
        const onOpenChange = vi.fn()
        const view = render(<MemoryRouter><ArchiveDialog open onOpenChange={onOpenChange} suratData={source} onArchive={onArchive} /></MemoryRouter>)
        return { onArchive, onOpenChange, view }
    }

    it('menjelaskan apa yang terkunci sebelum arsip disimpan', () => {
        buka()
        const peringatan = screen.getByRole('note')
        expect(peringatan).toHaveTextContent('Pengarsipan bersifat permanen.')
        expect(peringatan).toHaveTextContent('Setelah disimpan, surat ini terkunci: tidak dapat diubah atau dihapus, dan berkas PDF tidak dapat lagi ditambahkan dari halaman surat. Pengarsipan tidak dapat dibatalkan, dan arsip tidak dapat dihapus dari aplikasi.')
        expect(screen.getByRole('checkbox', { name: PERNYATAAN_PERMANEN })).not.toBeChecked()
    })

    it('tanpa centang, arsip tidak disimpan dan pengguna diberi tahu', async () => {
        const { onArchive, onOpenChange } = buka()
        fireEvent.submit(document.getElementById('archive-form'))
        expect(await screen.findByText('Centang pernyataan di atas sebelum menyimpan arsip.')).toHaveAttribute('role', 'alert')
        expect(screen.getByRole('checkbox', { name: PERNYATAAN_PERMANEN })).toHaveFocus()
        expect(onArchive).not.toHaveBeenCalled()
        expect(onOpenChange).not.toHaveBeenCalled()

        setujuiPermanen()
        expect(screen.queryByText('Centang pernyataan di atas sebelum menyimpan arsip.')).not.toBeInTheDocument()
        fireEvent.submit(document.getElementById('archive-form'))
        await waitFor(() => expect(onArchive).toHaveBeenCalledTimes(1))
    })

    it('centang tidak terbawa ke surat berikutnya', async () => {
        const { onArchive, onOpenChange, view } = buka()
        setujuiPermanen()
        view.rerender(<MemoryRouter><ArchiveDialog open onOpenChange={onOpenChange} suratData={{ ...source, id: 'surat-2', nomorSurat: '002/2026' }} onArchive={onArchive} /></MemoryRouter>)
        await waitFor(() => expect(screen.getByRole('checkbox', { name: PERNYATAAN_PERMANEN })).not.toBeChecked())
    })
})
