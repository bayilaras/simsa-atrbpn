import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRequiredUnitKerjaScope } from './use-required-unit-kerja-scope'

const getAllUnitKerja = vi.hoisted(() => vi.fn())
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('role-aware unit scope controls', () => {
    it('locks a unit administrator to its assignment despite caller overrides', () => {
        const { result } = renderHook(() => useRequiredUnitKerjaScope(
            { role: 'admin_unit', unitKerjaId: 'unit-a' }, { fixedUnitKerjaId: 'unit-b' },
        ))
        expect(result.current.unitKerjaId).toBe('unit-a')
        expect(result.current.selectedUnitKerjaId).toBe('unit-a')
        expect(result.current.locked).toBe(true)
        act(() => result.current.setSelectedUnitKerjaId('unit-b'))
        expect(result.current.unitKerjaId).toBe('unit-a')
        expect(result.current.unitKerjaList).toEqual([])
        expect(getAllUnitKerja).not.toHaveBeenCalled()
    })

    it('lets super admin choose a unit and hides previously loaded global options after a role change', async () => {
        getAllUnitKerja.mockResolvedValue([{ id: 'unit-a', name: 'Unit A' }, { id: 'unit-b', name: 'Unit B' }])
        const { result, rerender } = renderHook(({ user }) => useRequiredUnitKerjaScope(user), {
            initialProps: { user: { role: 'super_admin', unitKerjaId: null } },
        })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.unitKerjaList).toHaveLength(2)
        act(() => result.current.setSelectedUnitKerjaId('unit-b'))
        expect(result.current.unitKerjaId).toBe('unit-b')
        rerender({ user: { role: 'admin_unit', unitKerjaId: 'unit-a' } })
        expect(result.current.unitKerjaId).toBe('unit-a')
        expect(result.current.unitKerjaList).toEqual([])
        expect(result.current.locked).toBe(true)
    })
})
