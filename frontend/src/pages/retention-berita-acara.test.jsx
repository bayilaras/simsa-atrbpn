import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import RetentionManagement from './RetentionManagement'
import UserGuide from './UserGuide'

const state = vi.hoisted(() => ({
    capabilities: {},
    retention: { getSummary: vi.fn(), getCandidates: vi.fn(), getHolds: vi.fn(), generateDisposalReport: vi.fn() },
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'arsiparis', role: 'admin_unit', unitKerjaId: 'unit-a' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ loading: false, compatible: true,
    capabilities: state.capabilities, features: {}, authentication: {} }) }))
vi.mock('@/services/retention.service', () => ({ default: state.retention }))
vi.mock('@/hooks/use-required-unit-kerja-scope', () => ({ useRequiredUnitKerjaScope: () => ({ unitKerjaId: 'unit-a', loading: false }) }))
vi.mock('@/components/RequiredUnitKerjaScope', () => ({ RequiredUnitKerjaScope: () => null }))

const OFF = { metadata: true, files: true, fileUploads: true, externalIntegrations: true, bulkOcr: false, advancedArchiveWorkflows: false }
const ON = { ...OFF, advancedArchiveWorkflows: true }
const DRAF = {
    draf: true,
    reportNumber: null,
    tanggal: '9 November 2026',
    unitKerjaId: 'unit-a',
    unitKerja: 'Sekretariat Ditjen',
    totalBerkas: 1,
    daftarArsip: [{
        no: 1, nomorBerkas: 'B-1/2026', kodeKlasifikasi: 'HK.01', uraian: 'Berkas uji', kurunWaktu: '2010', jumlah: 1,
        retensiAktif: '2', retensiInaktif: '3', retentionTriggerLabel: 'Selesai', retentionTriggerDate: '2015-01-01',
        retentionTriggerEvidence: '-', jraVersion: 'JRA 2020', jraReference: 'HK.01', hasilAkhir: 'Musnah', keterangan: '-',
    }],
}
const show = () => render(<MemoryRouter><RetentionManagement /></MemoryRouter>)

beforeEach(() => {
    vi.clearAllMocks()
    state.capabilities = { ...ON }
    state.retention.getSummary.mockResolvedValue({ data: { alertLevel: 'none' } })
    state.retention.getCandidates.mockResolvedValue({ data: [], summary: {}, pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } })
    state.retention.getHolds.mockResolvedValue({ data: [] })
    state.retention.generateDisposalReport.mockResolvedValue({ success: true, data: DRAF })
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('berita acara pemusnahan di manajemen retensi', () => {
    it('panduan selama modul Penyusutan nonaktif menyebut draf berita acara tanpa nomor', () => {
        state.capabilities = { ...OFF }
        render(<MemoryRouter><UserGuide /></MemoryRouter>)
        const card = within(document.getElementById('penyusutan-penyerahan'))
        expect(card.getByText(/tanpa nomor \(nomor diisi manual\) dapat dicetak dari Manajemen Retensi melalui tombol Generate Berita Acara/))
            .toBeInTheDocument()
    })

    it.each([['nonaktif', OFF], ['aktif', ON]])('modul Penyusutan %s: pratinjau dan cetakan ditandai DRAF tanpa nomor buatan dan memakai nama unit kerja', async (_label, capabilities) => {
        state.capabilities = { ...capabilities }
        show()
        fireEvent.click(await screen.findByRole('button', { name: /Generate Berita Acara/ }))
        const dialog = within(await screen.findByRole('dialog'))
        expect(state.retention.generateDisposalReport).toHaveBeenCalledWith('unit-a', undefined)
        expect(dialog.getByText('DRAF')).toBeInTheDocument()
        expect(dialog.getByText('Nomor: ……………………')).toBeInTheDocument()
        expect(dialog.getByText('Sekretariat Ditjen')).toBeInTheDocument()

        const printWindow = { document: { write: vi.fn(), close: vi.fn() }, print: vi.fn() }
        vi.stubGlobal('open', vi.fn(() => printWindow))
        fireEvent.click(dialog.getByRole('button', { name: /Cetak PDF/ }))
        const html = printWindow.document.write.mock.calls[0][0]
        expect(html).toContain('<p class="draf">DRAF</p>')
        expect(html).toContain('Nomor: ……………………')
        expect(html).toContain('Unit Kerja: Sekretariat Ditjen')
        expect(html).not.toMatch(/Nomor: (null|undefined|BA-)/)
        expect(printWindow.print).toHaveBeenCalledOnce()
    })
})
