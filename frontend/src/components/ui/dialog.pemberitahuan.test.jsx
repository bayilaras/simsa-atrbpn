import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'
import { Toaster } from './toaster'
import { PemberitahuanVersiBaru } from '@/components/PemberitahuanVersiBaru'
import { toast } from '@/hooks/use-toast'

function DialogContoh({ onInteractOutside }) {
    const [open, setOpen] = useState(true)
    return (
        <>
            <button type="button">Tombol halaman</button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent onInteractOutside={onInteractOutside}>
                    <DialogTitle>Formulir contoh</DialogTitle>
                    <DialogDescription>Isian contoh</DialogDescription>
                    <input aria-label="Catatan" />
                </DialogContent>
            </Dialog>
        </>
    )
}

// Radix baru mendengarkan klik di luar dialog setelah satu putaran timer, dan
// memutuskan penutupan setelah klik selesai.
const jeda = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))

async function tampil(tambahan, props) {
    render(<><DialogContoh {...props} />{tambahan}</>)
    await screen.findByRole('dialog', { name: 'Formulir contoh' })
    await jeda()
}

async function tekan(elemen) {
    fireEvent.pointerDown(elemen)
    fireEvent.mouseDown(elemen)
    fireEvent.pointerUp(elemen)
    fireEvent.mouseUp(elemen)
    fireEvent.click(elemen)
    await jeda()
}

const pembaruanTersedia = () => ({
    keadaan: () => ({ tersedia: true }),
    dengarkan: () => () => {},
    muatUlangVersiBaru: vi.fn(),
})

afterEach(cleanup)

describe('dialog dan pemberitahuan aplikasi', () => {
    it('klik di luar dialog tetap menutup dialog', async () => {
        await tampil(null)
        await tekan(screen.getByRole('button', { name: 'Tombol halaman', hidden: true }))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    })

    it('menekan toast tidak menutup dialog dan toast tetap dapat ditutup', async () => {
        await tampil(<Toaster />)
        fireEvent.change(screen.getByLabelText('Catatan'), { target: { value: 'sudah diisi' } })
        act(() => { toast({ title: 'Tersimpan', description: 'Data tersimpan', duration: 0 }) })
        const tutupToast = await screen.findByRole('button', { name: 'Tutup pemberitahuan', hidden: true })
        // Wadah dan tiap toast ditandai: toast yang ditutup dilepas dari wadahnya
        // sebelum dialog memeriksa klik itu.
        expect(screen.getByRole('region', { name: 'Pemberitahuan aplikasi', hidden: true })).toHaveAttribute('data-wilayah-pemberitahuan')
        expect(tutupToast.closest('[role="status"]')).toHaveAttribute('data-wilayah-pemberitahuan')

        await tekan(screen.getByText('Data tersimpan'))
        expect(screen.getByRole('dialog', { name: 'Formulir contoh' })).toBeInTheDocument()

        await tekan(tutupToast)
        expect(screen.getByRole('dialog', { name: 'Formulir contoh' })).toBeInTheDocument()
        expect(screen.getByLabelText('Catatan')).toHaveValue('sudah diisi')
        expect(screen.queryByText('Data tersimpan')).toBeNull()
    })

    it('pemberitahuan yang hilang saat diklik tetap tidak menutup dialog', async () => {
        await tampil(null)
        const wadah = document.createElement('div')
        const pemberitahuan = document.createElement('div')
        pemberitahuan.setAttribute('data-wilayah-pemberitahuan', '')
        const tombol = document.createElement('button')
        pemberitahuan.append(tombol)
        wadah.append(pemberitahuan)
        document.body.append(wadah)
        // Seperti toast: tombol tutupnya melepas toast sebelum klik sampai ke dokumen.
        tombol.addEventListener('click', () => pemberitahuan.remove())

        await tekan(tombol)
        wadah.remove()

        expect(pemberitahuan.isConnected).toBe(false)
        expect(screen.getByRole('dialog', { name: 'Formulir contoh' })).toBeInTheDocument()
    })

    it('handler klik-luar milik dialog tidak dijalankan untuk pemberitahuan', async () => {
        const onInteractOutside = vi.fn(event => event.preventDefault())
        await tampil(<Toaster />, { onInteractOutside })
        act(() => { toast({ title: 'Info', duration: 0 }) })
        await tekan(await screen.findByText('Info'))
        expect(onInteractOutside).not.toHaveBeenCalled()

        await tekan(screen.getByRole('button', { name: 'Tombol halaman', hidden: true }))
        expect(onInteractOutside).toHaveBeenCalledOnce()
        expect(screen.getByRole('dialog', { name: 'Formulir contoh' })).toBeInTheDocument()
        await tekan(screen.getByRole('button', { name: 'Tutup pemberitahuan', hidden: true }))
    })

    it('kotak versi baru dapat ditekan selagi dialog terbuka tanpa menutup dialog', async () => {
        const pembaruan = pembaruanTersedia()
        await tampil(<PemberitahuanVersiBaru pembaruan={pembaruan} />)
        const muatUlang = screen.getByRole('button', { name: 'Muat ulang', hidden: true })
        const kotak = muatUlang.closest('[data-wilayah-pemberitahuan]')
        expect(kotak).not.toBeNull()
        // Dialog mematikan klik pada body; kotak ini menyalakannya kembali untuk dirinya.
        expect(document.body.style.pointerEvents).toBe('none')
        expect(kotak).toHaveClass('pointer-events-auto')

        await tekan(muatUlang)
        expect(pembaruan.muatUlangVersiBaru).toHaveBeenCalledOnce()
        expect(screen.getByRole('dialog', { name: 'Formulir contoh' })).toBeInTheDocument()

        // "Nanti" menyembunyikan kotak; dialog tetap terbuka.
        await tekan(screen.getByRole('button', { name: 'Nanti', hidden: true }))
        expect(screen.queryByRole('button', { name: 'Muat ulang', hidden: true })).toBeNull()
        expect(screen.getByRole('dialog', { name: 'Formulir contoh' })).toBeInTheDocument()
    })
})
