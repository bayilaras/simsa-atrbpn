import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DistributeDialog, PESAN_TERKENDALI } from './DistributeDialog'
import { hariIniJakarta } from '@/lib/tindak-lanjut'

const mocks = vi.hoisted(() => ({ getDistributableUnits: vi.fn(), getOpsi: vi.fn(), distributeMany: vi.fn(), toast: vi.fn() }))
vi.mock('@/services/distribution.service', () => ({ default: mocks, distributionService: mocks }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))

const surat = { id: 'sm-1', nomorSurat: 'B-1/2026', perihal: 'Permohonan data', sifatSurat: 'biasa' }
const tampil = (extra = {}) => render(<DistributeDialog open onOpenChange={vi.fn()} suratData={{ ...surat, ...extra }} sourceUnitId="sesditjen" onSuccess={vi.fn()} />)

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDistributableUnits.mockResolvedValue([
        { id: 'dir_bppt', name: 'Dit. BPPT', unitType: 'direktorat' },
        { id: 'dir_ptep', name: 'Dit. PTEP', unitType: 'direktorat' },
        { id: 'bagian_umum', name: 'Bagian Umum', unitType: 'bagian' },
    ])
    mocks.getOpsi.mockResolvedValue({ instruksi: ['Untuk diketahui', 'Mohon dikoordinasikan'], jalurAksesTerkendali: false })
    mocks.distributeMany.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }])
})
afterEach(cleanup)

