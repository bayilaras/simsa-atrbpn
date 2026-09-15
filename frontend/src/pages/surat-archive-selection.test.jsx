import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratMasuk from './TambahSuratMasuk'
import TambahSuratKeluar from './TambahSuratKeluar'
import { clearOfflineStorage } from '@/lib/offline-storage'

const fixtures = vi.hoisted(() => ({
    classification: { id: 82, kode: 'HT.01.01', jenis: 'Penetapan hak', tipe: 'substantif' },
    retention: { id: 97, kode: 'S.III.01', uraian: 'Berkas penetapan hak', retensiAktif: '2 tahun', retensiInaktif: '3 tahun', keterangan: 'Permanen' },
    masuk: { getById: vi.fn(), update: vi.fn(), create: vi.fn(), getNextNumber: vi.fn(), getBelumDibalas: vi.fn() },
    keluar: { getById: vi.fn(), update: vi.fn(), create: vi.fn(), getNextNumber: vi.fn() },
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user', role: 'admin_unit', unitKerjaId: 'unit-a' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: fixtures.masuk }))
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: fixtures.keluar }))
vi.mock('@/components/ui/searchable-select', () => ({ SearchableSelect: ({ id, ariaLabel, value, onValueChange, options }) => <select id={id} aria-label={ariaLabel} value={value} onChange={event => onValueChange(event.target.value)}>
    <option value="">Pilih</option>{options.map(option => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}
</select> }))
vi.mock('@/components/ui/multi-select', () => ({ MultiSelect: ({ onChange }) => <button type="button" onClick={() => onChange(['Ditjen'])}>Pilih penerima disposisi</button> }))
vi.mock('@/components/KlasifikasiPicker', () => ({ KlasifikasiPicker: ({ onChange, selectedClassification, selectedRetention }) => <div>
    <output aria-label="Aturan tersimpan">{JSON.stringify({ classification: selectedClassification, retention: selectedRetention })}</output>
    <button type="button" onClick={() => onChange(fixtures.classification.kode, fixtures.classification, fixtures.retention)}>Pilih pasangan aturan</button>
    <button type="button" onClick={() => onChange('', null, null)}>Hapus pasangan aturan</button>
</div> }))

const record = { id: 'surat-id', unitKerjaId: 'unit-a', approvalStatus: 'draft', jenisSurat: 'Nota Dinas', naskahDinas: 'Nota Dinas', tanggalSurat: '2026-09-12', perihal: 'Surat integrasi', dari: 'Pengirim', kepada: 'Penerima', disposisi: ['Ditjen'] }
let router
beforeEach(() => {
    vi.clearAllMocks()
    fixtures.masuk.getBelumDibalas.mockResolvedValue({ data: [] })
    fixtures.masuk.update.mockResolvedValue(record)
    fixtures.keluar.update.mockResolvedValue(record)
    for (const service of [fixtures.masuk, fixtures.keluar]) {
        service.create.mockResolvedValue(record)
        service.getNextNumber.mockResolvedValue({ nextNumber: 1 })
    }
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    Element.prototype.scrollIntoView = vi.fn()
})
afterEach(async () => { cleanup(); router?.dispose(); await clearOfflineStorage(); vi.restoreAllMocks() })

describe.each([{ kind: 'masuk', Component: TambahSuratMasuk }, { kind: 'keluar', Component: TambahSuratKeluar }])('surat $kind rule identity', ({ kind, Component }) => {
    async function mount(overrides = {}) {
        fixtures[kind].getById.mockResolvedValue({ ...record, ...overrides })
        router = createMemoryRouter([{ path: '/edit/:id', element: <Component /> }], { initialEntries: ['/edit/surat-id'] })
        const view = render(<RouterProvider router={router} />)
        await screen.findByDisplayValue('Surat integrasi')
        return view.container.querySelector('form')
    }

    it('submits both selected rule IDs and retains the proper outgoing category', async () => {
        const form = await mount()
        fireEvent.click(screen.getByRole('button', { name: 'Pilih pasangan aturan' }))
        fireEvent.submit(form)
        await waitFor(() => expect(fixtures[kind].update).toHaveBeenCalled())
        const payload = fixtures[kind].update.mock.calls[0][1]
        expect(payload).toMatchObject({ klasifikasiItemId: 82, jraItemId: 97 })
        expect(payload).not.toHaveProperty('jraRetensiAktif')
        if (kind === 'keluar') expect(payload).toMatchObject({ klasifikasiSubstantifKode: 'HT.01.01', klasifikasiFasilitatifKode: '' })
    })

    it('creates a letter with the selected classification and retention identities', async () => {
        router = createMemoryRouter([{ path: '/tambah', element: <Component /> }], { initialEntries: ['/tambah'] })
        const view = render(<RouterProvider router={router} />)
        fireEvent.change(document.getElementById(kind === 'masuk' ? 'jenis-surat' : 'naskah-dinas'), { target: { value: 'Nota Dinas' } })
        fireEvent.change(document.getElementById(kind === 'masuk' ? 'tanggal-surat' : 'tanggal-surat-keluar'), { target: { value: '2026-09-12' } })
        fireEvent.change(document.getElementById(kind === 'masuk' ? 'perihal-surat' : 'perihal-surat-keluar'), { target: { value: 'Surat baru' } })
        if (kind === 'masuk') {
            fireEvent.change(document.getElementById('pengirim-surat'), { target: { value: 'Pengirim' } })
            fireEvent.change(document.getElementById('penerima-surat'), { target: { value: 'Penerima' } })
            fireEvent.click(screen.getByRole('button', { name: 'Pilih penerima disposisi' }))
        }
        fireEvent.click(screen.getByRole('button', { name: 'Pilih pasangan aturan' }))
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(fixtures[kind].create).toHaveBeenCalled())
        expect(fixtures[kind].create.mock.calls[0][0]).toMatchObject({ klasifikasiItemId: 82, jraItemId: 97, perihal: 'Surat baru', unitKerjaId: 'unit-a' })
    })

    it('preserves a reloaded pair when editing an unrelated letter field', async () => {
        const form = await mount({
            klasifikasiItemId: 82, jraItemId: 97, klasifikasiTipe: 'substantif', klasifikasiOrganizationalScope: 'kementerian',
            ...(kind === 'masuk' ? { klasifikasiKode: 'HT.01.01', klasifikasiUraian: 'Penetapan hak' } : { klasifikasiSubstantifKode: 'HT.01.01', klasifikasiSubstantif: 'Penetapan hak' }),
            jraKode: 'S.III.01', jraUraian: 'Berkas penetapan hak', jraRetensiAktif: 0,
        })
        expect(screen.getByLabelText('Aturan tersimpan')).toHaveTextContent('"tipe":"substantif"')
        expect(screen.getByLabelText('Aturan tersimpan')).toHaveTextContent('"organizationalScope":"kementerian"')
        expect(screen.getByLabelText('Aturan tersimpan')).toHaveTextContent('"retensiAktif":0')
        fireEvent.change(screen.getByDisplayValue('Surat integrasi'), { target: { value: 'Perihal diperbarui' } })
        fireEvent.submit(form)
        await waitFor(() => expect(fixtures[kind].update).toHaveBeenCalled())
        expect(fixtures[kind].update.mock.calls[0][1]).toMatchObject({ klasifikasiItemId: 82, jraItemId: 97, perihal: 'Perihal diperbarui' })
        expect(fixtures[kind].update.mock.calls[0][1]).not.toHaveProperty('klasifikasiTipe')
    })

    it('shows a legacy classification without inventing retention or forcing a new pair', async () => {
        const form = await mount(kind === 'masuk'
            ? { klasifikasiKode: 'BP.02.02', klasifikasiUraian: 'Bimbingan Teknis dan Supervisi' }
            : { klasifikasiSubstantifKode: 'BP.02.02', klasifikasiSubstantif: 'Bimbingan Teknis dan Supervisi' })
        expect(screen.getByLabelText('Aturan tersimpan')).toHaveTextContent('Bimbingan Teknis dan Supervisi')
        expect(screen.getByLabelText('Aturan tersimpan')).toHaveTextContent('"retention":null')
        fireEvent.submit(form)
        await waitFor(() => expect(fixtures[kind].update).toHaveBeenCalled())
        const sent = JSON.parse(JSON.stringify(fixtures[kind].update.mock.calls[0][1]))
        expect(sent).not.toHaveProperty('klasifikasiItemId')
        expect(sent).not.toHaveProperty('jraItemId')
    })

    it('shows source classification and retention after reload and clears the pair explicitly', async () => {
        const form = await mount({
            klasifikasiItemId: 82, jraItemId: 97,
            ...(kind === 'masuk' ? { klasifikasiKode: 'HT.01.01', klasifikasiUraian: 'Penetapan hak' } : { klasifikasiSubstantifKode: 'HT.01.01', klasifikasiSubstantif: 'Penetapan hak' }),
            jraKode: 'S.III.01', jraUraian: 'Berkas penetapan hak', jraRetensiAktif: '2 tahun', jraRetensiInaktif: '3 tahun', jraKeterangan: 'Permanen',
        })
        expect(screen.getByLabelText('Aturan tersimpan')).toHaveTextContent('Penetapan hak')
        expect(screen.getByLabelText('Aturan tersimpan')).toHaveTextContent('S.III.01')
        fireEvent.click(screen.getByRole('button', { name: 'Hapus pasangan aturan' }))
        fireEvent.submit(form)
        await waitFor(() => expect(fixtures[kind].update).toHaveBeenCalled())
        expect(fixtures[kind].update.mock.calls[0][1]).toMatchObject({ klasifikasiItemId: null, jraItemId: null })
    })

    it('requires a fresh selection for legacy retention text without authoritative IDs', async () => {
        const form = await mount({ jraKode: 'S.III.01', jraUraian: 'Pilihan draft lama' })
        fireEvent.submit(form)
        expect(await screen.findByRole('alert')).toHaveTextContent('Pilih ulang pasangan klasifikasi dan JRA dari master aturan sebelum menyimpan.')
        expect(fixtures[kind].update).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Pilih pasangan aturan' }))
        fireEvent.submit(form)
        await waitFor(() => expect(fixtures[kind].update).toHaveBeenCalled())
        expect(fixtures[kind].update.mock.calls[0][1]).toMatchObject({ klasifikasiItemId: 82, jraItemId: 97 })
    })
})
