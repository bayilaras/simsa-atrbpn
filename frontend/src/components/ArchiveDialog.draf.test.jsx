import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ArchiveDialog } from './ArchiveDialog'
import { bacaDrafIsian, kunciDrafIsian } from '@/lib/draf-isian'
import { adaPerubahanBelumDisimpan } from '@/lib/perubahan-belum-disimpan'

// Isian dialog Arsipkan Surat yang belum disimpan bertahan di sessionStorage
// tab ini per surat, ditawarkan saat dialog dibuka lagi, dan dihapus saat Batal
// atau saat arsip tersimpan.
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-sa', role: 'super_admin' } }) }))
vi.mock('@/components/KlasifikasiPicker', () => ({ KlasifikasiPicker: ({ id }) => <button type="button" id={id}>Pilih klasifikasi</button> }))
vi.mock('./archive-registration-validation', () => ({ validateArchiveRegistration: () => '' }))

const surat = { id: 'surat-1', nomorSurat: '001/2026', perihal: 'Arsip surat', tanggalSurat: '2026-09-12', sifatSurat: 'biasa' }
const KUNCI = kunciDrafIsian({ userId: 'u-sa', formulir: 'arsip-surat-masuk', idRekod: 'surat-1' })

afterEach(cleanup)

function tampil(props = {}) {
    return render(<MemoryRouter><ArchiveDialog open onOpenChange={vi.fn()} suratData={surat} suratType="masuk" onArchive={vi.fn()} {...props} /></MemoryRouter>)
}

async function isiPic() {
    fireEvent.change(screen.getByLabelText(/^Penanggung Jawab/), { target: { value: 'Petugas Arsip' } })
    fireEvent.change(screen.getAllByLabelText(/^No\. Filing Cabinet/)[0], { target: { value: 'FC-07' } })
    await waitFor(() => expect(bacaDrafIsian(KUNCI)?.data.formData.personInCharge).toBe('Petugas Arsip'), { timeout: 3000 })
}

describe('draf dialog Arsipkan Surat', () => {
    it('ditawarkan kembali saat dialog dibuka lagi dan dapat dipulihkan', async () => {
        const pertama = tampil()
        await isiPic()
        expect(adaPerubahanBelumDisimpan()).toBe(true)
        pertama.unmount()
        expect(adaPerubahanBelumDisimpan()).toBe(false)

        tampil()
        const dialog = await screen.findByRole('alertdialog', { name: 'Pulihkan isian yang belum disimpan?' })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Pulihkan isian' }))
        await waitFor(() => expect(screen.getByLabelText(/^Penanggung Jawab/)).toHaveValue('Petugas Arsip'))
        expect(screen.getAllByLabelText(/^No\. Filing Cabinet/)[0]).toHaveValue('FC-07')
    })

    it('Batal membuang isian dan drafnya', async () => {
        const onOpenChange = vi.fn()
        tampil({ onOpenChange })
        await isiPic()
        fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
        expect(onOpenChange).toHaveBeenCalledWith(false)
        expect(bacaDrafIsian(KUNCI)).toBeNull()
    })

    it('dihapus setelah arsip tersimpan', async () => {
        const onArchive = vi.fn().mockResolvedValue(undefined)
        tampil({ onArchive })
        await isiPic()
        fireEvent.click(screen.getByRole('checkbox', { name: 'Saya memahami bahwa pengarsipan ini permanen dan tidak dapat dibatalkan.' }))
        fireEvent.submit(document.getElementById('archive-form'))
        await waitFor(() => expect(onArchive).toHaveBeenCalled())
        await waitFor(() => expect(bacaDrafIsian(KUNCI)).toBeNull())
    })
})
