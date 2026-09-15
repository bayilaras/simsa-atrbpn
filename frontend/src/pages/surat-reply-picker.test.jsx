import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratKeluar from '@/pages/TambahSuratKeluar'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
const all = Array.from({ length: 101 }, (_, index) => ({ id: `letter-${index + 1}`,
  nomorSurat: `SM-${index + 1}`, perihal: index === 100 ? 'UNIQUE-OLDER-LETTER' : `Perihal ${index + 1}` }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({
  user: { id: 'review-user', role: 'admin_dirjen', unitKerjaId: 'ditjen' },
}) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
vi.mock('@/services/api', () => ({ default: { get: mocks.get }, api: { get: mocks.get } }))
let router
beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  mocks.get.mockImplementation(async (url, params) => {
    if (url === '/api/surat-keluar/existing') return { data: {
      id: 'existing', unitKerjaId: 'ditjen', approvalStatus: 'draft', balasanUntuk: 'letter-101',
      naskahDinas: 'Nota Dinas', perihal: 'Balasan tersimpan', tanggalSurat: '2026-09-12',
    } }
    if (url === '/api/surat-masuk/letter-101') return { data: { ...all[100], status: 'sudah_dibalas' } }
    if (url !== '/api/surat-masuk') throw new Error('Unexpected request during read-only review')
    const filtered = params.search ? all.filter(row => `${row.nomorSurat} ${row.perihal}`.toLowerCase().includes(params.search.toLowerCase())) : all
    const start = ((params.page || 1) - 1) * params.limit
    return { success: true, data: filtered.slice(start, start + params.limit),
      pagination: { total: filtered.length, page: params.page || 1, limit: params.limit, totalPages: Math.ceil(filtered.length / params.limit) } }
  })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })
it('pages unanswered letters and searches the server for record 101, then selects it using the keyboard', async () => {
  router = createMemoryRouter([{ path: '/', element: <TambahSuratKeluar /> }])
  render(<RouterProvider router={router} />)
  fireEvent.click(screen.getByRole('combobox', { name: 'Surat masuk yang dibalas' }))
  await screen.findByText('SM-1')
  fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
  await screen.findByText('SM-11')
  expect(mocks.get).toHaveBeenLastCalledWith('/api/surat-masuk', expect.objectContaining({ page: 2, limit: 10 }))
  vi.useFakeTimers()
  fireEvent.change(screen.getByPlaceholderText('Ketik nomor surat atau perihal...'), { target: { value: 'UNIQUE-OLDER-LETTER' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  vi.useRealTimers()
  await screen.findByText('SM-101')
  expect(mocks.get).toHaveBeenLastCalledWith('/api/surat-masuk', {
    unitKerjaId: 'ditjen', status: 'belum_dibalas', search: 'UNIQUE-OLDER-LETTER', page: 1, limit: 10,
  })
  fireEvent.keyDown(screen.getByPlaceholderText('Ketik nomor surat atau perihal...'), { key: 'Enter' })
  await screen.findByRole('button', { name: 'Hapus surat masuk yang dipilih' })
  expect(screen.getByText('SM-101')).toBeInTheDocument()
  expect(screen.queryByPlaceholderText('Ketik nomor surat atau perihal...')).toBeNull()
})

it('retains the already linked row in edit mode even when it is no longer unanswered', async () => {
  router = createMemoryRouter([{ path: '/edit/:id', element: <TambahSuratKeluar /> }], { initialEntries: ['/edit/existing'] })
  render(<RouterProvider router={router} />)
  await screen.findByText('SM-101')
  expect(screen.getByRole('button', { name: 'Hapus surat masuk yang dipilih' })).toBeInTheDocument()
  expect(mocks.get).toHaveBeenCalledWith('/api/surat-masuk/letter-101')
  expect(mocks.get.mock.calls.some(([url]) => url === '/api/surat-masuk')).toBe(false)
})

it('shows a retry action for a failed lookup instead of reporting no matching letters', async () => {
  mocks.get.mockRejectedValueOnce(new Error('Pencarian belum tersedia'))
  router = createMemoryRouter([{ path: '/', element: <TambahSuratKeluar /> }])
  render(<RouterProvider router={router} />)
  fireEvent.click(screen.getByRole('combobox', { name: 'Surat masuk yang dibalas' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Pencarian belum tersedia')
  expect(screen.queryByText('Tidak ada surat masuk yang belum dibalas')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
  await screen.findByText('SM-1')
})
