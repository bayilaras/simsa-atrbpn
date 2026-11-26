import { readFileSync } from 'node:fs'
import path from 'node:path'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listLogs: vi.fn() }))
vi.mock('@/services/audit-log.service', () => ({ default: { listLogs: mocks.listLogs } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'sa', role: 'super_admin', unitKerjaId: null } }) }))
vi.mock('@/components/ui/select', () => ({
    Select: ({ children, value, onValueChange }) => (
        <select aria-label="Pilihan" value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }) => <>{children}</>,
    SelectItem: ({ children, value }) => <option value={value}>{children}</option>,
}))

import AuditLog from './AuditLog'

// Action codes the backend writes to audit_log, read from their sources so a
// new code cannot be added without a label here.
const backend = berkas => readFileSync(path.resolve(import.meta.dirname, '../../../backend/src/services', berkas), 'utf8')
const aksiDariTipe = [...backend('audit-log.service.ts').match(/^\s*action: ('[^;]+);$/m)[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1])
// Retention governance: audit(tx, actor, <action>, '<entity type>', ...). The
// action is either a literal or a ternary between two literals; for a ternary
// only the branches count, not the literal it compares against.
const argumenAksi = [...backend('retention-governance.service.ts').matchAll(/await audit\(\s*\w+,\s*\w+,\s*([^,]+),/g)].map(m => m[1])
const aksiTataKelola = [...new Set(argumenAksi.flatMap(argumen => (
    [...(argumen.includes('?') ? argumen.slice(argumen.indexOf('?')) : argumen).matchAll(/'([a-z_]+)'/g)].map(m => m[1])
)))]

beforeEach(() => {
    vi.clearAllMocks()
    mocks.listLogs.mockResolvedValue({ data: [], pagination: { total: 0, totalPages: 0 } })
})
afterEach(cleanup)

it('sumber backend terbaca: aksi umum dan aksi tata kelola retensi ada di daftar pembanding', () => {
    expect(aksiDariTipe).toEqual(expect.arrayContaining(['create', 'export', 'sign_in', 'hold', 'release_hold', 'restore']))
    expect(aksiTataKelola).toHaveLength(13)
    expect(aksiTataKelola).toEqual(expect.arrayContaining(['retention_event_create', 'appraisal_approve', 'transfer_handover']))
})

it('penyaring Aksi menawarkan setiap aksi yang ditulis backend, berlabel Indonesia', async () => {
    render(<AuditLog />)
    await waitFor(() => expect(mocks.listLogs).toHaveBeenCalled())
    const pilihan = within(screen.getAllByRole('combobox', { name: 'Pilihan' })[1]).getAllByRole('option')
    const nilai = pilihan.map(opsi => opsi.value)

    expect(nilai[0]).toBe('all')
    expect(pilihan[0]).toHaveTextContent('Semua Aksi')
    for (const kode of [...aksiDariTipe, ...aksiTataKelola]) expect(nilai, kode).toContain(kode)
    for (const opsi of pilihan.slice(1)) {
        expect(opsi.textContent, opsi.value).not.toMatch(/_/)
        expect(opsi.textContent, opsi.value).not.toBe(opsi.value)
    }
    expect(new Set(pilihan.map(opsi => opsi.textContent)).size).toBe(pilihan.length)
    for (const [kode, label] of [
        ['appraisal_approve', 'Menyetujui Penilaian Arsip'], ['retention_event_verify', 'Memverifikasi Pemicu Retensi'],
        ['transfer_handover', 'Menyerahkan Arsip Permanen'], ['restore', 'Memulihkan'], ['hold', 'Menerapkan Legal Hold'],
    ]) {
        expect(pilihan.find(opsi => opsi.value === kode), kode).toHaveTextContent(label)
    }
})

it('baris log tata kelola retensi dan isian perubahan memakai label, bukan kode', async () => {
    mocks.listLogs.mockResolvedValue({
        data: [
            { id: 'log-1', action: 'appraisal_approve', entityType: 'jra_appraisal', entityId: 'a-1', userName: 'Admin Unit', createdAt: '2026-11-20T01:00:00.000Z', changes: null },
            {
                id: 'log-2', action: 'update', entityType: 'surat_keluar', entityId: 's-1', userEmail: 'system:tandai-surat-impor', createdAt: '2026-11-25T12:30:15.000Z',
                changes: {
                    before: { diimporAt: null, nomorSurat: 'A-1', tanggal_surat_baru: '2026-01-01' },
                    after: { diimporAt: '2026-10-20T15:13:21.652927+00:00', nomorSurat: 'A-2', tanggal_surat_baru: '2026-01-02' },
                },
            },
            {
                id: 'log-3', action: 'update', entityType: 'archive_lending', entityId: 'p-1', userName: 'Admin Unit', createdAt: '2026-11-25T13:00:00.000Z',
                changes: {
                    before: { dueDate: '2026-09-14', fileOriginalName: 'lama.pdf', suratMasukId: 'sm-1' },
                    after: { dueDate: '2026-09-15', fileOriginalName: 'baru.pdf', suratMasukId: 'sm-2' },
                },
            },
        ],
        pagination: { total: 3, totalPages: 1 },
    })
    render(<AuditLog />)

    expect((await screen.findAllByText('Menyetujui Penilaian Arsip', { selector: '.border-0' }))[0]).toBeInTheDocument()
    expect(screen.queryByText('appraisal_approve')).toBeNull()

    expect(screen.getByText('Penanda impor:')).toBeInTheDocument()
    expect(screen.getByText('nomor Surat:')).toBeInTheDocument()
    expect(screen.getByText('tanggal surat baru:')).toBeInTheDocument()
    for (const mentah of ['diimporAt:', 'DiimporAt:', 'nomorSurat:', 'tanggal surat_baru:']) expect(screen.queryByText(mentah)).toBeNull()

    // Nama kolom berbahasa Inggris diberi label; akhiran Id ditulis sebagai kata.
    expect(screen.getByText('Jatuh tempo:')).toBeInTheDocument()
    expect(screen.getByText('Nama berkas asli:')).toBeInTheDocument()
    expect(screen.getByText('ID surat Masuk:')).toBeInTheDocument()
    for (const mentah of ['due Date:', 'file Original Name:', 'surat Masuk Id:']) expect(screen.queryByText(mentah)).toBeNull()
})
