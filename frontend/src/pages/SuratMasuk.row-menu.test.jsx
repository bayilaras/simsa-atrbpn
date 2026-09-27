import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SuratMasuk from './SuratMasuk'

// F3 (ruling kontroler): item "Saya Balas"/"Buat Nota Dinas" yang tergerbang
// canWrite() dikeluarkan dari menu baris daftar Surat Masuk -- spec:616
// mewajibkan item menu ini mengikuti aksiDiizinkan[] dari server, "bukan
// canWrite(unit rekaman)", dan endpoint daftar tidak membawa aksiDiizinkan
// per baris. Pengguna mencapai tindak lanjut lewat "Detail & File", tempat
// TindakLanjutMenu yang digerbang server sudah dirender dengan
// rangkaian.kode dan distribusiUnitSaya.
const mocks = vi.hoisted(() => ({ getAll: vi.fn(), getStats: vi.fn(), toast: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({
    user: { id: 'admin-a', role: 'admin_unit', unitKerjaId: 'unit-a' }, canWrite: () => true,
}) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({
    mode: 'full', capabilities: { metadata: true, files: false, fileUploads: false, externalIntegrations: false },
}) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats } }))
vi.mock('@/services/approval.service', () => ({ default: { getPending: async () => [] }, approvalService: { getPending: async () => [] } }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ImportFromGDrive', () => ({ default: () => null }))
vi.mock('@/components/ImportCsvDialog', () => ({ default: () => null }))

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAll.mockResolvedValue({
        success: true,
        data: [{ id: 'sm-row-1', nomorSurat: 'ROW-1/2026', perihal: 'Baris uji menu', tanggalSurat: '2026-09-12', status: 'belum_dibalas', isArchived: false }],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    })
    mocks.getStats.mockResolvedValue({ total: 1, belumDibalas: 1, sudahDibalas: 0, diarsipkan: 0 })
})
afterEach(cleanup)

it('menu baris admin tidak lagi menawarkan Saya Balas / Buat Nota Dinas (F3)', async () => {
    render(<MemoryRouter><SuratMasuk /></MemoryRouter>)
    await screen.findByText('ROW-1/2026')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Buka menu tindakan surat masuk' }), { key: 'Enter' })
    // Tunggu menu benar-benar terbuka lebih dulu (menu asinkron) sebelum
    // menegaskan ketidakhadiran -- supaya assert queryByRole tidak sekadar
    // lolos karena menu belum sempat terbuka.
    await screen.findByRole('menuitem', { name: 'Detail & File' })
    expect(screen.queryByRole('menuitem', { name: 'Saya Balas' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Buat Nota Dinas' })).toBeNull()
    // Item P2 lain tetap ada.
    expect(screen.getByRole('menuitem', { name: 'Edit Surat' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Distribusi' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Arsipkan' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Hapus Surat' })).toBeInTheDocument()
    // getById tidak dimock di sini (hanya getAll/getStats): bila membuka menu
    // sampai memicu pemuatan malas per baris (mis. untuk aksiDiizinkan), test
    // ini akan gagal dengan "is not a function" -- setiap GET /:id menulis
    // audit view (FR:5) sehingga tidak boleh terjadi hanya karena membuka menu.
    expect(mocks.getAll).toHaveBeenCalledTimes(1)
})
