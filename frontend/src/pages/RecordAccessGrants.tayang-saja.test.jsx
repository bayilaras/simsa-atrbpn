import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import RecordAccessGrants from './RecordAccessGrants'

const mocks = vi.hoisted(() => ({ mine: vi.fn(), review: vi.fn(), toast: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'sa', role: 'super_admin' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/record-access-grant.service', () => ({
    default: { listMine: mocks.mine, listForReview: mocks.review, request: vi.fn(), approve: vi.fn() },
}))
vi.mock('@/components/ui/select', () => ({
    Select: ({ children, value, onValueChange }) => (
        <select aria-label="Pilihan" value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }) => <>{children}</>,
    SelectItem: ({ children, value }) => <option value={value}>{children}</option>,
}))
vi.mock('@/components/ui/tabs', () => ({
    Tabs: ({ children }) => <div>{children}</div>,
    TabsList: ({ children }) => <div>{children}</div>,
    TabsTrigger: ({ children }) => <span>{children}</span>,
    TabsContent: ({ children }) => <div>{children}</div>,
}))

const CATATAN = 'Tayang saja hanya menyembunyikan tombol unduh, cetak, dan buka di tab baru. Isi berkas tetap tampil di layar peminta dan dapat disalin; setiap penayangan tercatat di Audit Log.'
const halaman = { page: 1, limit: 20, totalPages: 1 }
const izin = (id, accessMode) => ({
    id, accessMode, status: 'pending', entityType: 'surat_masuk', entityId: `30000000-0000-4000-8000-00000000000${id}`,
    unitKerjaId: 'sesditjen', requiredClassification: 'terbatas', purpose: `Tujuan kedinasan permohonan ${id}`,
    requesterName: `Pemohon ${id}`, requesterEmail: `pemohon${id}@example.test`, requestedAt: '2026-11-14T01:00:00.000Z',
})

beforeEach(() => {
    vi.clearAllMocks()
    mocks.mine.mockResolvedValue({ data: [], pagination: { ...halaman, total: 0 } })
    mocks.review.mockImplementation(async ({ status }) => (status === 'pending'
        ? { data: [izin(1, 'view'), izin(2, 'download')], pagination: { ...halaman, total: 2 } }
        : { data: [], pagination: { ...halaman, total: 0 } }))
})
afterEach(cleanup)

const buka = () => render(<MemoryRouter><RecordAccessGrants /></MemoryRouter>)

describe('keterangan mode Tayang saja', () => {
    it('muncul di formulir permohonan hanya saat Tayang saja dipilih', async () => {
        buka()
        fireEvent.click(screen.getByRole('button', { name: 'Minta akses' }))
        const dialog = within(await screen.findByRole('dialog', { name: 'Minta akses rekod terkendali' }))
        expect(dialog.getByText(CATATAN)).toBeInTheDocument()
        const mode = dialog.getAllByRole('combobox', { name: 'Pilihan' }).find(select => select.value === 'view')
        fireEvent.change(mode, { target: { value: 'download' } })
        expect(dialog.queryByText(CATATAN)).not.toBeInTheDocument()
        fireEvent.change(mode, { target: { value: 'view' } })
        expect(dialog.getByText(CATATAN)).toBeInTheDocument()
    })

    it('muncul di dialog persetujuan untuk permohonan Tayang saja, tidak untuk mode unduh', async () => {
        buka()
        const barisTayang = (await screen.findByText('Pemohon 1')).closest('tr')
        fireEvent.click(within(barisTayang).getByRole('button', { name: 'Setujui' }))
        expect(within(await screen.findByRole('dialog', { name: 'Setujui akses' })).getByText(CATATAN)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Batal' }))

        fireEvent.click(within(screen.getByText('Pemohon 2').closest('tr')).getByRole('button', { name: 'Setujui' }))
        expect(within(await screen.findByRole('dialog', { name: 'Setujui akses' })).queryByText(CATATAN)).not.toBeInTheDocument()
    })
})
