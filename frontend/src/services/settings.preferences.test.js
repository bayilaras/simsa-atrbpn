import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('./api', () => ({ default: apiMock }))

import settingsService from './settings.service'

beforeEach(() => {
    apiMock.put.mockReset().mockImplementation(async (_endpoint, body) => ({ ...body, updatedAt: '2026-11-08T01:00:00.000Z' }))
})

describe('settingsService.updatePreferences', () => {
    it('sends only the editable keys when given a preferences response', async () => {
        await settingsService.updatePreferences({
            theme: 'dark', language: 'id', notificationsEnabled: false, emailNotifications: true,
            updatedAt: '2026-11-01T02:00:00.000Z', userId: 'user-1',
        })

        expect(apiMock.put).toHaveBeenCalledOnce()
        expect(apiMock.put.mock.calls[0][0]).toBe('/api/settings/preferences')
        expect(apiMock.put.mock.calls[0][1]).toStrictEqual({
            theme: 'dark', language: 'id', notificationsEnabled: false, emailNotifications: true,
        })
    })

    it('keeps a partial update partial', async () => {
        await settingsService.updatePreferences({ theme: 'system', language: undefined })

        expect(apiMock.put.mock.calls[0][1]).toStrictEqual({ theme: 'system' })
    })
})
