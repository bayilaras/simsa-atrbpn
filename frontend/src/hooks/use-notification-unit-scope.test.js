import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAllUnitKerja = vi.hoisted(() => vi.fn());
vi.mock('@/services/settings.service', () => ({
    default: { getAllUnitKerja },
}));

import { useNotificationUnitScope } from './use-notification-unit-scope';

describe('useNotificationUnitScope', () => {
    beforeEach(() => vi.clearAllMocks());

    it('loads canonical units and selects the first valid scope for a super admin', async () => {
        getAllUnitKerja.mockResolvedValueOnce([
            { id: 'unit-server-a', name: 'Unit Server A' },
            { id: 'unit-server-b', name: 'Unit Server B' },
        ]);
        const { result } = renderHook(() => useNotificationUnitScope({
            id: 'super-1', role: 'super_admin', unitKerjaId: null,
        }));

        expect(result.current.unitKerjaId).toBe('');
        await waitFor(() => expect(result.current.unitKerjaId).toBe('unit-server-a'));
        expect(result.current.unitKerjaList.map(unit => unit.label)).toEqual([
            'Unit Server A', 'Unit Server B',
        ]);
    });

    it('fails closed when the unit list cannot be loaded', async () => {
        getAllUnitKerja.mockRejectedValueOnce(new Error('unit API unavailable'));
        const { result } = renderHook(() => useNotificationUnitScope({
            id: 'super-1', role: 'super_admin', unitKerjaId: null,
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.unitKerjaId).toBe('');
        expect(result.current.error).toBe('unit API unavailable');
    });

    it.each([
        ['admin_dirjen', null, 'ditjen'],
        ['admin_sesditjen', 'stale-unit', 'sesditjen'],
    ])('uses the fixed role mandate for %s', (role, storedUnit, expectedUnit) => {
        const { result } = renderHook(() => useNotificationUnitScope({
            id: 'admin-1', role, unitKerjaId: storedUnit,
        }));

        expect(result.current.unitKerjaId).toBe(expectedUnit);
        expect(getAllUnitKerja).not.toHaveBeenCalled();
    });
});
