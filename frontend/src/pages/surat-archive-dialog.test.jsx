import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SuratMasuk from './SuratMasuk'
import SuratKeluar from './SuratKeluar'
import SuratMasukDetail from './SuratMasukDetail'
import SuratKeluarDetail from './SuratKeluarDetail'

const mocks = vi.hoisted(() => ({
    toast: vi.fn(),
    masuk: { getAll: vi.fn(), getById: vi.fn(), getStats: vi.fn(), archive: vi.fn() },
    keluar: { getAll: vi.fn(), getById: vi.fn(), getStats: vi.fn(), archive: vi.fn() },
    user: { id: 'actor-a', role: 'admin_unit', unitKerjaId: 'unit-a' },
}))
vi.mock('@/services/surat-masuk.service', () => ({ default: mocks.masuk }))
vi.mock('@/services/surat-keluar.service', () => ({ default: mocks.keluar }))
vi.mock('@/services/approval.service', () => ({ default: { getPending: vi.fn().mockResolvedValue([]), getHistory: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, canWrite: () => true }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ImportFromGDrive', () => ({ default: () => null }))
vi.mock('@/components/ImportCsvDialog', () => ({ default: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/surat-masuk/FilePreviewSection', () => ({ FilePreviewSection: () => null }))
// Keep the real page actions and ArchiveDialog form. The catalog itself has
// separate integration coverage; capture its received saved pair here.
vi.mock('@/components/KlasifikasiPicker', () => ({ KlasifikasiPicker: ({ selectedClassification, selectedRetention }) => (
    <output aria-label="Aturan dari surat">{JSON.stringify({ classification: selectedClassification, retention: selectedRetention })}</output>
) }))

beforeEach(() => {
    vi.clearAllMocks()
    mocks.masuk.getStats.mockResolvedValue({ total: 1, belumDibalas: 1, sudahDibalas: 0, diarsipkan: 0 })
    mocks.keluar.getStats.mockResolvedValue({ total: 1, diarsipkan: 0 })
    Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe('saved surat rules reach archive registration from every entry point', () => {
    it.each([
        { kind: 'masuk', view: 'list', category: 'fasilitatif', Component: SuratMasuk },
        { kind: 'masuk', view: 'detail', category: 'substantif', Component: SuratMasukDetail },
        { kind: 'keluar', view: 'list', category: 'substantif', Component: SuratKeluar },
        { kind: 'keluar', view: 'detail', category: 'fasilitatif', Component: SuratKeluarDetail },
    ])('$kind $view retains classification, JRA and zero retention', async ({ kind, view, category, Component }) => {
        const code = category === 'fasilitatif' ? 'TU.02.03' : 'BP.02.02'
        const label = category === 'fasilitatif' ? 'Pembinaan Kearsipan' : 'Bimbingan Teknis dan Supervisi'
        const record = {
            id: 'surat-archive-pair', unitKerjaId: 'unit-a', createdBy: 'actor-a', nomorSurat: '001/2026',
            perihal: 'Surat dengan aturan tersimpan', tanggalSurat: '2026-09-12', dari: 'Pengirim', kepada: 'Penerima',
            jenisSurat: 'Surat Dinas', naskahDinas: 'Surat Dinas', sifatSurat: 'biasa', status: 'belum_dibalas',
            approvalStatus: 'approved', isArchived: false, klasifikasiKeamanan: 'rahasia',
            klasifikasiItemId: 82, jraItemId: 97, jraKode: 'S.III.01', jraUraian: 'Berkas pengadaan tanah',
            jraRetensiAktif: 0, jraRetensiInaktif: '3 tahun', jraKeterangan: 'Permanen',
            ...(kind === 'masuk' ? { klasifikasiKode: code, klasifikasiUraian: label }
                : category === 'fasilitatif' ? { klasifikasiFasilitatifKode: code, klasifikasiFasilitatif: label }
                    : { klasifikasiSubstantifKode: code, klasifikasiSubstantif: label }),
        }
        mocks[kind].getAll.mockResolvedValue({ success: true, data: [record], pagination: { total: 1, totalPages: 1 } })
        mocks[kind].getById.mockResolvedValue(record)
        const path = `/surat/${kind}${view === 'detail' ? '/:id' : ''}`
        const entry = `/surat/${kind}${view === 'detail' ? '/' + record.id : ''}`
        render(<MemoryRouter initialEntries={[entry]}><Routes><Route path={path} element={<Component />} /></Routes></MemoryRouter>)
        await screen.findByText(record.perihal)
        if (view === 'list') {
            fireEvent.keyDown(screen.getByRole('button', { name: `Buka menu tindakan surat ${kind}` }), { key: 'Enter' })
            fireEvent.click(await screen.findByRole('menuitem', { name: 'Arsipkan' }))
        } else {
            fireEvent.click(screen.getAllByRole('button', { name: 'Arsipkan' })[0])
        }
        const dialog = within(await screen.findByRole('dialog'))
        const pair = JSON.parse(dialog.getByLabelText('Aturan dari surat').textContent)
        expect(pair).toEqual({
            classification: { id: 82, kode: code, jenis: label },
            retention: { id: 97, kode: 'S.III.01', uraian: 'Berkas pengadaan tanah', retensiAktif: 0, retensiInaktif: '3 tahun', keterangan: 'Permanen' },
        })
        expect(dialog.getByDisplayValue(code)).toBeInTheDocument()
        expect(dialog.getByDisplayValue('0')).toBeInTheDocument()
        expect(dialog.getByDisplayValue('3 tahun')).toBeInTheDocument()
        expect(dialog.getByDisplayValue('Permanen')).toBeInTheDocument()
        expect(dialog.getByDisplayValue(record.nomorSurat)).toBeInTheDocument()
        expect(mocks[kind].archive).not.toHaveBeenCalled()
    })
})
