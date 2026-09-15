import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratMasuk from './TambahSuratMasuk'
import TambahSuratKeluar from './TambahSuratKeluar'
import { clearOfflineStorage } from '@/lib/offline-storage'

const fixtures = vi.hoisted(() => ({
    masuk: { getById: vi.fn(), getBelumDibalas: vi.fn() },
    keluar: { getById: vi.fn() },
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user', role: 'admin_unit', unitKerjaId: 'unit-a' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: fixtures.masuk }))
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: fixtures.keluar }))

let router
beforeEach(() => {
    fixtures.masuk.getBelumDibalas.mockResolvedValue({ data: [] })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.stubGlobal('fetch', vi.fn())
})
afterEach(async () => {
    cleanup()
    router?.dispose()
    await clearOfflineStorage()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe.each([{ kind: 'masuk', Component: TambahSuratMasuk }, { kind: 'keluar', Component: TambahSuratKeluar }])('real $kind form and picker contract', ({ kind, Component }) => {
    it.each([false, true])('renders loaded labels with saved retention=%s through the actual picker', async withRetention => {
        fixtures[kind].getById.mockResolvedValue({
            id: 'surat-id', unitKerjaId: 'unit-a', approvalStatus: 'draft', jenisSurat: 'Nota Dinas', naskahDinas: 'Nota Dinas',
            tanggalSurat: '2026-09-12', perihal: 'Surat tersimpan', dari: 'Pengirim', kepada: 'Penerima', disposisi: ['Ditjen'],
            klasifikasiItemId: withRetention ? 82 : null, klasifikasiTipe: 'substantif', klasifikasiOrganizationalScope: 'kementerian',
            ...(kind === 'masuk' ? { klasifikasiKode: 'BP.02.02', klasifikasiUraian: 'Bimbingan Teknis dan Supervisi' }
                : { klasifikasiSubstantifKode: 'BP.02.02', klasifikasiSubstantif: 'Bimbingan Teknis dan Supervisi' }),
            ...(withRetention ? { jraItemId: 97, jraKode: 'S.III.01', jraUraian: 'Berkas bimbingan teknis', jraRetensiAktif: 0, jraRetensiInaktif: '3 tahun', jraKeterangan: 'Permanen' } : {}),
        })
        router = createMemoryRouter([{ path: '/edit/:id', element: <Component /> }], { initialEntries: ['/edit/surat-id'] })
        render(<RouterProvider router={router} />)
        const trigger = (await screen.findByText('Bimbingan Teknis dan Supervisi')).closest('button')
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
        expect(trigger).toHaveTextContent('BP.02.02')
        expect(trigger).not.toHaveTextContent('Klasifikasi terpilih')
        if (withRetention) expect(trigger).toHaveTextContent('JRA: S.III.01 — Aktif: 0, Permanen')
        else expect(trigger).not.toHaveTextContent('JRA:')
        expect(fetch).not.toHaveBeenCalled()
    })
})
