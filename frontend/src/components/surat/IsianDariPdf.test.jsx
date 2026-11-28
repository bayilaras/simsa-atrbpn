import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IsianDariPdf } from './IsianDariPdf'
import { PETA_ISIAN_SURAT_MASUK } from '@/lib/isian-dari-pdf'

const terbaca = {
    nomorSurat: 'B/123/CTH.01/XI/2026',
    tanggalSurat: '2026-11-12',
    perihal: 'Permintaan Data Contoh',
    pengirim: 'Direktur Jenderal Contoh',
    penerima: 'Kepala Kantor Wilayah Contoh',
    jenisSurat: null,
}
const kosong = { jenisSurat: '', nomorSurat: '', tanggalSurat: '', perihal: '', dari: '', kepada: '' }

function tampil(props = {}) {
    const onIsi = vi.fn()
    const onPilihBerkas = vi.fn()
    const view = render(
        <IsianDariPdf
            status="siap" terbaca={terbaca} peta={PETA_ISIAN_SURAT_MASUK} formData={kosong}
            namaBerkas="surat.pdf" onPilihBerkas={onPilihBerkas} onIsi={onIsi} {...props}
        />,
    )
    return { ...view, onIsi, onPilihBerkas }
}

afterEach(cleanup)

describe('panel Isi dari berkas PDF', () => {
    it('sebelum ada berkas menawarkan memilih PDF lebih dulu', () => {
        const { onPilihBerkas } = tampil({ status: 'diam', terbaca: null })
        expect(screen.getByText('Punya PDF suratnya?')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Pilih berkas PDF' }))
        expect(onPilihBerkas).toHaveBeenCalledOnce()
    })

    it('menyebut nama berkas selama membaca', () => {
        tampil({ status: 'membaca', terbaca: null })
        expect(screen.getByRole('status')).toHaveTextContent('Membaca isian dari berkas surat.pdf…')
        expect(screen.queryByRole('button')).toBeNull()
    })

    it.each([
        ['tanpa-teks', null, /tidak memuat teks yang dapat dibaca \(biasanya hasil pindai\)/],
        ['gagal', null, /Isian tidak dapat dibaca dari berkas ini/],
        ['siap', { nomorSurat: null, perihal: '' }, /Tidak ada isian yang terbaca dari berkas ini/],
    ])('status %s menjelaskan dan menyuruh mengisi seperti biasa', (status, hasil, pesan) => {
        tampil({ status, terbaca: hasil })
        expect(screen.getByRole('status')).toHaveTextContent(pesan)
        expect(screen.getByRole('status')).toHaveTextContent('Isi formulir seperti biasa.')
        expect(screen.queryByRole('button', { name: 'Isi formulir' })).toBeNull()
    })

    it('menampilkan isian terbaca dan mengisikan semuanya ke formulir kosong', () => {
        const { onIsi } = tampil()
        const daftar = within(screen.getByRole('region', { name: 'Isi dari berkas PDF' }))
        expect(daftar.getByText('B/123/CTH.01/XI/2026')).toBeInTheDocument()
        expect(daftar.getByText('12 November 2026')).toBeInTheDocument()
        expect(daftar.queryByText('Jenis Surat')).toBeNull()
        expect(daftar.getByText(/Sifat surat tidak diisi dari berkas/)).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Isi formulir' }))
        expect(onIsi.mock.calls).toEqual([
            ['nomorSurat', 'B/123/CTH.01/XI/2026'],
            ['tanggalSurat', '2026-11-12'],
            ['perihal', 'Permintaan Data Contoh'],
            ['dari', 'Direktur Jenderal Contoh'],
            ['kepada', 'Kepala Kantor Wilayah Contoh'],
        ])
        expect(screen.getByText('5 isian diisi dari berkas. Periksa kembali sebelum menyimpan.')).toBeInTheDocument()
    })

    it('tidak menimpa isian yang sudah diketik dan menandainya', () => {
        const { onIsi } = tampil({ formData: { ...kosong, perihal: 'Perihal ketikan petugas', tanggalSurat: '2026-11-12' } })
        expect(screen.getByText('(tidak diubah, sudah Anda isi)')).toBeInTheDocument()
        expect(screen.getByText('(sudah terisi)')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Isi formulir' }))
        expect(onIsi.mock.calls.map(([isian]) => isian)).toEqual(['nomorSurat', 'dari', 'kepada'])
        expect(screen.getByText('3 isian diisi dari berkas. Periksa kembali sebelum menyimpan.')).toBeInTheDocument()
    })

    it('tombol mati bila tidak ada lagi yang dapat diisi atau formulir sedang disimpan', () => {
        const terisi = { jenisSurat: '', nomorSurat: 'X', tanggalSurat: '2026-01-01', perihal: 'X', dari: 'X', kepada: 'X' }
        const view = tampil({ formData: terisi })
        expect(screen.getByRole('button', { name: 'Isi formulir' })).toBeDisabled()
        view.unmount()
        tampil({ disabled: true })
        expect(screen.getByRole('button', { name: 'Isi formulir' })).toBeDisabled()
    })

    it('hitungan isian yang diisi tidak terbawa ke berkas berikutnya', () => {
        const view = tampil()
        fireEvent.click(screen.getByRole('button', { name: 'Isi formulir' }))
        expect(screen.getByText(/5 isian diisi dari berkas/)).toBeInTheDocument()
        view.rerender(
            <IsianDariPdf
                status="siap" terbaca={{ ...terbaca, nomorSurat: 'B/124/CTH.01/XI/2026' }} peta={PETA_ISIAN_SURAT_MASUK}
                formData={kosong} namaBerkas="lain.pdf" onPilihBerkas={vi.fn()} onIsi={vi.fn()}
            />,
        )
        expect(screen.queryByText(/isian diisi dari berkas/)).toBeNull()
    })
})
