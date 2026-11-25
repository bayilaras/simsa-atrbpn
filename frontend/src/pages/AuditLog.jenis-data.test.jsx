import { readFileSync } from 'node:fs'
import path from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

// Nilai entity_type yang ditulis backend ke audit_log, dibaca dari sumbernya
// agar jenis data baru tidak tertinggal dari penyaring.
const backend = berkas => readFileSync(path.resolve(import.meta.dirname, '../../../backend/src/services', berkas), 'utf8')
const jenisDariTipe = [...backend('audit-log.service.ts').match(/^\s*entityType: ('[^;]+);$/m)[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1])
// Pencatat audit tata kelola retensi: audit(tx, actor, '<aksi>', '<jenis data>', ...).
const jenisTataKelola = [...new Set(
    [...backend('retention-governance.service.ts').matchAll(/await audit\(\s*\w+,\s*\w+,\s*[^,]+,\s*'([a-z_]+)'/g)].map(m => m[1]),
)]
const JENIS_BACKEND = [...new Set([...jenisDariTipe, ...jenisTataKelola])]

beforeEach(() => {
    vi.clearAllMocks()
    mocks.listLogs.mockResolvedValue({ data: [], pagination: { total: 0, totalPages: 0 } })
})
afterEach(cleanup)

const penyaringJenis = async () => {
    render(<AuditLog />)
    await waitFor(() => expect(mocks.listLogs).toHaveBeenCalled())
    return screen.getAllByRole('combobox', { name: 'Pilihan' })[0]
}

it('sumber backend terbaca: jenis data lama dan baru ada di daftar pembanding', () => {
    expect(jenisDariTipe).toEqual(expect.arrayContaining(['surat_masuk', 'arsip', 'dosir', 'archive_lending', 'audit_log', 'tunjuk_silang']))
    expect(jenisTataKelola.sort()).toEqual(['jra_appraisal', 'permanent_transfer', 'retention_event'])
})

it('penyaring Jenis Data menawarkan setiap jenis data yang ditulis backend, berlabel Indonesia', async () => {
    const pilihan = within(await penyaringJenis()).getAllByRole('option')
    const nilai = pilihan.map(opsi => opsi.value)

    expect(nilai[0]).toBe('all')
    expect(pilihan[0]).toHaveTextContent('Semua Jenis Data')
    expect(nilai.slice(1).sort()).toEqual([...JENIS_BACKEND].sort())
    for (const opsi of pilihan.slice(1)) {
        // Label untuk orang, bukan kode: tanpa garis bawah dan tidak sama dengan kodenya.
        expect(opsi.textContent, opsi.value).not.toMatch(/_/)
        expect(opsi.textContent.trim().length, opsi.value).toBeGreaterThan(0)
        expect(opsi.textContent, opsi.value).not.toBe(opsi.value)
    }
    expect(new Set(pilihan.map(opsi => opsi.textContent)).size).toBe(pilihan.length)
    for (const [kode, label] of [
        ['user', 'Pengguna'], ['dosir', 'Dosir'], ['archive_lending', 'Peminjaman Arsip'], ['audit_log', 'Audit Log'],
        ['storage_location', 'Lokasi Penyimpanan'], ['penyusutan', 'Penyusutan Arsip'], ['arsip_elektronik', 'Arsip Elektronik'],
        ['tunjuk_silang', 'Tunjuk Silang'], ['retention_event', 'Pemicu Retensi'],
    ]) {
        expect(pilihan.find(opsi => opsi.value === kode), kode).toHaveTextContent(label)
    }
    expect(screen.queryByText('Tipe Entity')).not.toBeInTheDocument()
    expect(screen.queryByText('User')).not.toBeInTheDocument()
})

it('memilih jenis data baru mengirim kodenya ke server dan kembali ke halaman pertama', async () => {
    const penyaring = await penyaringJenis()
    fireEvent.change(penyaring, { target: { value: 'dosir' } })
    await waitFor(() => expect(mocks.listLogs).toHaveBeenLastCalledWith(expect.objectContaining({ entityType: 'dosir', page: 1 })))
})

it('baris log jenis data baru memakai label yang sama dengan penyaring', async () => {
    mocks.listLogs.mockResolvedValue({
        data: [
            { id: 'log-1', action: 'delete', entityType: 'dosir', entityId: 'd-1', userName: 'Admin Unit', createdAt: '2026-11-20T01:00:00.000Z', changes: null },
            { id: 'log-2', action: 'update', entityType: 'user', entityId: 'u-1', userName: 'Super Admin', createdAt: '2026-11-20T01:00:00.000Z', changes: null },
            { id: 'log-3', action: 'create', entityType: 'storage_location', entityId: 's-1', userName: 'Admin Unit', createdAt: '2026-11-20T01:00:00.000Z', changes: null },
        ],
        pagination: { total: 3, totalPages: 1 },
    })
    render(<AuditLog />)
    for (const label of ['Dosir', 'Pengguna', 'Lokasi Penyimpanan']) {
        expect((await screen.findAllByText(label, { selector: '.border-0' }))[0], label).toBeInTheDocument()
    }
    for (const kode of ['dosir', 'user', 'storage_location']) expect(screen.queryByText(kode)).toBeNull()
})
