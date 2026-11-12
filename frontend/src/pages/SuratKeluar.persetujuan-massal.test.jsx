import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SuratKeluar from './SuratKeluar'

// Pilihan baris, pengajuan/persetujuan massal, dan penyaring kerja persetujuan
// pada daftar Surat Keluar.
const mocks = vi.hoisted(() => ({
    keluar: { getAll: vi.fn(), getStats: vi.fn(), delete: vi.fn(), archive: vi.fn() },
    approval: { getPending: vi.fn(), getEligibleApprovers: vi.fn(), submitBulk: vi.fn(), approveBulk: vi.fn() },
    toast: vi.fn(),
    role: 'admin_unit',
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({
    user: { id: 'admin-a', role: mocks.role, unitKerjaId: 'unit-a' },
    canWrite: () => mocks.role !== 'staff',
}) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({
    mode: 'full', capabilities: { metadata: true, files: false, fileUploads: false, externalIntegrations: false },
}) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/surat-keluar.service', () => ({ default: mocks.keluar }))
vi.mock('@/services/approval.service', () => ({ default: mocks.approval }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: async () => [] } }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ImportFromGDrive', () => ({ default: () => null }))
vi.mock('@/components/ImportFileDialog', () => ({ default: () => null }))

const baris = [
    { id: 'sk-1', nomorSurat: 'SK-1/2026', perihal: 'Draft sendiri satu', tanggalSurat: '2026-09-12', approvalStatus: 'draft', createdBy: 'admin-a', isArchived: false },
    { id: 'sk-2', nomorSurat: 'SK-2/2026', perihal: 'Perlu perbaikan sendiri', tanggalSurat: '2026-09-12', approvalStatus: 'rejected', createdBy: 'admin-a', isArchived: false },
    { id: 'sk-3', nomorSurat: 'SK-3/2026', perihal: 'Draft orang lain', tanggalSurat: '2026-09-12', approvalStatus: 'draft', createdBy: 'admin-b', isArchived: false },
    { id: 'sk-4', nomorSurat: 'SK-4/2026', perihal: 'Menunggu saya', tanggalSurat: '2026-09-12', approvalStatus: 'pending', currentApproverId: 'admin-a', createdBy: 'admin-b', isArchived: false },
    { id: 'sk-5', nomorSurat: 'SK-5/2026', perihal: 'Menunggu orang lain', tanggalSurat: '2026-09-12', approvalStatus: 'pending', currentApproverId: 'admin-c', createdBy: 'admin-a', isArchived: false },
    { id: 'sk-6', nomorSurat: 'SK-6/2026', perihal: 'Sudah disetujui', tanggalSurat: '2026-09-12', approvalStatus: 'approved', createdBy: 'admin-a', isArchived: false },
]

async function tampil(route = '/surat/keluar') {
    render(<MemoryRouter initialEntries={[route]}><SuratKeluar /></MemoryRouter>)
    await screen.findByText('SK-1/2026')
}
const centang = (nama) => screen.getByRole('checkbox', { name: nama })

beforeEach(() => {
    vi.clearAllMocks()
    mocks.role = 'admin_unit'
    mocks.keluar.getAll.mockResolvedValue({ success: true, data: baris, pagination: { page: 1, limit: 10, total: 6, totalPages: 1 } })
    mocks.keluar.getStats.mockResolvedValue({ total: 6, diarsipkan: 0 })
    mocks.approval.getPending.mockResolvedValue([{ requestId: 'req-4', suratId: 'sk-4', nomorSurat: 'SK-4/2026', perihal: 'Menunggu saya' }])
    mocks.approval.getEligibleApprovers.mockResolvedValue([{ id: 'approver-1', name: 'Bu Penyetuju', role: 'admin_unit' }])
})
afterEach(cleanup)

describe('pilihan baris pada daftar surat keluar', () => {
    it('hanya menawarkan kotak pilih untuk surat yang dapat diajukan atau disetujui pengguna', async () => {
        await tampil()
        expect(centang('Pilih surat SK-1/2026')).toBeInTheDocument()
        expect(centang('Pilih surat SK-2/2026')).toBeInTheDocument()
        expect(centang('Pilih surat SK-4/2026')).toBeInTheDocument()
        for (const nomor of ['SK-3/2026', 'SK-5/2026', 'SK-6/2026']) {
            expect(screen.queryByRole('checkbox', { name: `Pilih surat ${nomor}` })).toBeNull()
        }
        expect(screen.queryByRole('region', { name: 'Tindakan untuk surat terpilih' })).toBeNull()
    })

    it('"Pilih semua di halaman ini" memilih semua yang memenuhi syarat dan memisahkan dua tindakan', async () => {
        await tampil()
        fireEvent.click(centang('Pilih semua di halaman ini'))
        const bilah = within(screen.getByRole('region', { name: 'Tindakan untuk surat terpilih' }))
        expect(bilah.getByText('3 surat dipilih')).toBeInTheDocument()
        expect(bilah.getByRole('button', { name: 'Ajukan Persetujuan (2)' })).toBeInTheDocument()
        expect(bilah.getByRole('button', { name: 'Setujui (1)' })).toBeInTheDocument()
        fireEvent.click(bilah.getByRole('button', { name: 'Batalkan pilihan' }))
        expect(screen.queryByRole('region', { name: 'Tindakan untuk surat terpilih' })).toBeNull()
    })

    it('peran baca saja tidak melihat kotak pilih', async () => {
        mocks.role = 'staff'
        await tampil()
        expect(screen.queryByRole('checkbox')).toBeNull()
    })
})

describe('pengajuan massal', () => {
    it('mengirim surat terpilih ke satu penyetuju lalu menampilkan jumlah berhasil dan alasan penolakan', async () => {
        mocks.approval.submitBulk.mockResolvedValue({
            berhasil: 1, gagal: 1,
            hasil: [
                { suratId: 'sk-1', berhasil: true },
                { suratId: 'sk-2', berhasil: false, pesan: 'Alur persetujuan surat masih aktif atau telah selesai.' },
            ],
        })
        await tampil()
        fireEvent.click(centang('Pilih surat SK-1/2026'))
        fireEvent.click(centang('Pilih surat SK-2/2026'))
        fireEvent.click(screen.getByRole('button', { name: 'Ajukan Persetujuan (2)' }))

        const dialog = within(await screen.findByRole('dialog', { name: 'Ajukan Persetujuan (2 surat)' }))
        expect(dialog.getByRole('button', { name: 'Ajukan' })).toBeDisabled()
        await dialog.findByRole('option', { name: 'Bu Penyetuju (Admin Unit)' })
        expect(mocks.approval.getEligibleApprovers).toHaveBeenCalledWith('sk-1')
        fireEvent.change(dialog.getByLabelText('Penyetuju'), { target: { value: 'approver-1' } })
        fireEvent.change(dialog.getByLabelText('Catatan (opsional)'), { target: { value: 'Mohon ditinjau' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Ajukan' }))

        await waitFor(() => expect(mocks.approval.submitBulk).toHaveBeenCalledWith(['sk-1', 'sk-2'], 'approver-1', 'Mohon ditinjau'))
        const ringkasan = await screen.findByRole('status')
        expect(ringkasan).toHaveTextContent('1 surat berhasil diajukan.')
        expect(ringkasan).toHaveTextContent('1 surat tidak dapat diajukan:')
        expect(ringkasan).toHaveTextContent('SK-2/2026: Alur persetujuan surat masih aktif atau telah selesai.')
        await waitFor(() => expect(mocks.keluar.getAll).toHaveBeenCalledTimes(2))
        expect(screen.queryByRole('dialog')).toBeNull()
        fireEvent.click(within(ringkasan).getByRole('button', { name: 'Tutup' }))
        expect(screen.queryByText('1 surat berhasil diajukan.')).toBeNull()
    })

    it('kegagalan permintaan ditampilkan di dialog dan pilihan tetap ada', async () => {
        mocks.approval.submitBulk.mockRejectedValue(new Error('Terlalu banyak permintaan. Coba lagi nanti.'))
        await tampil()
        fireEvent.click(centang('Pilih surat SK-1/2026'))
        fireEvent.click(screen.getByRole('button', { name: 'Ajukan Persetujuan (1)' }))
        const dialog = within(await screen.findByRole('dialog'))
        await dialog.findByRole('option', { name: 'Bu Penyetuju (Admin Unit)' })
        fireEvent.change(dialog.getByLabelText('Penyetuju'), { target: { value: 'approver-1' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Ajukan' }))
        expect(await dialog.findByRole('alert')).toHaveTextContent('Terlalu banyak permintaan. Coba lagi nanti.')
        expect(mocks.keluar.getAll).toHaveBeenCalledTimes(1)
    })
})

describe('persetujuan massal', () => {
    it('menyetujui surat yang menunggu pengguna dengan catatan opsional', async () => {
        mocks.approval.approveBulk.mockResolvedValue({ berhasil: 1, gagal: 0, hasil: [{ suratId: 'sk-4', berhasil: true }] })
        await tampil()
        fireEvent.click(centang('Pilih surat SK-4/2026'))
        fireEvent.click(screen.getByRole('button', { name: 'Setujui (1)' }))
        const dialog = within(await screen.findByRole('dialog', { name: 'Setujui Surat (1 surat)' }))
        expect(dialog.queryByLabelText('Penyetuju')).toBeNull()
        fireEvent.click(dialog.getByRole('button', { name: 'Setujui' }))
        await waitFor(() => expect(mocks.approval.approveBulk).toHaveBeenCalledWith(['sk-4'], ''))
        expect(await screen.findByRole('status')).toHaveTextContent('1 surat berhasil disetujui.')
        expect(screen.queryByText(/tidak dapat disetujui/)).toBeNull()
        await waitFor(() => expect(mocks.approval.getPending).toHaveBeenCalledTimes(2))
    })
})

describe('penyaring kerja persetujuan', () => {
    it('tautan ?persetujuan=menunggu_saya memuat daftar yang sudah tersaring', async () => {
        await tampil('/surat/keluar?persetujuan=menunggu_saya')
        expect(mocks.keluar.getAll).toHaveBeenCalledWith(expect.objectContaining({ persetujuan: 'menunggu_saya' }))
        expect(screen.queryByRole('button', { name: 'Tampilkan semua di daftar' })).toBeNull()
    })

    it('tanpa penyaring: kartu menunggu keputusan menawarkan daftar tersaring', async () => {
        await tampil()
        expect(mocks.keluar.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ persetujuan: undefined }))
        expect(await screen.findByText('1 surat menunggu keputusan Anda')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Tampilkan semua di daftar' }))
        await waitFor(() => expect(mocks.keluar.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ persetujuan: 'menunggu_saya', page: 1 })))
    })

    it('nilai penyaring yang tidak dikenal diabaikan', async () => {
        await tampil('/surat/keluar?persetujuan=lainnya')
        expect(mocks.keluar.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ persetujuan: undefined }))
    })
})
