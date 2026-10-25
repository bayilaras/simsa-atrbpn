import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { DetailHeader } from '../DetailHeader'
import { StatusSidebar } from '../StatusSidebar'

afterEach(cleanup)
const dasar = { id: 'sm-1', nomorSurat: 'B-12/2026', perihal: 'Permohonan', isArchived: false }

describe('DetailHeader', () => {
    const tampil = (surat, extra = {}) => render(
        <MemoryRouter>
            <DetailHeader surat={surat} onBack={() => {}} onEdit={() => {}} onDistribute={() => {}} onArchive={() => {}} isAdmin {...extra} />
        </MemoryRouter>,
    )

    it('edit/arsip disembunyikan bila akses bukan pemilik; menu tindak lanjut dari server tetap tampil', () => {
        tampil({ ...dasar, aksesMelalui: 'peserta', aksiDiizinkan: ['saya_balas', 'terima'] })
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Arsipkan' })).toBeNull()
        expect(screen.getAllByRole('button', { name: /Tindak Lanjut/ }).length).toBeGreaterThan(0)
        expect(screen.queryByRole('button', { name: /Balas Surat/ })).toBeNull()
    })

    it('pemilik tetap mendapat edit dan arsip (respons lama tanpa aksesMelalui dianggap pemilik)', () => {
        tampil({ ...dasar })
        expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0)
        expect(screen.getAllByRole('button', { name: 'Arsipkan' }).length).toBeGreaterThan(0)
    })

    // F2: test di atas memakai aksesMelalui 'peserta', jadi `milik` saja sudah
    // menyembunyikan Edit/Arsipkan -- mengganti `aksi.includes('edit')` dengan
    // `true` di DetailHeader.jsx tetap lolos. Kasus di bawah memaksa pemilik
    // (milik === true) TANPA 'edit'/'arsipkan' di aksiDiizinkan, sehingga
    // hanya gerbang aksiDiizinkan yang bisa menyembunyikannya.
    it('pemilik tetap disembunyikan edit/arsip bila aksiDiizinkan dari server tidak menyertakannya', () => {
        tampil({ ...dasar, aksesMelalui: 'owner', aksiDiizinkan: ['terima'] })
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Arsipkan' })).toBeNull()
    })

    it('pemilik mendapat edit dan arsip bila aksiDiizinkan dari server menyertakan keduanya', () => {
        tampil({ ...dasar, aksesMelalui: 'owner', aksiDiizinkan: ['edit', 'arsipkan'] })
        expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0)
        expect(screen.getAllByRole('button', { name: 'Arsipkan' }).length).toBeGreaterThan(0)
    })

    // P2 selalu mengirim aksiDiizinkan sebagai array (bisa kosong []), tidak
    // pernah field yang absen -- jadi ini kasus nyata yang harus disembunyikan,
    // beda dari test fallback "respons lama" di atas yang mati terhadap P2.
    it('respons nyata P2 (aksiDiizinkan: []) menyembunyikan edit/arsip meski pemilik', () => {
        tampil({ ...dasar, aksiDiizinkan: [] })
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Arsipkan' })).toBeNull()
    })

    it('meneruskan handler tindak lanjut (onTerima) berbasis callback ke TindakLanjutMenu', async () => {
        const onTerima = vi.fn()
        tampil({ ...dasar, aksiDiizinkan: ['terima'] }, { onTerima })
        const [tombolMenu] = screen.getAllByRole('button', { name: /Tindak Lanjut/ })
        fireEvent.keyDown(tombolMenu, { key: 'Enter' })
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Terima Disposisi' }))
        expect(onTerima).toHaveBeenCalledTimes(1)
    })
})

describe('StatusSidebar', () => {
    const tampil = (surat, extra = {}) => render(
        <MemoryRouter>
            <StatusSidebar surat={surat} onEdit={() => {}} onDistribute={() => {}} onArchive={() => {}} isAdmin {...extra} />
        </MemoryRouter>,
    )

    it('edit/arsip disembunyikan bila akses bukan pemilik; menu tindak lanjut dari server tetap tampil', () => {
        tampil({ ...dasar, aksesMelalui: 'peserta', aksiDiizinkan: ['saya_balas', 'terima'] })
        expect(screen.queryByRole('button', { name: 'Edit Surat' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Arsipkan' })).toBeNull()
        expect(screen.getByRole('button', { name: /Tindak Lanjut/ })).toBeInTheDocument()
    })

    it('pemilik tetap disembunyikan edit/arsip bila aksiDiizinkan dari server tidak menyertakannya', () => {
        tampil({ ...dasar, aksesMelalui: 'owner', aksiDiizinkan: ['terima'] })
        expect(screen.queryByRole('button', { name: 'Edit Surat' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Arsipkan' })).toBeNull()
    })

    it('pemilik mendapat edit dan arsip bila aksiDiizinkan dari server menyertakan keduanya', () => {
        tampil({ ...dasar, aksesMelalui: 'owner', aksiDiizinkan: ['edit', 'arsipkan'] })
        expect(screen.getByRole('button', { name: 'Edit Surat' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Arsipkan' })).toBeInTheDocument()
    })

    it('kartu Aksi Cepat tersembunyi bila bukan admin dan tidak ada aksiDiizinkan', () => {
        tampil({ ...dasar, aksiDiizinkan: [] }, { isAdmin: false })
        expect(screen.queryByText('Aksi Cepat')).toBeNull()
    })

    it('kartu Aksi Cepat tetap tampil untuk peserta non-admin yang diberi satu aksi server', () => {
        tampil({ ...dasar, aksesMelalui: 'peserta', aksiDiizinkan: ['saya_balas'] }, { isAdmin: false })
        expect(screen.getByText('Aksi Cepat')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Tindak Lanjut/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Edit Surat' })).toBeNull()
    })

    it('meneruskan handler tindak lanjut (onPenyelesaian) berbasis callback ke TindakLanjutMenu', async () => {
        const onPenyelesaian = vi.fn()
        tampil({ ...dasar, aksiDiizinkan: ['penyelesaian'] }, { onPenyelesaian })
        fireEvent.keyDown(screen.getByRole('button', { name: /Tindak Lanjut/ }), { key: 'Enter' })
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Penyelesaian' }))
        expect(onPenyelesaian).toHaveBeenCalledTimes(1)
    })
})
