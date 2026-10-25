import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePaginatedResource } from './use-paginated-resource'

const response = (id, total) => ({ data: [{ id }], pagination: { total } })

describe('paginated resource request lifetime', () => {
    it('resets the page and rejects old responses when the query changes', async () => {
        let resolveOld
        const loader = vi.fn().mockResolvedValueOnce(response('a-first', 50))
            .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
            .mockResolvedValue(response('b-first', 1))
        const { result, rerender } = renderHook(({ queryKey }) => usePaginatedResource(loader, { queryKey }), {
            initialProps: { queryKey: 'unit-a' },
        })
        await waitFor(() => expect(result.current.rows[0]?.id).toBe('a-first'))
        act(() => result.current.setPage(2))
        await waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
        rerender({ queryKey: 'unit-b' })
        expect(result.current.rows).toEqual([])
        expect(result.current.page).toBe(1)
        await waitFor(() => expect(result.current.rows[0]?.id).toBe('b-first'))
        await act(async () => resolveOld(response('a-late', 50)))
        expect(result.current.rows[0]?.id).toBe('b-first')
        // Returning to an earlier filter must start a fresh first page too.
        loader.mockResolvedValueOnce(response('a-new', 50))
        rerender({ queryKey: 'unit-a' })
        expect(result.current.rows).toEqual([])
        expect(result.current.page).toBe(1)
        await waitFor(() => expect(result.current.rows[0]?.id).toBe('a-new'))
        expect(loader).toHaveBeenLastCalledWith({ page: 1, limit: 20 })
    })

    it('reloads the last valid page after a mutation removes the final page', async () => {
        const loader = vi.fn().mockResolvedValueOnce(response('first', 21))
            .mockResolvedValueOnce(response('last', 21))
            .mockResolvedValueOnce({ data: [], pagination: { total: 20 } })
            .mockResolvedValue(response('remaining', 20))
        const { result } = renderHook(() => usePaginatedResource(loader))
        await waitFor(() => expect(result.current.loading).toBe(false))
        act(() => result.current.setPage(2))
        await waitFor(() => expect(result.current.rows[0]?.id).toBe('last'))
        act(() => result.current.reload())
        await waitFor(() => expect(result.current.rows[0]?.id).toBe('remaining'))
        expect(result.current.page).toBe(1)
        expect(loader).toHaveBeenLastCalledWith({ page: 1, limit: 20 })
    })
})
