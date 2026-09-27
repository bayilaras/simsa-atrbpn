import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DistributeDialog, PESAN_TERKENDALI } from './DistributeDialog'

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

    it('surat terkendali diblokir selama jalur akses disposisi mati', async () => {
        tampil({ sifatSurat: 'Rahasia' })
        expect(await screen.findByText(PESAN_TERKENDALI)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Disposisikan/ })).toBeDisabled()
    })

    it('jalur akses menyala: info permohonan grant disposisi', async () => {
        mocks.getOpsi.mockResolvedValue({ instruksi: [], jalurAksesTerkendali: true })
        tampil({ sifatSurat: 'rahasia' })
        expect(await screen.findByText(/Permohonan akses disposisi akan diajukan/)).toBeInTheDocument()
    })
})
