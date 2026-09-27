import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { DetailHeader } from '../DetailHeader'

afterEach(cleanup)
const dasar = { id: 'sm-1', nomorSurat: 'B-12/2026', perihal: 'Permohonan', isArchived: false }
const tampil = (surat) => render(<MemoryRouter><DetailHeader surat={surat} onBack={() => {}} onEdit={() => {}} onDistribute={() => {}} onArchive={() => {}} isAdmin /></MemoryRouter>)

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
