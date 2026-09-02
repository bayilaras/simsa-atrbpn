import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getPreferences: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
}));

vi.mock('../services/settings.service', () => ({
    default: { getPreferences: mocks.getPreferences },
    PREFERENCES_CHANGED_EVENT: 'simsa-preferences-changed',
}));
vi.mock('../services/notification.service', () => ({
    notificationService: {
        markAsRead: mocks.markAsRead,
        markAllAsRead: mocks.markAllAsRead,
    },
}));

import { useNotifications } from './useNotifications';

const notification = {
    id: 'distribusi:550e8400-e29b-41d4-a716-446655440001:awaiting_receipt:urgent',
    category: 'distribusi',
    type: 'urgent',
};

function notificationResponse() {
    return Promise.resolve({
        ok: true,
        json: async () => ({
            notifications: [notification],
            counts: { total: 1, urgent: 1, distribusi: 1 },
        }),
    });
}

describe('useNotifications unit-scoped mutations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getPreferences.mockResolvedValue({ notificationsEnabled: true });
        vi.stubGlobal('fetch', vi.fn(notificationResponse));
    });

    it('does not fetch until a concrete unit has been selected', async () => {
        const { result } = renderHook(() => useNotifications({
            unitKerjaId: '', refreshInterval: 0,
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(fetch).not.toHaveBeenCalled();
    });

    it('carries the selected super-admin unit from list through mark-read', async () => {
        const { result } = renderHook(() => useNotifications({
            unitKerjaId: 'unit-server-a', refreshInterval: 0,
        }));
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));

        await act(() => result.current.markAsRead(notification.id));

        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('unitKerjaId=unit-server-a'),
            { credentials: 'include' },
        );
        expect(mocks.markAsRead).toHaveBeenCalledWith(notification.id, 'unit-server-a');
    });

    it('carries the selected super-admin unit through category read-all', async () => {
        const { result } = renderHook(() => useNotifications({
            unitKerjaId: 'unit-server-a', refreshInterval: 0,
        }));
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));

        await act(() => result.current.markAllAsRead('workflow'));

        expect(mocks.markAllAsRead).toHaveBeenCalledWith([notification.id], 'unit-server-a');
    });
});
