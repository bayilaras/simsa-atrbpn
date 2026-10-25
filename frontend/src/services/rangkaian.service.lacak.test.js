import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('./api', () => ({ default: { get: mocks.get, post: mocks.post }, api: { get: mocks.get, post: mocks.post } }))
import rangkaianService, { rangkaianService as named } from './rangkaian.service'

beforeEach(() => vi.clearAllMocks())

describe('rangkaianService (P4)', () => {
    it('mengekspor objek yang sama sebagai default dan named', () => {
        expect(named).toBe(rangkaianService)
    })
    it('lacak meneruskan AbortSignal dan mengembalikan data', async () => {
        const controller = new AbortController()
        mocks.get.mockResolvedValue({ success: true, data: { q: 'B-12', kelompok: [] } })
        await expect(rangkaianService.lacak({ q: 'B-12', tahun: '2024' }, { signal: controller.signal })).resolves.toEqual({ q: 'B-12', kelompok: [] })
        expect(mocks.get).toHaveBeenCalledWith('/api/rangkaian/lacak', { q: 'B-12', mode: 'lacak', tahun: '2024', jenis: undefined, limit: 8 }, { signal: controller.signal })
    })
    it('list mengembalikan respons utuh untuk paginasi', async () => {
        const response = { success: true, data: [], pagination: { total: 0 }, meta: { aksiDiizinkan: [] } }
        mocks.get.mockResolvedValue(response)
        await expect(rangkaianService.list({ status: 'diberkaskan', page: 2 })).resolves.toBe(response)
        expect(mocks.get).toHaveBeenCalledWith('/api/rangkaian', { unitPengolahId: undefined, status: 'diberkaskan', asal: undefined, page: 2, limit: 20 })
    })
    it('unitKerjaOpsi mengembalikan id dan nama terurut, tanpa unit bagian atau yang tidak menerima distribusi', async () => {
        mocks.get.mockResolvedValue({
            success: true,
            data: [
                { id: 'dir_ptep', name: 'Dit. PTEP', driveFolderId: 'x' },
                { id: 'dir_bppt', name: 'Dit. BPPT' },
                { id: 'bagian_umum', name: 'Bagian Umum', unitType: 'bagian' },
                { id: 'dir_tidak_aktif', name: 'Dit. Tidak Aktif', canReceiveDistribution: false },
            ],
        })
        await expect(rangkaianService.unitKerjaOpsi()).resolves.toEqual([{ id: 'dir_bppt', name: 'Dit. BPPT' }, { id: 'dir_ptep', name: 'Dit. PTEP' }])
        expect(mocks.get).toHaveBeenCalledWith('/api/unit-kerja')
    })
})
