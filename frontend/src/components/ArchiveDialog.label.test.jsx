import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ArchiveDialog } from './ArchiveDialog'

// Label dialog Arsipkan Surat terhubung ke isiannya: pembaca layar menyebut
// nama isian dan teks bantuannya, dan klik pada label memindahkan fokus.
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-sa', role: 'super_admin' } }) }))
vi.mock('@/components/KlasifikasiPicker', () => ({
    KlasifikasiPicker: ({ id }) => <button type="button" id={id}>Pilih klasifikasi</button>,
}))

const surat = { id: 'surat-1', nomorSurat: '001/2026', perihal: 'Arsip surat', tanggalSurat: '2026-09-12', sifatSurat: 'biasa' }

afterEach(cleanup)

function tampil() {
    render(<MemoryRouter><ArchiveDialog open onOpenChange={vi.fn()} suratData={surat} suratType="masuk" onArchive={vi.fn()} /></MemoryRouter>)
}

describe('label dialog Arsipkan Surat', () => {
    it('menghubungkan label dan teks bantuan ke isian berkas', () => {
        tampil()
        const nomor = screen.getByLabelText(/^Nomor Berkas/)
        expect(nomor).toHaveValue('001/2026')
        expect(nomor).toHaveAccessibleDescription('Otomatis terisi dari nomor surat, dapat diedit jika perlu')
        expect(screen.getByLabelText(/^Uraian Informasi Berkas/)).toHaveValue('Arsip surat')
        expect(screen.getByLabelText(/^Kurun Waktu\*?$/)).toHaveAttribute('type', 'date')
        expect(screen.getByLabelText('Kurun Waktu sampai tanggal')).toHaveAttribute('type', 'date')
        expect(screen.getByLabelText(/^Penanggung Jawab/)).toHaveAccessibleDescription('Nama yang bertanggung jawab atas pengarsipan')
        expect(screen.getByLabelText(/^Keterangan Tambahan/).tagName).toBe('TEXTAREA')
        expect(screen.getByLabelText(/^Klasifikasi Arsip & Jadwal Retensi/)).toHaveTextContent('Pilih klasifikasi')
    })

    it('memberi setiap item arsip isian berlabel dengan id yang berbeda', () => {
        tampil()
        fireEvent.click(screen.getByRole('button', { name: /Tambah Item/ }))
        const uraian = screen.getAllByLabelText(/^Uraian Informasi Item/)
        expect(uraian).toHaveLength(2)
        expect(uraian[0].id).not.toBe(uraian[1].id)
        expect(uraian[0]).toHaveValue('Arsip surat')
        expect(screen.getAllByLabelText(/^No\. Filing Cabinet/)).toHaveLength(2)
        expect(screen.getAllByLabelText(/^No\. Laci/)).toHaveLength(2)
        expect(screen.getAllByLabelText(/^No\. Folder/)).toHaveLength(2)
        expect(screen.getAllByLabelText(/^Tanggal Arsip/)[0]).toHaveValue('2026-09-12')
        expect(screen.getByRole('button', { name: 'Hapus item arsip #2' })).toBeInTheDocument()
    })
})
