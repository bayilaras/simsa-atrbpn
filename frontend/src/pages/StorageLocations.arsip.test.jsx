import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import StorageLocations from './StorageLocations'
import StorageLocationDetail from './StorageLocationDetail'

const mocks = vi.hoisted(() => ({ getTree: vi.fn(), getById: vi.fn(), toast: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin_unit', unitKerjaId: 'ditjen' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/storage-location.service', () => ({ default: mocks }))

const BOKS = '70000000-0000-4000-8000-000000000004'
const GEDUNG = '70000000-0000-4000-8000-000000000001'
const boks = { id: BOKS, code: 'G1-B1', name: 'Boks sintetis', level: 'box', capacity: 10, currentCount: 3, arsipCount: 3, arsipMasukCount: 3, arsipKeluarCount: 0, children: [] }
const gedung = { id: GEDUNG, code: 'G1', name: 'Gedung sintetis', level: 'gedung', currentCount: 0, arsipCount: 4, arsipMasukCount: 3, arsipKeluarCount: 1, children: [boks] }

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getTree.mockResolvedValue({ success: true, data: [gedung] })
})
afterEach(cleanup)

// Jumlah berasal dari hitungan server atas tabel arsip, bukan kolom isian tangan.
describe('jumlah arsip dan tautan daftar arsip per lokasi', () => {
    it('pohon lokasi menampilkan jumlah arsip dan tautan ke daftar arsip tersaring', async () => {
        render(<MemoryRouter><StorageLocations /></MemoryRouter>)
        const barisGedung = (await screen.findByText('Gedung sintetis')).parentElement
        expect(within(barisGedung).getByTitle('Termasuk arsip di sub-lokasi')).toHaveTextContent('Arsip:4')
        expect(barisGedung).toHaveTextContent('3 arsip surat masuk, 1 arsip surat keluar')
        expect(within(barisGedung).getByRole('link', { name: 'Lihat arsip di lokasi G1' }))
            .toHaveAttribute('href', `/arsip/keluar?lokasi=${GEDUNG}&unit=ditjen`)

        const barisBoks = screen.getByText('Boks sintetis').parentElement
        expect(barisBoks).toHaveTextContent('Isi:3/10')
        expect(within(barisBoks).getByRole('link', { name: 'Lihat arsip di lokasi G1-B1' }))
            .toHaveAttribute('href', `/arsip/masuk?lokasi=${BOKS}&unit=ditjen`)
    })

    it('detail lokasi menampilkan jumlah termasuk sub-lokasi dan tautan daftar arsip', async () => {
        mocks.getById.mockResolvedValue({ ...gedung, unitKerjaId: 'ditjen' })
        render(<MemoryRouter initialEntries={[`/storage-locations/${GEDUNG}`]}><Routes>
            <Route path="/storage-locations/:id" element={<StorageLocationDetail />} />
        </Routes></MemoryRouter>)
        const label = await screen.findByText('Jumlah arsip (termasuk sub-lokasi)')
        expect(label.nextElementSibling).toHaveTextContent('4: 3 arsip surat masuk, 1 arsip surat keluar')
        expect(screen.getByRole('link', { name: 'Lihat arsip surat masuk (3)' }))
            .toHaveAttribute('href', `/arsip/masuk?lokasi=${GEDUNG}&unit=ditjen`)
        expect(screen.getByRole('link', { name: 'Lihat arsip surat keluar (1)' }))
            .toHaveAttribute('href', `/arsip/keluar?lokasi=${GEDUNG}&unit=ditjen`)
    })

    it('detail lokasi menampilkan keterangan multi-baris dengan baris barunya', async () => {
        mocks.getById.mockResolvedValue({ ...boks, unitKerjaId: 'ditjen', description: 'Lemari besi lantai 2\nRak paling atas' })
        render(<MemoryRouter initialEntries={[`/storage-locations/${BOKS}`]}><Routes>
            <Route path="/storage-locations/:id" element={<StorageLocationDetail />} />
        </Routes></MemoryRouter>)
        const nilai = (await screen.findByText('Keterangan')).nextElementSibling
        expect(nilai).toHaveTextContent('Rak paling atas')
        expect(nilai).toHaveClass('whitespace-pre-line')
    })

    it('detail lokasi dengan satu jenis arsip memakai satu tautan ke tab yang berisi', async () => {
        mocks.getById.mockResolvedValue({ ...boks, unitKerjaId: 'ditjen' })
        render(<MemoryRouter initialEntries={[`/storage-locations/${BOKS}`]}><Routes>
            <Route path="/storage-locations/:id" element={<StorageLocationDetail />} />
        </Routes></MemoryRouter>)
        expect(await screen.findByRole('link', { name: 'Lihat arsip di lokasi ini' }))
            .toHaveAttribute('href', `/arsip/masuk?lokasi=${BOKS}&unit=ditjen`)
    })
})
