import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SuratKeluarDetail from './SuratKeluarDetail'

const mocks = vi.hoisted(() => ({ getById: vi.fn(), toast: vi.fn() }))
vi.mock('@/services/surat-keluar.service', () => ({ default: { getById: mocks.getById } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ canWrite: () => false, user: { id: 'user-a' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: ({ suratData }) => <output aria-label="Surat sumber arsip">{JSON.stringify(suratData)}</output> }))
afterEach(cleanup)

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
