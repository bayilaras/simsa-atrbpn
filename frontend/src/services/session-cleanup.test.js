import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    clearOfflineStorage: vi.fn().mockResolvedValue({}),
    signOut: vi.fn().mockResolvedValue({}),
}));

vi.mock('../lib/offline-storage', () => ({
    clearOfflineStorage: mocks.clearOfflineStorage,
}));

vi.mock('../lib/auth-client', () => ({
    authClient: {
        signOut: mocks.signOut,
    },
}));

import { authService } from './auth.service';
import { api } from './api';

describe('session cleanup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.signOut.mockResolvedValue({});
        mocks.clearOfflineStorage.mockResolvedValue({});
    });

    it('clears offline storage after explicit or idle logout', async () => {
        await authService.signOut();

        expect(mocks.signOut).toHaveBeenCalledOnce();
        expect(mocks.clearOfflineStorage).toHaveBeenCalledOnce();
    });

    it('still clears offline storage when remote logout fails', async () => {
        mocks.signOut.mockRejectedValueOnce(new Error('network failure'));
        vi.spyOn(console, 'error').mockImplementation(() => { });

        await authService.signOut();

        expect(mocks.clearOfflineStorage).toHaveBeenCalledOnce();
    });

    it('clears offline storage when the server reports an expired session', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            json: vi.fn().mockResolvedValue({}),
        }));
        vi.spyOn(console, 'warn').mockImplementation(() => { });

        await expect(api.get('/api/protected')).rejects.toThrow('Sesi telah berakhir');

        expect(mocks.clearOfflineStorage).toHaveBeenCalledOnce();
        vi.unstubAllGlobals();
    });
});
