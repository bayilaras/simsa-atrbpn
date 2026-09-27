import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SuratKeluarDetail from './SuratKeluarDetail'

const mocks = vi.hoisted(() => ({ getById: vi.fn(), toast: vi.fn(), canWrite: false, getBySurat: vi.fn(), getHistory: vi.fn(), getEligibleApprovers: vi.fn() }))
vi.mock('@/services/surat-keluar.service', () => ({ default: { getById: mocks.getById } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ canWrite: () => mocks.canWrite, user: { id: 'user-a' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: ({ suratData }) => <output aria-label="Surat sumber arsip">{JSON.stringify(suratData)}</output> }))
vi.mock('@/services/rangkaian.service', () => ({ default: { getBySurat: mocks.getBySurat } }))
vi.mock('@/services/approval.service', () => ({ default: { getHistory: mocks.getHistory, getEligibleApprovers: mocks.getEligibleApprovers } }))
beforeEach(() => { mocks.getBySurat.mockResolvedValue(null); mocks.getHistory.mockResolvedValue([]); mocks.getEligibleApprovers.mockResolvedValue([]) })
afterEach(() => { cleanup(); mocks.canWrite = false; vi.clearAllMocks() })

it('shows saved outgoing labels and retention and passes the complete pair to registration', async () => {
    mocks.getById.mockResolvedValue({
        id: 'surat-id', nomorSurat: '001/2026', perihal: 'Surat keluar pengadaan tanah', unitKerjaId: 'unit-a',
        klasifikasiItemId: 82, klasifikasiSubstantifKode: 'BP.02.02', klasifikasiSubstantif: 'Bimbingan Teknis dan Supervisi',
        jraItemId: 97, jraKode: 'S.III.01', jraUraian: 'Berkas pengadaan tanah', jraRetensiAktif: 0, jraRetensiInaktif: '3 tahun', jraKeterangan: 'Permanen',
    })
    render(<MemoryRouter initialEntries={['/surat/keluar/surat-id']}><Routes><Route path="/surat/keluar/:id" element={<SuratKeluarDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByText('BP.02.02')).toBeInTheDocument()
    expect(screen.getByText('Bimbingan Teknis dan Supervisi')).toBeInTheDocument()
    const retention = within(screen.getByRole('region', { name: 'Jadwal Retensi Arsip' }))
    expect(retention.getByText('S.III.01')).toBeInTheDocument()
    expect(retention.getByText('0')).toBeInTheDocument()
    expect(retention.getByText('3 tahun')).toBeInTheDocument()
    expect(screen.getByLabelText('Surat sumber arsip')).toHaveTextContent('"klasifikasiItemId":82')
    expect(screen.getByLabelText('Surat sumber arsip')).toHaveTextContent('"jraItemId":97')
})

it('hides owner mutations and approval loading when read through a rangkaian', async () => {
    mocks.canWrite = true
    mocks.getById.mockResolvedValue({ id: 'surat-id', nomorSurat: '002/2026', perihal: 'ND BPPT', unitKerjaId: 'dir_bppt', approvalStatus: 'draft', aksesMelalui: 'pengawas' })
    render(<MemoryRouter initialEntries={['/surat/keluar/surat-id']}><Routes><Route path="/surat/keluar/:id" element={<SuratKeluarDetail />} /></Routes></MemoryRouter>)
    expect((await screen.findAllByText('ND BPPT')).length).toBeGreaterThan(0)
    expect(screen.queryAllByRole('button', { name: /^edit$/i })).toHaveLength(0)
    expect(mocks.getHistory).not.toHaveBeenCalled()
    expect(mocks.getBySurat).toHaveBeenCalledWith('surat_keluar', 'surat-id')
})

it('keeps the legacy reply link when the letter is not in a rangkaian', async () => {
    mocks.getById.mockResolvedValue({ id: 'surat-id', nomorSurat: '003/2026', perihal: 'Balasan lama', unitKerjaId: 'unit-a', balasanUntuk: 'sm-9', aksesMelalui: 'owner' })
    render(<MemoryRouter initialEntries={['/surat/keluar/surat-id']}><Routes><Route path="/surat/keluar/:id" element={<SuratKeluarDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByRole('link', { name: /lihat surat masuk/i })).toHaveAttribute('href', '/surat/masuk/sm-9')
})

it('hides dead-end links (Lihat di Arsip and the legacy balasan fallback) for cross-unit readers', async () => {
    mocks.getById.mockResolvedValue({
        id: 'surat-id', nomorSurat: '004/2026', perihal: 'ND Lintas Unit', unitKerjaId: 'dir_bppt',
        aksesMelalui: 'pengawas', isArchived: true, arsipId: 'arsip-1', balasanUntuk: 'sm-9',
    })
    render(<MemoryRouter initialEntries={['/surat/keluar/surat-id']}><Routes><Route path="/surat/keluar/:id" element={<SuratKeluarDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByText('ND Lintas Unit')).toBeInTheDocument()
    // Tunggu panel Alur Surat selesai memuat (getBySurat -> null) supaya
    // fallback balasan lama sudah sempat dirender bila gerbangnya hilang.
    await waitFor(() => expect(screen.queryByText('Memuat alur surat…')).toBeNull())
    expect(mocks.getBySurat).toHaveBeenCalledWith('surat_keluar', 'surat-id')
    expect(screen.queryByRole('link', { name: /lihat di arsip/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /lihat surat masuk/i })).toBeNull()
})
