import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet'

function SheetContoh() {
    const [open, setOpen] = useState(true)
    return (
        <>
            <button type="button">Tombol halaman</button>
            <div data-wilayah-pemberitahuan="">
                <button type="button">Tutup pemberitahuan</button>
            </div>
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetContent>
                    <SheetTitle>Panel contoh</SheetTitle>
                    <SheetDescription>Isian contoh</SheetDescription>
                    <input aria-label="Catatan" />
                </SheetContent>
            </Sheet>
        </>
    )
}

// Radix starts listening for outside clicks one timer tick after mount and
// decides whether to close after the click has finished.
const jeda = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))

async function tampil() {
    render(<SheetContoh />)
    await screen.findByRole('dialog', { name: 'Panel contoh' })
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

afterEach(cleanup)

describe('panel samping dan pemberitahuan aplikasi', () => {
    it('klik di luar panel tetap menutup panel', async () => {
        await tampil()
        await tekan(screen.getByRole('button', { name: 'Tombol halaman', hidden: true }))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    })

    it('menekan pemberitahuan tidak menutup panel', async () => {
        await tampil()
        await tekan(screen.getByRole('button', { name: 'Tutup pemberitahuan', hidden: true }))
        expect(screen.getByRole('dialog', { name: 'Panel contoh' })).toBeTruthy()
    })
})
