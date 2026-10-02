import { beforeEach, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('./api', () => ({ default: apiMock }))

import rangkaianService from './rangkaian.service'

beforeEach(() => vi.clearAllMocks())

it('memuat rangkaian dari endpoint baca', async () => {
    apiMock.get.mockResolvedValue({ success: true, data: { rangkaian: { id: 'r1' } } })
    await expect(rangkaianService.getById('r1')).resolves.toEqual({ rangkaian: { id: 'r1' } })
    expect(apiMock.get).toHaveBeenCalledWith('/api/rangkaian/r1')
})

it('memuat rangkaian per surat dan meneruskan null untuk surat tunggal', async () => {
    apiMock.get.mockResolvedValue({ success: true, data: null })
    await expect(rangkaianService.getBySurat('surat_keluar', 's1')).resolves.toBeNull()
    expect(apiMock.get).toHaveBeenCalledWith('/api/rangkaian/by-surat/surat_keluar/s1')
})

it('menolak jenis surat tak dikenal sebelum memanggil API', async () => {
    await expect(rangkaianService.getBySurat('arsip', 'x')).rejects.toThrow(/jenis surat/i)
    expect(apiMock.get).not.toHaveBeenCalled()
})
