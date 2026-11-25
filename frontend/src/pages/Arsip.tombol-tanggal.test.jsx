import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Arsip from './Arsip'

const mocks = vi.hoisted(() => ({ user: {}, bolehTulis: true, units: vi.fn(), getAll: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, canWrite: () => mocks.bolehTulis }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
vi.mock('@/services/arsip.service', () => ({ arsipService: {
    getAll: mocks.getAll,
    getStats: vi.fn(async () => ({ total: 0, arsipMasuk: 0, arsipKeluar: 0 })),
} }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: mocks.units } }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ArchiveLifecycleWidget', () => ({ ArchiveLifecycleWidget: () => null }))
vi.mock('@/components/archives/SavedArchiveFilters', () => ({ SavedArchiveFilters: () => null }))
vi.mock('@/components/arsip/TambahArsipDialog', () => ({
    TambahArsipDialog: ({ unitKerjaId }) => <button type="button">{`Tambah Arsip untuk ${unitKerjaId}`}</button>,
}))
vi.mock('@/components/ImportCsvDialog', () => ({
    default: ({ unitKerjaId }) => <button type="button">{`Impor CSV untuk ${unitKerjaId}`}</button>,
}))

const tampilkan = entry => render(<MemoryRouter initialEntries={[entry]}><Routes>
    <Route path="/arsip/:tab" element={<Arsip />} />
</Routes></MemoryRouter>)

beforeEach(() => {
    mocks.bolehTulis = true
    mocks.units.mockReset().mockResolvedValue([{ id: 'unit-a', name: 'Unit A' }, { id: 'unit-b', name: 'Unit B' }])
    mocks.getAll.mockReset().mockResolvedValue({ data: [], pagination: { total: 0 } })
})
afterEach(cleanup)

describe('tombol Tambah Arsip dan Impor CSV untuk Super Admin', () => {
    beforeEach(() => { mocks.user = { id: 'super-1', role: 'super_admin', unitKerjaId: null } })

    it('pada Semua Unit Kerja tombol tetap terlihat, tidak aktif, dengan petunjuk memilih unit', async () => {
        tampilkan('/arsip/keluar')
        await screen.findByText('Belum ada data arsip keluar')

        for (const nama of ['Tambah Arsip', 'Impor CSV']) {
            const tombol = screen.getByRole('button', { name: nama })
            expect(tombol).toHaveAttribute('aria-disabled', 'true')
            expect(tombol).toHaveAccessibleDescription('Pilih unit kerja terlebih dahulu')
            // Tombol tidak membuka apa pun.
            fireEvent.click(tombol)
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        }
        expect(screen.queryByText(/untuk unit-/)).not.toBeInTheDocument()
    })

    it('setelah unit dipilih tombol yang sebenarnya dipakai untuk unit itu', async () => {
        tampilkan('/arsip/keluar?unit=unit-b')
        expect(await screen.findByRole('button', { name: 'Tambah Arsip untuk unit-b' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Impor CSV untuk unit-b' })).toBeInTheDocument()
        expect(screen.queryByText('Pilih unit kerja terlebih dahulu')).not.toBeInTheDocument()
    })

    it('pengguna tanpa hak tulis tidak melihat tombol maupun petunjuknya', async () => {
        mocks.bolehTulis = false
        tampilkan('/arsip/keluar')
        await screen.findByText('Belum ada data arsip keluar')
        expect(screen.queryByRole('button', { name: 'Tambah Arsip' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Impor CSV' })).not.toBeInTheDocument()
    })
})

describe('kolom tanggal di daftar arsip', () => {
    beforeEach(() => { mocks.user = { id: 'admin-a', role: 'admin_unit', unitKerjaId: 'unit-a' } })

    it('menulis tanggal seperti halaman detail dan mempertahankan label kolom untuk tampilan kartu', async () => {
        mocks.getAll.mockResolvedValue({
            data: [
                { id: 'a1', uraianBerkas: 'Berkas bertanggal arsip', tanggalArsip: '2026-11-03', tanggalSuratOriginal: '2026-10-01', unitPengolah: 'Unit A' },
                { id: 'a2', uraianBerkas: 'Berkas bertanggal surat', tanggalArsip: null, tanggalSuratOriginal: '2026-01-15T00:00:00.000Z', unitPengolah: 'Unit A' },
                { id: 'a3', uraianBerkas: 'Berkas tanpa tanggal', tanggalArsip: null, tanggalSuratOriginal: null, unitPengolah: 'Unit A' },
            ],
            pagination: { total: 3 },
        })
        tampilkan('/arsip/keluar')

        const selTanggal = async (uraian) => {
            const baris = (await screen.findByRole('button', { name: uraian })).closest('tr')
            const sel = baris.querySelector('td[data-label="Tanggal / Unit"]')
            expect(sel).not.toBeNull()
            return within(sel)
        }
        expect((await selTanggal('Berkas bertanggal arsip')).getByText('3 November 2026')).toBeInTheDocument()
        expect((await selTanggal('Berkas bertanggal surat')).getByText('15 Januari 2026')).toBeInTheDocument()
        expect((await selTanggal('Berkas tanpa tanggal')).getByText('—')).toBeInTheDocument()
        expect(screen.queryByText('2026-11-03')).not.toBeInTheDocument()
        expect(document.querySelectorAll('td[data-label="No. Berkas"]')).toHaveLength(3)
    })
})
