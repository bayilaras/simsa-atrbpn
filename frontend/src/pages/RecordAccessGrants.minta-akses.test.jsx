import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import RecordAccessGrants from './RecordAccessGrants'

const mocks = vi.hoisted(() => ({ mine: vi.fn(), review: vi.fn(), request: vi.fn(), toast: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'operator', role: 'admin_unit' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/record-access-grant.service', () => ({
    default: { listMine: mocks.mine, listForReview: mocks.review, request: mocks.request },
}))

const ID = '30000000-0000-4000-8000-000000000002'
const TUJUAN = 'Menindaklanjuti disposisi pimpinan atas surat ini.'

function renderHalaman(state) {
    return render(
        <MemoryRouter initialEntries={[{ pathname: '/record-access-grants', state }]}>
            <RecordAccessGrants />
        </MemoryRouter>,
    )
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.mine.mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } })
    mocks.request.mockResolvedValue({ success: true })
})
afterEach(cleanup)

describe('permohonan akses dari halaman detail', () => {
    it('terbuka dengan rekaman terisi dan terkirim tanpa mengetik ID', async () => {
        renderHalaman({ mintaAkses: { entityType: 'surat_masuk', entityId: ID, nomor: 'SM-2/RHS/2026', perihal: 'Perihal terbatas' } })

        const dialog = await screen.findByRole('dialog', { name: 'Minta akses rekod terkendali' })
        expect(within(dialog).getByText('Rekod sudah dipilih dari halaman yang baru Anda buka. Jelaskan tujuan kedinasan yang dapat diverifikasi.')).toBeInTheDocument()
        const rekod = within(dialog).getByRole('group', { name: 'Rekod yang diminta' })
        expect(rekod).toHaveTextContent('Rekod yang diminta · Surat Masuk')
        expect(rekod).toHaveTextContent('SM-2/RHS/2026')
        expect(rekod).toHaveTextContent('Perihal terbatas')
        expect(within(dialog).queryByLabelText('ID rekod')).not.toBeInTheDocument()
        expect(within(dialog).queryByLabelText('Jenis rekod')).not.toBeInTheDocument()
        expect(dialog).not.toHaveTextContent(ID)

        const kirim = within(dialog).getByRole('button', { name: 'Kirim permohonan' })
        expect(kirim).toBeDisabled()
        fireEvent.change(within(dialog).getByLabelText('Tujuan kedinasan'), { target: { value: TUJUAN } })
        fireEvent.click(kirim)

        await waitFor(() => expect(mocks.request).toHaveBeenCalledWith({
            entityType: 'surat_masuk', entityId: ID, purpose: TUJUAN, accessMode: 'view',
        }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(mocks.toast).toHaveBeenCalledWith({ title: 'Permohonan dikirim', description: 'Akses belum aktif sampai disetujui pejabat berwenang.' })
    })

    it('tanpa nomor dan perihal tetap tidak menampilkan ID', async () => {
        renderHalaman({ mintaAkses: { entityType: 'arsip', entityId: ID, nomor: null, perihal: null } })

        const rekod = within(await screen.findByRole('dialog')).getByRole('group', { name: 'Rekod yang diminta' })
        expect(rekod).toHaveTextContent('Rekod yang diminta · Arsip')
        expect(rekod).toHaveTextContent('Rekod dari halaman yang baru Anda buka')
        expect(rekod).not.toHaveTextContent(ID)
    })

    it('setelah dibatalkan, tombol Minta akses membuka formulir isian biasa', async () => {
        renderHalaman({ mintaAkses: { entityType: 'surat_keluar', entityId: ID, nomor: 'ND-11/SES/2026', perihal: 'Nota dinas' } })

        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Batal' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: 'Minta akses' }))

        const dialog = await screen.findByRole('dialog')
        expect(within(dialog).getByLabelText('ID rekod')).toHaveValue('')
        expect(within(dialog).getByLabelText('ID rekod')).toHaveAttribute('placeholder', 'Kode di akhir alamat halaman detail')
        expect(within(dialog).queryByRole('group', { name: 'Rekod yang diminta' })).not.toBeInTheDocument()
        expect(within(dialog).getByText('Cara termudah: buka rekod dari daftarnya, lalu pilih Minta Akses agar formulir ini terisi sendiri. Bila mengisi sendiri, ID rekod adalah deret kode di akhir alamat halaman detailnya.')).toBeInTheDocument()
    })

    it.each([
        ['tanpa state', null],
        ['jenis tidak dikenal', { mintaAkses: { entityType: 'dosir', entityId: ID } }],
        ['tanpa id', { mintaAkses: { entityType: 'arsip', entityId: '' } }],
    ])('%s: formulir tidak terbuka sendiri', async (_nama, state) => {
        renderHalaman(state)
        await waitFor(() => expect(mocks.mine).toHaveBeenCalled())
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
})
