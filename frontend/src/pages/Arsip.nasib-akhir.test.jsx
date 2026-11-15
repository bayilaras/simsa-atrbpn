import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Arsip from './Arsip'

const mocks = vi.hoisted(() => ({ getAll: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staf-1', role: 'staff', unitKerjaId: 'unit-a' }, canWrite: () => false }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/services/arsip.service', () => ({ arsipService: {
    getAll: mocks.getAll,
    getStats: vi.fn(async () => ({ total: 4, arsipMasuk: 4, arsipKeluar: 0 })),
} }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ArchiveLifecycleWidget', () => ({ ArchiveLifecycleWidget: () => null }))
vi.mock('@/components/archives/SavedArchiveFilters', () => ({ SavedArchiveFilters: () => null }))

const baris = (uraianBerkas, ubah) => ({
    id: uraianBerkas, uraianBerkas, unitKerjaId: 'unit-a', ruleProvenanceStatus: 'verified',
    currentRetentionTriggerEventId: null, hasilAkhir: null, canonicalRetention: { verified: false }, ...ubah,
})
const daftar = [
    baris('Berkas terverifikasi', { currentRetentionTriggerEventId: 'pemicu-1', hasilAkhir: 'Musnah', canonicalRetention: { verified: true } }),
    baris('Berkas tanpa pemicu'),
    baris('Berkas lama', { ruleProvenanceStatus: 'legacy_unverified' }),
    baris('Berkas tidak lolos evaluasi', { currentRetentionTriggerEventId: 'pemicu-9' }),
]

const selNasibAkhir = async uraian => (await screen.findByRole('button', { name: uraian }))
    .closest('tr').querySelector('[data-label="Nasib Akhir"]')

beforeEach(() => {
    mocks.getAll.mockReset().mockResolvedValue({ data: daftar, pagination: { total: daftar.length } })
})
afterEach(cleanup)

describe('kolom Nasib Akhir di daftar arsip', () => {
    it('memakai aturan yang sama dengan detail arsip, dengan keterangan singkat', async () => {
        render(<MemoryRouter initialEntries={['/arsip/masuk']}><Routes>
            <Route path="/arsip/:tab" element={<Arsip />} />
        </Routes></MemoryRouter>)

        expect(await selNasibAkhir('Berkas terverifikasi')).toHaveTextContent('Musnah')

        const tanpaPemicu = await selNasibAkhir('Berkas tanpa pemicu')
        expect(tanpaPemicu).toHaveTextContent('Menunggu verifikasi')
        expect(tanpaPemicu.querySelector('[title]')).toHaveAttribute('title', 'Menunggu verifikasi pemicu retensi')

        const lama = await selNasibAkhir('Berkas lama')
        expect(lama).toHaveTextContent('Menunggu rekonsiliasi')
        expect(lama.querySelector('[title]')).toHaveAttribute('title', 'Menunggu rekonsiliasi klasifikasi dan JRA')

        // Tanpa keterangan yang pasti benar, kolom tetap bertanda "-".
        expect((await selNasibAkhir('Berkas tidak lolos evaluasi')).textContent).toBe('-')
    })
})
