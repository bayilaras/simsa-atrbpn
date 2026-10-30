import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }))
vi.mock('./api', () => ({ default: apiMock }))

import settingsService from './settings.service'
import { clearMemoryDrafts } from '@/lib/memory-drafts'

const units = { success: true, data: [{ id: 'unit-a', name: 'Unit A' }] }

beforeEach(() => {
    vi.useFakeTimers()
    apiMock.get.mockReset().mockResolvedValue(units)
    apiMock.put.mockReset().mockResolvedValue({ success: true })
    apiMock.post.mockReset().mockResolvedValue({ success: true })
    // Each test starts in a fresh app session with no cached list.
    clearMemoryDrafts()
})
afterEach(() => { vi.useRealTimers() })

describe('unit kerja reference list cache', () => {
    it('shares one request between callers for five minutes', async () => {
        const [first, second] = await Promise.all([settingsService.getAllUnitKerja(), settingsService.getAllUnitKerja()])
        await expect(settingsService.getAllUnitKerja({})).resolves.toBe(units)
        expect(first).toBe(units)
        expect(second).toBe(units)
        expect(apiMock.get).toHaveBeenCalledOnce()
        expect(apiMock.get).toHaveBeenCalledWith('/api/settings/unit-kerja', {})

        vi.advanceTimersByTime(5 * 60 * 1000 + 1)
        await settingsService.getAllUnitKerja()
        expect(apiMock.get).toHaveBeenCalledTimes(2)
    })

    it('never caches a filtered request', async () => {
        await settingsService.getAllUnitKerja({ editable: true })
        await settingsService.getAllUnitKerja({ editable: true })
        await settingsService.getAllUnitKerja()
        expect(apiMock.get).toHaveBeenCalledTimes(3)
        expect(apiMock.get).toHaveBeenNthCalledWith(1, '/api/settings/unit-kerja', { editable: true })
    })

    it('does not reuse a failed request', async () => {
        apiMock.get.mockRejectedValueOnce(new Error('unit API unavailable'))
        await expect(settingsService.getAllUnitKerja()).rejects.toThrow('unit API unavailable')
        await expect(settingsService.getAllUnitKerja()).resolves.toBe(units)
        expect(apiMock.get).toHaveBeenCalledTimes(2)
    })

    it.each([
        ['an edited unit', () => settingsService.updateUnitKerja('unit-a', { name: 'Unit A1' })],
        ['a new unit', () => settingsService.createUnitKerja({ name: 'Unit B' })],
        ['sign-out or session expiry', async () => clearMemoryDrafts()],
    ])('refetches after %s', async (_label, change) => {
        await settingsService.getAllUnitKerja()
        await change()
        await settingsService.getAllUnitKerja()
        expect(apiMock.get).toHaveBeenCalledTimes(2)
    })
})
