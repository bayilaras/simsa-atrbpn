import { readFileSync } from 'node:fs'
import path from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArsipVital from './index'
import { KATEGORI_CONFIG, KEKRITISAN_CONFIG, METODE_PROTEKSI } from './constants'

const mocks = vi.hoisted(() => ({
    findAll: vi.fn(), getStats: vi.fn(), getDueForReview: vi.fn(), create: vi.fn(), update: vi.fn(),
    toast: vi.fn(), formPatch: {}, editPatch: {},
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin_unit', unitKerjaId: 'ditjen' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/arsip-vital.service', () => ({ arsipVitalService: mocks }))
vi.mock('./ArsipVitalTable', () => ({
    default: ({ data, onOpenDetail }) => data.map(item => (
        <button key={item.id} onClick={() => onOpenDetail(item)}>Buka {item.nomorBerkas}</button>
    )),
}))
vi.mock('./ArsipVitalForm', () => ({
    default: ({ open, setForm, onSubmit }) => open ? (
        <div>
            <button onClick={() => setForm(f => ({ ...f, ...mocks.formPatch }))}>Isi formulir</button>
            <button onClick={onSubmit}>Tetapkan</button>
        </div>
    ) : null,
}))
vi.mock('./ArsipVitalDetail', () => ({
    default: ({ open, setForm, onUpdate }) => open ? (
        <div>
            <button onClick={() => setForm(f => ({ ...f, ...mocks.editPatch }))}>Ubah formulir</button>
            <button onClick={onUpdate}>Simpan Perubahan</button>
        </div>
    ) : null,
}))

const schemaSource = readFileSync(path.resolve(import.meta.dirname, '../../../../backend/src/validators/schemas.ts'), 'utf8')
const backendValues = pattern => [...schemaSource.match(pattern)[1].matchAll(/'([^']+)'/g)].map(m => m[1])
const BACKEND_KATEGORI = backendValues(/KATEGORI_ARSIP_VITAL = \[([^\]]*)\]/)
const BACKEND_METODE = backendValues(/metodeProteksi: optionalVitalField\(z\.enum\(\[([^\]]*)\]/)

const ARSIP_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
    vi.clearAllMocks()
    mocks.formPatch = {}
    mocks.editPatch = {}
    mocks.findAll.mockResolvedValue({ success: true, data: [], total: 0, page: 1, totalPages: 0 })
    mocks.getStats.mockResolvedValue({ success: true, data: { total: 0, byStatus: [] } })
    mocks.getDueForReview.mockResolvedValue([])
    mocks.create.mockResolvedValue({ success: true })
    mocks.update.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('vital archive form values match the backend contract', () => {
    it('offers exactly the categories and protection methods the backend accepts', () => {
        expect(BACKEND_KATEGORI.length).toBeGreaterThan(0)
        expect(Object.keys(KATEGORI_CONFIG)).toEqual(BACKEND_KATEGORI)
        expect(METODE_PROTEKSI.map(m => m.value)).toEqual(BACKEND_METODE)
    })

    it.each(Object.keys(KATEGORI_CONFIG))('designates with category %s and leaves out empty optional fields', async kategoriVital => {
        mocks.formPatch = { arsipId: ARSIP_ID, kategoriVital, tingkatKekritisan: 'kritis', tanggalReviewSelanjutnya: '' }
        render(<ArsipVital />)
        fireEvent.click(await screen.findByRole('button', { name: 'Tetapkan Arsip Vital' }))
        fireEvent.click(screen.getByRole('button', { name: 'Isi formulir' }))
        fireEvent.click(screen.getByRole('button', { name: 'Tetapkan' }))

        await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
        const payload = mocks.create.mock.calls[0][0]
        expect(BACKEND_KATEGORI).toContain(payload.kategoriVital)
        expect(payload).toStrictEqual({
            arsipId: ARSIP_ID,
            unitKerjaId: 'ditjen',
            kategoriVital,
            tingkatKekritisan: 'kritis',
            statusProteksi: 'belum_diproteksi',
            tanggalPenetapan: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        })
        expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Berhasil' }))
    })

    it('clears an emptied optional field on edit and leaves stored empty fields out', async () => {
        mocks.findAll.mockResolvedValue({
            success: true, total: 1, page: 1, totalPages: 1,
            data: [{
                id: 'vital-1', arsipId: ARSIP_ID, nomorBerkas: 'VITAL-1',
                kategoriVital: 'aset', tingkatKekritisan: 'kritis', alasanPenetapan: 'Bukti kepemilikan',
                metodeProteksi: null, lokasiBackup: 'Ruang arsip', mediaBackup: null, jadwalBackup: null,
                tanggalPenetapan: '2026-11-01', tanggalReviewSelanjutnya: '2027-11-01',
                statusProteksi: 'belum_diproteksi', penanggungJawab: null,
            }],
        })
        mocks.editPatch = { kategoriVital: 'hukum', alasanPenetapan: '', tanggalReviewSelanjutnya: '' }
        render(<ArsipVital />)
        fireEvent.click(await screen.findByRole('button', { name: 'Buka VITAL-1' }))
        fireEvent.click(screen.getByRole('button', { name: 'Ubah formulir' }))
        fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }))

        await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
        expect(mocks.update.mock.calls[0]).toStrictEqual(['vital-1', {
            kategoriVital: 'hukum',
            tingkatKekritisan: 'kritis',
            alasanPenetapan: null,
            lokasiBackup: 'Ruang arsip',
            tanggalPenetapan: '2026-11-01',
            tanggalReviewSelanjutnya: null,
            statusProteksi: 'belum_diproteksi',
        }])
    })

    it('does not clear fields that a review row does not carry', async () => {
        mocks.findAll.mockResolvedValue({
            success: true, total: 1, page: 1, totalPages: 1,
            data: [{
                id: 'vital-2', arsipId: ARSIP_ID, nomorBerkas: 'VITAL-2',
                kategoriVital: 'personal', tingkatKekritisan: 'penting', statusProteksi: 'perlu_review',
                tanggalReviewSelanjutnya: '2026-11-20', penanggungJawab: 'Petugas arsip',
            }],
        })
        mocks.editPatch = { statusProteksi: 'terlindungi' }
        render(<ArsipVital />)
        fireEvent.click(await screen.findByRole('button', { name: 'Buka VITAL-2' }))
        fireEvent.click(screen.getByRole('button', { name: 'Ubah formulir' }))
        fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }))

        await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
        expect(mocks.update.mock.calls[0]).toStrictEqual(['vital-2', {
            kategoriVital: 'personal',
            tingkatKekritisan: 'penting',
            statusProteksi: 'terlindungi',
            tanggalReviewSelanjutnya: '2026-11-20',
            penanggungJawab: 'Petugas arsip',
        }])
    })
})

describe('vital archive statistics match the backend response', () => {
    it('shows the category and criticality breakdowns returned by the stats endpoint', async () => {
        mocks.getStats.mockResolvedValue({
            success: true,
            data: {
                total: 3,
                byStatus: [],
                byKategori: [{ kategori: 'aset', count: 2 }, { kategori: 'hukum', count: 1 }],
                byKekritisan: [{ tingkat: 'sangat_kritis', count: 2 }, { tingkat: 'penting', count: 1 }],
            },
        })
        render(<ArsipVital />)
        fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Monitoring Proteksi' }), { button: 0, ctrlKey: false })

        const row = label => screen.getByText(label).closest('.justify-between')
        expect(within(await waitFor(() => row(KATEGORI_CONFIG.aset.label))).getByText('2')).toBeVisible()
        expect(within(row(KATEGORI_CONFIG.hukum.label)).getByText('1')).toBeVisible()
        expect(within(row(KEKRITISAN_CONFIG.sangat_kritis.label)).getByText('2')).toBeVisible()
        expect(within(row(KEKRITISAN_CONFIG.kritis.label)).getByText('0')).toBeVisible()
        expect(within(row(KEKRITISAN_CONFIG.penting.label)).getByText('1')).toBeVisible()
    })
})
