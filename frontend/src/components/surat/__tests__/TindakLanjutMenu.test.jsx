import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { TindakLanjutMenu } from '../TindakLanjutMenu'

let router
afterEach(() => { cleanup(); router?.dispose() })

function tampilkan(props) {
    router = createMemoryRouter([
        { path: '/', element: <TindakLanjutMenu {...props} /> },
        { path: '/surat/keluar/tambah', element: <h1>Form surat keluar</h1> },
    ])
    render(<RouterProvider router={router} />)
}
const bukaMenu = () => fireEvent.keyDown(screen.getByRole('button', { name: /Tindak Lanjut/ }), { key: 'Enter' })
const suratMasuk = { id: 'sm-1', nomorSurat: 'B-12/2026', perihal: 'Permohonan data', dari: 'Pemda', rangkaian: { kode: 'RS-2026-000001' }, distribusiUnitSaya: { id: 'd1', status: 'sent' } }

describe('TindakLanjutMenu', () => {
    it('tidak dirender tanpa aksi yang diizinkan server', () => {
        tampilkan({ jenis: 'surat_masuk', surat: suratMasuk, aksiDiizinkan: [] })
        expect(screen.queryByRole('button', { name: /Tindak Lanjut/ })).toBeNull()
    })

    it('Saya Balas membawa Nomor Referensi terkunci, disposisi aktif, dan preset balasan', async () => {
        tampilkan({ jenis: 'surat_masuk', surat: suratMasuk, aksiDiizinkan: ['saya_balas', 'buat_nota_dinas'] })
        bukaMenu()
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Saya Balas' }))
        await screen.findByRole('heading', { name: 'Form surat keluar' })
        expect(router.state.location.state).toEqual({
            tindakLanjut: { jenis: 'surat_masuk', suratId: 'sm-1', nomorSurat: 'B-12/2026', perihal: 'Permohonan data', rangkaianKode: 'RS-2026-000001', distribusiId: 'd1', jenisRelasi: 'balasan', terkunci: true },
            preset: { perihal: 'Balasan: Permohonan data', kepada: 'Pemda' },
        })
    })

    it('ND Penjelas hanya muncul bila diizinkan dan memakai relasi menjelaskan', async () => {
        tampilkan({ jenis: 'surat_keluar', surat: { id: 'sk-1', nomorSurat: 'KEP-7/2026', perihal: 'Penetapan tim', naskahDinas: 'Keputusan' }, aksiDiizinkan: ['buat_nd_penjelas'] })
        bukaMenu()
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Buat ND Penjelas' }))
        await screen.findByRole('heading', { name: 'Form surat keluar' })
        expect(router.state.location.state.tindakLanjut.jenisRelasi).toBe('menjelaskan')
        expect(router.state.location.state.preset).toEqual({ naskahDinas: 'Nota Dinas', perihal: 'Penjelasan Keputusan Nomor KEP-7/2026' })
    })

    it('aksi berbasis callback hanya tampil bila handler tersedia', async () => {
        const onTerima = vi.fn()
        tampilkan({ jenis: 'surat_masuk', surat: suratMasuk, aksiDiizinkan: ['terima', 'penyelesaian', 'disposisi'], onTerima })
        bukaMenu()
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Terima Disposisi' }))
        expect(onTerima).toHaveBeenCalled()
        bukaMenu()
        expect(screen.queryByRole('menuitem', { name: 'Penyelesaian' })).toBeNull()
        expect(screen.queryByRole('menuitem', { name: 'Disposisi ke Direktorat' })).toBeNull()
    })
})
