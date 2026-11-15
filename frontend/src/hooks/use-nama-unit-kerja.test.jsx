import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getAllUnitKerja: vi.fn() }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: mocks.getAllUnitKerja } }))

import { useNamaUnitKerja } from './use-nama-unit-kerja'

const UNIT = [
    { id: 'dir_bppt', name: 'Direktorat Bina Pengadaan dan Pencadangan Tanah' },
    { id: 'sesditjen', name: 'Sekretariat Direktorat Jenderal' },
]

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('nama unit kerja untuk petugas', () => {
    it('menampilkan nama unit, bukan kodenya', async () => {
        mocks.getAllUnitKerja.mockResolvedValue(UNIT)
        const { result } = renderHook(() => useNamaUnitKerja('dir_bppt'))
        expect(result.current).toBe('')
        await waitFor(() => expect(result.current).toBe('Direktorat Bina Pengadaan dan Pencadangan Tanah'))
    })

    it('tidak pernah menampilkan kode unit bila unit tidak dikenal atau daftar gagal dimuat', async () => {
        mocks.getAllUnitKerja.mockResolvedValueOnce(UNIT)
        const Nama = ({ id }) => <p>{useNamaUnitKerja(id) || 'kosong'}</p>
        const view = render(<Nama id="unit_lain" />)
        await waitFor(() => expect(mocks.getAllUnitKerja).toHaveBeenCalled())
        await Promise.resolve()
        expect(screen.getByText('kosong')).toBeInTheDocument()
        expect(view.container).not.toHaveTextContent('unit_lain')

        mocks.getAllUnitKerja.mockRejectedValueOnce(new Error('offline'))
        view.rerender(<Nama id="dir_bppt" />)
        await waitFor(() => expect(mocks.getAllUnitKerja).toHaveBeenCalledTimes(2))
        expect(screen.getByText('kosong')).toBeInTheDocument()
        expect(view.container).not.toHaveTextContent('dir_bppt')
    })

    it('tidak meminta daftar unit tanpa unit kerja (Super Admin)', () => {
        const { result } = renderHook(() => useNamaUnitKerja(''))
        expect(result.current).toBe('')
        expect(mocks.getAllUnitKerja).not.toHaveBeenCalled()
    })
})
