// frontend/src/services/rangkaian.service.perlu-dilengkapi.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('./api', () => ({ default: { get: mocks.get, post: mocks.post }, api: { get: mocks.get, post: mocks.post } }))
import rangkaianService from './rangkaian.service'

beforeEach(() => vi.clearAllMocks())

describe('rangkaianService — Perlu Dilengkapi (D7)', () => {
    it('perluDilengkapi mengembalikan respons utuh; data lama hanya dikirim bila diminta', async () => {
        const response = { success: true, data: [], pagination: { total: 0 }, meta: {} }
        mocks.get.mockResolvedValue(response)
        await expect(rangkaianService.perluDilengkapi({ kategori: 'sk_tanpa_asal', page: 2 })).resolves.toBe(response)
        expect(mocks.get).toHaveBeenLastCalledWith('/api/rangkaian/perlu-dilengkapi',
            { kategori: 'sk_tanpa_asal', tampilkanDataLama: undefined, page: 2, limit: 20 })
        await rangkaianService.perluDilengkapi({ tampilkanDataLama: true })
        expect(mocks.get).toHaveBeenLastCalledWith('/api/rangkaian/perlu-dilengkapi',
            { kategori: undefined, tampilkanDataLama: 'true', page: 1, limit: 20 })
    })
    it('ringkasanPerluDilengkapi meneruskan AbortSignal dan mengembalikan data', async () => {
        const controller = new AbortController()
        mocks.get.mockResolvedValue({ success: true, data: { total: 5 } })
        await expect(rangkaianService.ringkasanPerluDilengkapi({}, { signal: controller.signal })).resolves.toEqual({ total: 5 })
        expect(mocks.get).toHaveBeenCalledWith('/api/rangkaian/perlu-dilengkapi/ringkasan', { tampilkanDataLama: undefined }, { signal: controller.signal })
    })
    it('tandaiInisiatif mengirim POST dengan body kosong', async () => {
        mocks.post.mockResolvedValue({ success: true, data: { id: 'sk-1', asalNaskah: 'inisiatif' } })
        await expect(rangkaianService.tandaiInisiatif('sk-1')).resolves.toEqual({ id: 'sk-1', asalNaskah: 'inisiatif' })
        expect(mocks.post).toHaveBeenCalledWith('/api/rangkaian/surat-keluar/sk-1/tandai-inisiatif', {})
    })
})