describe('DistributeDialog', () => {
    it('multi-target dengan penanggung jawab, batas waktu, dan chip instruksi; bagian tidak ditawarkan', async () => {
        tampil()
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Dit. BPPT' }))
        fireEvent.click(screen.getByRole('checkbox', { name: 'Dit. PTEP' }))
        expect(screen.queryByRole('checkbox', { name: 'Bagian Umum' })).toBeNull()
        fireEvent.click(screen.getByRole('radio', { name: 'Dit. BPPT' }))
        fireEvent.change(screen.getByLabelText('Batas waktu'), { target: { value: '2026-10-01' } })
        fireEvent.click(screen.getByRole('button', { name: 'Untuk diketahui' }))
        fireEvent.click(screen.getByRole('button', { name: 'Mohon dikoordinasikan' }))
        fireEvent.click(screen.getByRole('button', { name: /Disposisikan/ }))
        await waitFor(() => expect(mocks.distributeMany).toHaveBeenCalledWith({
            suratMasukId: 'sm-1', sourceUnitId: 'sesditjen',
            targets: [
                { unitKerjaId: 'dir_bppt', penanggungJawab: true, batasWaktu: '2026-10-01' },
                { unitKerjaId: 'dir_ptep', penanggungJawab: false, batasWaktu: '2026-10-01' },
            ],
            instruksi: 'Untuk diketahui\nMohon dikoordinasikan',
        }))
    })

    // Frontend M1: tanggal lampau (WIB) ditolak server; input membatasinya sejak awal.
    it('Batas waktu tidak dapat diisi sebelum hari ini (Asia/Jakarta)', async () => {
        tampil()
        await screen.findByRole('checkbox', { name: 'Dit. BPPT' })
        expect(screen.getByLabelText('Batas waktu')).toHaveAttribute('min', hariIniJakarta())
        expect(hariIniJakarta(new Date('2026-09-30T18:30:00Z'))).toBe('2026-10-01')
    })

    it('surat terkendali diblokir selama jalur akses disposisi mati', async () => {
        tampil({ sifatSurat: 'Rahasia' })
        expect(await screen.findByText(PESAN_TERKENDALI)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Disposisikan/ })).toBeDisabled()
    })

    it('disposisi yang ditolak server menampilkan pesannya, bukan nama kelas galat', async () => {
        const body = { success: false, error: 'ValidationError', message: 'Surat sudah didistribusikan ke unit ini', code: 'VALIDATION_ERROR' }
        mocks.distributeMany.mockRejectedValue(Object.assign(new Error(body.message), { status: 400, data: body, response: { status: 400, data: body } }))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        tampil()
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Dit. BPPT' }))
        fireEvent.click(screen.getByRole('button', { name: /Disposisikan/ }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
            description: 'Surat sudah didistribusikan ke unit ini', variant: 'destructive',
        })))
        console.error.mockRestore()
    })

    describe('isian saat dialog tertutup', () => {
        function Halaman({ onSuccess }) {
            const [open, setOpen] = useState(true)
            const [suratData, setSuratData] = useState(surat)
            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>Buka disposisi</button>
                    <button type="button" onClick={() => { setSuratData({ ...surat, id: 'sm-2', nomorSurat: 'B-2/2026' }); setOpen(true) }}>Buka surat lain</button>
                    <DistributeDialog open={open} onOpenChange={setOpen} suratData={suratData} sourceUnitId="sesditjen" onSuccess={onSuccess} />
                </>
            )
        }

        async function isi() {
            fireEvent.click(await screen.findByRole('checkbox', { name: 'Dit. BPPT' }))
            fireEvent.click(screen.getByRole('radio', { name: 'Dit. BPPT' }))
            fireEvent.change(screen.getByLabelText('Batas waktu'), { target: { value: '2026-12-01' } })
            fireEvent.change(screen.getByLabelText('Instruksi / Catatan'), { target: { value: 'Mohon telaah' } })
        }

        const bukaLagi = (nama = 'Buka disposisi') => fireEvent.click(screen.getByRole('button', { name: nama, hidden: true }))

        it('tertutup tanpa sengaja (Esc): unit tujuan dan instruksi masih ada saat dibuka lagi', async () => {
            render(<Halaman />)
            await isi()
            fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

            bukaLagi()
            expect(await screen.findByRole('checkbox', { name: 'Dit. BPPT' })).toBeChecked()
            expect(screen.getByRole('radio', { name: 'Dit. BPPT' })).toBeChecked()
            expect(screen.getByLabelText('Batas waktu')).toHaveValue('2026-12-01')
            expect(screen.getByLabelText('Instruksi / Catatan')).toHaveValue('Mohon telaah')
        })

        it('tombol tutup (X) juga mempertahankan isian', async () => {
            render(<Halaman />)
            await isi()
            fireEvent.click(screen.getByRole('button', { name: 'Tutup' }))
            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

            bukaLagi()
            expect(await screen.findByRole('checkbox', { name: 'Dit. BPPT' })).toBeChecked()
            expect(screen.getByLabelText('Instruksi / Catatan')).toHaveValue('Mohon telaah')
        })

        it('Batal membuang isian', async () => {
            render(<Halaman />)
            await isi()
            fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

            bukaLagi()
            expect(await screen.findByRole('checkbox', { name: 'Dit. BPPT' })).not.toBeChecked()
            expect(screen.getByLabelText('Batas waktu')).toHaveValue('')
            expect(screen.getByLabelText('Instruksi / Catatan')).toHaveValue('')
        })

        it('disposisi yang terkirim mengosongkan isian', async () => {
            const onSuccess = vi.fn()
            render(<Halaman onSuccess={onSuccess} />)
            await isi()
            fireEvent.click(screen.getByRole('button', { name: /Disposisikan/ }))
            await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

            bukaLagi()
            expect(await screen.findByRole('checkbox', { name: 'Dit. BPPT' })).not.toBeChecked()
            expect(screen.getByLabelText('Instruksi / Catatan')).toHaveValue('')
        })

        it('isian satu surat tidak terbawa ke surat lain', async () => {
            render(<Halaman />)
            await isi()
            fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

            bukaLagi('Buka surat lain')
            expect(await screen.findByText('B-2/2026')).toBeInTheDocument()
            expect(await screen.findByRole('checkbox', { name: 'Dit. BPPT' })).not.toBeChecked()
            expect(screen.getByLabelText('Instruksi / Catatan')).toHaveValue('')
        })
    })

    it('jalur akses menyala: info permohonan grant disposisi', async () => {
        mocks.getOpsi.mockResolvedValue({ instruksi: [], jalurAksesTerkendali: true })
        tampil({ sifatSurat: 'rahasia' })
        expect(await screen.findByText(/Permohonan akses disposisi akan diajukan/)).toBeInTheDocument()
    })
})
