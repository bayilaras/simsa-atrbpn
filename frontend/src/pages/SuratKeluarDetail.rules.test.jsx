import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

// F2: T19-3/T19-4 -- bolehEdit/bolehArsip digerbang oleh aksiDiizinkan dari
// server (bila berupa array) DAN status persetujuan, bukan oleh isAdmin saja.
it.each([
    { approvalStatus: 'draft', aksi: ['edit', 'arsipkan'], edit: true, arsip: false },
    { approvalStatus: 'rejected', aksi: ['edit', 'arsipkan'], edit: true, arsip: false },
    { approvalStatus: 'approved', aksi: ['edit', 'arsipkan'], edit: false, arsip: true },
    { approvalStatus: 'draft', aksi: [], edit: false, arsip: false },
    { approvalStatus: 'approved', aksi: [], edit: false, arsip: false },
])('bolehEdit/bolehArsip x approvalStatus=$approvalStatus dengan aksiDiizinkan=$aksi', async ({ approvalStatus, aksi, edit, arsip }) => {
    mocks.canWrite = true
    mocks.getById.mockResolvedValue({
        id: 'surat-id', nomorSurat: 'SK-G/2026', perihal: 'Uji gating aksi', unitKerjaId: 'unit-a',
        aksesMelalui: 'owner', approvalStatus, aksiDiizinkan: aksi, isArchived: false,
    })
    render(<MemoryRouter initialEntries={['/surat/keluar/surat-id']}><Routes><Route path="/surat/keluar/:id" element={<SuratKeluarDetail />} /></Routes></MemoryRouter>)
    await screen.findByText('Uji gating aksi')
    if (edit) expect(screen.getAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThan(0)
    else expect(screen.queryAllByRole('button', { name: /^edit$/i })).toHaveLength(0)
    if (arsip) expect(screen.getAllByRole('button', { name: /^arsipkan$/i }).length).toBeGreaterThan(0)
    else expect(screen.queryAllByRole('button', { name: /^arsipkan$/i })).toHaveLength(0)
})

// F2: T19-4 -- blok aksi mobile juga harus merender TindakLanjutMenu, dan
// gerbang tampil harus melebar untuk peserta non-admin yang diberi satu aksi
// server (mis. buat_nd_penjelas), bukan hanya untuk isAdmin.
it('menampilkan TindakLanjutMenu di blok aksi desktop dan mobile untuk peserta non-admin dengan satu aksi server', async () => {
    mocks.canWrite = false
    mocks.getById.mockResolvedValue({
        id: 'surat-id', nomorSurat: 'SK-M/2026', perihal: 'ND lintas unit', unitKerjaId: 'dir_bppt',
        aksesMelalui: 'peserta', approvalStatus: 'draft', aksiDiizinkan: ['buat_nd_penjelas'],
        naskahDinas: 'Keputusan', isArchived: false,
    })
    render(<MemoryRouter initialEntries={['/surat/keluar/surat-id']}><Routes><Route path="/surat/keluar/:id" element={<SuratKeluarDetail />} /></Routes></MemoryRouter>)
    await screen.findByText('ND lintas unit')
    expect(screen.getAllByRole('button', { name: /Tindak Lanjut/ })).toHaveLength(2)
    expect(screen.queryAllByRole('button', { name: /^edit$/i })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: /^arsipkan$/i })).toHaveLength(0)
})

// Task 25: item "Tautkan ke Rangkaian" di menu Tindak Lanjut membuka TautkanDialog
// untuk surat keluar ini (sebelumnya onTautkan tidak diteruskan sehingga item tersembunyi).
it('Tautkan ke Rangkaian membuka dialog tautan untuk surat keluar', async () => {
    mocks.getById.mockResolvedValue({
        id: 'surat-id', nomorSurat: 'SK-T/2026', perihal: 'ND untuk ditautkan', unitKerjaId: 'dir_bppt',
        aksesMelalui: 'owner', approvalStatus: 'approved', aksiDiizinkan: ['tautkan'], isArchived: false,
    })
    render(<MemoryRouter initialEntries={['/surat/keluar/surat-id']}><Routes><Route path="/surat/keluar/:id" element={<SuratKeluarDetail />} /></Routes></MemoryRouter>)
    await screen.findByText('ND untuk ditautkan')
    const [tombolMenu] = screen.getAllByRole('button', { name: /Tindak Lanjut/ })
    fireEvent.keyDown(tombolMenu, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Tautkan ke Rangkaian' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Tautkan ke Rangkaian' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Tautkan' })).toBeDisabled()
})
