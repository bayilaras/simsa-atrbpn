import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RegulatoryRuleSets from './RegulatoryRuleSets'

const mocks = vi.hoisted(() => ({
    user: { id: 'super-1', role: 'super_admin' },
    list: vi.fn(), activate: vi.fn(), toast: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false, fileUploads: false, externalIntegrations: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/regulatory-rule-set.service', () => ({ default: { list: mocks.list, activate: mocks.activate } }))
vi.mock('@/services/blob-upload.service', () => ({ uploadFileToBlob: vi.fn() }))

const draft = {
    id: 'draft-1', instrumentType: 'klasifikasi', name: 'Katalog resmi', version: '2026-test',
    status: 'draft', createdBy: 'super-1', effectiveFrom: '2020-01-01', itemCount: 12,
    sourceDocumentStored: true, sourceDocumentVerifiedAt: '2026-01-01',
    completenessVerifiedAt: '2026-01-01', impactReportGeneratedAt: '2026-01-01',
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = { id: 'super-1', role: 'super_admin' }
    mocks.list.mockResolvedValue({ success: true, data: [draft] })
    mocks.activate.mockResolvedValue({ success: true, ruleSet: { ...draft, status: 'active' } })
})
afterEach(cleanup)

function openPage() {
    render(<MemoryRouter><RegulatoryRuleSets /></MemoryRouter>)
}

describe('super admin direct catalogue activation', () => {
    it('lets the draft author activate a prepared draft through one confirmed action', async () => {
        openPage()
        const activate = await screen.findByRole('button', { name: 'Aktifkan', exact: true })
        expect(activate).toBeEnabled()
        expect(screen.queryByRole('button', { name: /Ajukan|Telaah|Setujui/ })).not.toBeInTheDocument()
        expect(screen.queryByText(/akun lain|akun yang berbeda|persetujuan berjenjang/)).not.toBeInTheDocument()
        fireEvent.click(activate)
        fireEvent.click(await screen.findByRole('button', { name: 'Ya, aktifkan versi' }))
        await waitFor(() => expect(mocks.activate).toHaveBeenCalledExactlyOnceWith('draft-1'))
        expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Versi aturan telah diaktifkan' }))
    })

    it.each(['admin_unit', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor'])('does not expose global activation to %s', async role => {
        mocks.user = { id: 'unit-user', role, unitKerjaId: 'unit-a' }
        openPage()
        await screen.findByText('2026-test')
        expect(screen.queryByRole('button', { name: 'Aktifkan', exact: true })).not.toBeInTheDocument()
        expect(mocks.activate).not.toHaveBeenCalled()
    })

    it('keeps incomplete evidence blocked before confirmation', async () => {
        mocks.list.mockResolvedValue({ success: true, data: [{ ...draft, completenessVerifiedAt: null }] })
        openPage()
        const activate = await screen.findByRole('button', { name: 'Aktifkan', exact: true })
        expect(activate).toBeDisabled()
        expect(activate).toHaveAttribute('title', expect.stringMatching(/manifest/))
        expect(mocks.activate).not.toHaveBeenCalled()
    })

    it('reports server validation failure without claiming activation succeeded', async () => {
        mocks.activate.mockRejectedValue(new Error('Sumber belum lolos pemeriksaan integritas.'))
        openPage()
        fireEvent.click(await screen.findByRole('button', { name: 'Aktifkan', exact: true }))
        fireEvent.click(await screen.findByRole('button', { name: 'Ya, aktifkan versi' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Aktivasi gagal', variant: 'destructive' })))
        expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Versi aturan telah diaktifkan' }))
    })
})
