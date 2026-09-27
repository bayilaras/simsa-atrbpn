import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// F1 regresi: AlurSuratPanel yang dulu memanggil onChanged() setelah SETIAP
// getBySurat sukses (termasuk muat awal, dan getBySurat yang resolve ke null
// dianggap sukses -- rangkaian.service.js:14) memicu fetchSurat() di halaman,
// yang menyalakan `loading`, membongkar seluruh body (termasuk panel) lewat
// gerbang `if (loading) return <spinner>`, lalu panel mount ulang dan
// memanggil getBySurat + onChanged lagi -- tanpa henti. Test ini memakai
// AlurSuratPanel ASLI (tidak di-mock) dengan getById yang ditunda, persis
// seperti skenario pembuktian di temuan F1.
const mocks = vi.hoisted(() => ({ getById: vi.fn(), getBySurat: vi.fn(), toast: vi.fn() }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getById: mocks.getById, archive: vi.fn() } }))
vi.mock('@/services/rangkaian.service', () => ({ default: { getBySurat: mocks.getBySurat } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ canWrite: () => true, user: { id: 'user-a', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/surat-masuk/FilePreviewSection', () => ({ FilePreviewSection: () => null }))

import SuratMasukDetail from './SuratMasukDetail'

const surat = {
    id: 'sm-1', nomorSurat: 'SM-1/2026', perihal: 'Permohonan data pertanahan', unitKerjaId: 'dir_bppt',
    dari: 'Kanwil A', tanggalSurat: '2026-09-01', status: 'belum_dibalas', sifatSurat: 'biasa', isArchived: false,
    aksesMelalui: 'owner', aksiDiizinkan: [],
}

const renderDetail = () => render(
    <MemoryRouter initialEntries={['/surat/masuk/sm-1']}>
        <Routes><Route path="/surat/masuk/:id" element={<SuratMasukDetail />} /></Routes>
    </MemoryRouter>,
)

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('tidak membentuk loop fetch tanpa akhir saat AlurSuratPanel memuat rangkaian (F1)', async () => {
    // 20ms sesuai bukti temuan; getBySurat resolve ke null (sukses, seperti
    // rangkaian.service.js:14) secepat mungkin -- persis skenario pemicu loop.
    mocks.getById.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ ...surat }), 20)))
    mocks.getBySurat.mockResolvedValue(null)
    renderDetail()
    await screen.findByRole('heading', { name: 'Detail Surat Masuk' })
    // Beri waktu jauh lebih lama dari satu siklus muat (20ms) supaya, bila
    // loop masih ada, ia sempat berputar banyak kali sebelum kita periksa.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(mocks.getById).toHaveBeenCalledTimes(1)
    expect(mocks.getBySurat).toHaveBeenCalledTimes(1)
}, 10_000)
