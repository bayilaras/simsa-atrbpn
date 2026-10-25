import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// F1 regresi (lihat SuratMasukDetail.no-loop.test.jsx): pola yang sama juga
// berlaku di SuratKeluarDetail -- AlurSuratPanel asli, getById ditunda.
const mocks = vi.hoisted(() => ({ getById: vi.fn(), getBySurat: vi.fn(), toast: vi.fn(), canWrite: false, getHistory: vi.fn(), getEligibleApprovers: vi.fn() }))
vi.mock('@/components/surat/KoreksiBerkasSection', () => ({ default: () => null }))
vi.mock('@/services/surat-keluar.service', () => ({ default: { getById: mocks.getById } }))
vi.mock('@/services/rangkaian.service', () => ({ default: { getBySurat: mocks.getBySurat } }))
vi.mock('@/services/approval.service', () => ({ default: { getHistory: mocks.getHistory, getEligibleApprovers: mocks.getEligibleApprovers } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ canWrite: () => mocks.canWrite, user: { id: 'user-a' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))

import SuratKeluarDetail from './SuratKeluarDetail'

const surat = {
    id: 'surat-id', nomorSurat: 'SK-1/2026', perihal: 'Nota dinas', unitKerjaId: 'dir_bppt',
    aksesMelalui: 'owner', approvalStatus: 'draft', aksiDiizinkan: [], isArchived: false,
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.canWrite = false
    mocks.getHistory.mockResolvedValue([])
    mocks.getEligibleApprovers.mockResolvedValue([])
})
afterEach(cleanup)

it('tidak membentuk loop fetch tanpa akhir saat AlurSuratPanel memuat rangkaian (F1)', async () => {
    mocks.getById.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ ...surat }), 20)))
    mocks.getBySurat.mockResolvedValue(null)
    render(<MemoryRouter initialEntries={['/surat/keluar/surat-id']}><Routes><Route path="/surat/keluar/:id" element={<SuratKeluarDetail />} /></Routes></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Detail Surat Keluar' })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(mocks.getById).toHaveBeenCalledTimes(1)
    expect(mocks.getBySurat).toHaveBeenCalledTimes(1)
}, 10_000)
