import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ArsipDetail from './ArsipDetail'

const mocks = vi.hoisted(() => ({ getById: vi.fn(), getRuleHistory: vi.fn() }))

vi.mock('@/components/tunjuk-silang/KartuTunjukSilang', () => ({ KartuTunjukSilang: () => null }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staf-1', role: 'staff', unitKerjaId: 'unit-1' }, canWrite: () => false }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/services/arsip.service', () => ({
    arsipService: { getById: mocks.getById, getRuleHistory: mocks.getRuleHistory, update: vi.fn(), reconcileRules: vi.fn() },
}))

const MENUNGGU_PEMICU = 'Menunggu verifikasi pemicu retensi'

// Arsip surat 2022 yang diarsipkan di SIMSA belakangan; JRA aktif 2 tahun.
const dasar = {
    id: 'arsip-1',
    unitKerjaId: 'unit-1',
    jenisArsip: 'masuk',
    nomorBerkas: 'B-001/2022',
    jraKode: 'JRA.01',
    retensiAktif: '2',
    retensiInaktif: '5',
    disposalStatus: 'active',
    lendingStatus: 'available',
    ruleProvenanceStatus: 'verified',
    createdAt: '2024-11-01T00:00:00.000Z',
    updatedAt: '2024-11-01T00:00:00.000Z',
    items: [],
}
const belumAdaPemicu = {
    ...dasar,
    currentRetentionTriggerEventId: null,
    retentionTriggerDate: null,
    hasilAkhir: null,
    tanggalKadaluarsa: null,
    canonicalRetention: {
        verified: false,
        blockReason: 'peristiwa pemicu retensi terverifikasi belum ditetapkan',
        dates: { tanggalAktifBerakhir: null, tanggalInaktifBerakhir: null, tanggalKadaluarsa: null },
    },
}
const pemicuTerverifikasi = {
    ...dasar,
    currentRetentionTriggerEventId: 'pemicu-1',
    retentionTriggerDate: '2024-01-01',
    hasilAkhir: 'Musnah',
    tanggalKadaluarsa: '2031-01-01',
    canonicalRetention: {
        verified: true,
        blockReason: null,
        calculationEligible: true,
        normalizedRetention: { activeMonths: 24, inactiveMonths: 60, calculationMode: 'duration', dispositionCode: 'musnah' },
        dates: { tanggalAktifBerakhir: '2026-01-01', tanggalInaktifBerakhir: '2031-01-01', tanggalKadaluarsa: '2031-01-01' },
    },
}

function tampilkan() {
    render(<MemoryRouter initialEntries={['/arsip/detail/arsip-1']}><Routes>
        <Route path="/arsip/detail/:id" element={<ArsipDetail />} />
    </Routes></MemoryRouter>)
}

async function bukaTabRetensi() {
    await screen.findByRole('heading', { name: 'Detail Arsip' })
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Retensi & Lokasi/ }), { button: 0, ctrlKey: false })
    await screen.findByText('Jadwal Retensi Arsip (JRA)')
}

const bidang = label => screen.getByText(label, { selector: 'span' }).parentElement.parentElement

beforeEach(() => {
    // Hanya Date yang dibekukan agar penantian testing-library tetap berjalan.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2025, 0, 1, 9))
    mocks.getById.mockReset()
    mocks.getRuleHistory.mockReset().mockResolvedValue([])
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

describe('ArsipDetail - retensi', () => {
    it('tanpa pemicu terverifikasi: bilah kemajuan disembunyikan dan isian kosong diberi keterangan', async () => {
        mocks.getById.mockResolvedValue(belumAdaPemicu)
        tampilkan()
        await bukaTabRetensi()

        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
        expect(within(bidang('Hasil Akhir')).getByText(MENUNGGU_PEMICU)).toBeInTheDocument()
        expect(within(bidang('Tanggal Kadaluarsa')).getByText(MENUNGGU_PEMICU)).toBeInTheDocument()
        // Kartu Retensi di samping memakai keterangan yang sama untuk tanggal kedaluwarsa.
        expect(screen.getAllByText(MENUNGGU_PEMICU)).toHaveLength(3)
        expect(screen.getByText(/baru dihitung setelah pemicu retensi dicatat dan diverifikasi petugas berbeda melalui Tata Kelola Retensi/)).toBeInTheDocument()
    })

    it('arsip yang aturannya belum terverifikasi diarahkan ke rekonsiliasi, bukan ke verifikasi pemicu', async () => {
        mocks.getById.mockResolvedValue({ ...belumAdaPemicu, ruleProvenanceStatus: 'legacy_unverified' })
        tampilkan()
        await bukaTabRetensi()

        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
        expect(within(bidang('Hasil Akhir')).getByText('Menunggu rekonsiliasi klasifikasi dan JRA')).toBeInTheDocument()
        expect(within(bidang('Tanggal Kadaluarsa')).getByText('Menunggu rekonsiliasi klasifikasi dan JRA')).toBeInTheDocument()
        expect(screen.queryByText(MENUNGGU_PEMICU)).not.toBeInTheDocument()
        expect(screen.queryByText(/Tata Kelola Retensi/)).not.toBeInTheDocument()
    })

    it('dengan pemicu terverifikasi: kemajuan dihitung dari tanggal pemicu, bukan tanggal rekod dibuat', async () => {
        mocks.getById.mockResolvedValue(pemicuTerverifikasi)
        tampilkan()
        await bukaTabRetensi()

        const bilah = screen.getAllByRole('progressbar', { name: 'Kemajuan masa aktif' })
        expect(bilah).toHaveLength(2)
        bilah.forEach(item => expect(item).toHaveAttribute('aria-valuenow', expect.stringMatching(/^50\./)))
        expect(screen.getByText('1,0 dari 2 tahun')).toBeInTheDocument()
        expect(screen.getByText('1,0 / 2 tahun')).toBeInTheDocument()
        expect(screen.getByText('Dihitung sejak tanggal pemicu retensi 1 Januari 2024.')).toBeInTheDocument()
        expect(within(bidang('Hasil Akhir')).getByText('Musnah')).toBeInTheDocument()
        expect(within(bidang('Tanggal Kadaluarsa')).getByText('1 Januari 2031')).toBeInTheDocument()
        expect(screen.queryByText(MENUNGGU_PEMICU)).not.toBeInTheDocument()
    })
})
