import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DatePicker } from './date-picker'

afterEach(cleanup)

describe('DatePicker', () => {
    it('opens an Indonesian calendar, focuses the selected day, and reports the chosen date', async () => {
        const onDateChange = vi.fn()
        render(<DatePicker date={new Date(2026, 9, 12)} onDateChange={onDateChange} />)

        fireEvent.click(screen.getByRole('button', { name: /12\/10\/2026/ }))
        const grid = await screen.findByRole('grid')
        expect(grid).toHaveAccessibleName(/oktober 2026/i)
        // react-day-picker 10 dropped initialFocus; autoFocus moves focus into the grid.
        await waitFor(() => expect(grid).toContainElement(document.activeElement))

        fireEvent.click(within(grid).getByRole('button', { name: /20 oktober 2026/i }))
        expect(onDateChange).toHaveBeenCalledTimes(1)
        expect(onDateChange.mock.calls[0][0]).toEqual(new Date(2026, 9, 20))
    })
})
