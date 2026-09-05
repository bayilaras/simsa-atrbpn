import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DemoModeBadge } from './DemoModeBadge'

describe('persistent demo identity', () => {
    it('labels the demo on every screen size and warns against real files', () => {
        render(<DemoModeBadge mode="metadata-demo" />)
        expect(screen.getByRole('note')).toHaveTextContent('Demo')
        expect(screen.getByRole('note')).toHaveAttribute('title', expect.stringContaining('dokumen asli dinonaktifkan'))
        expect(screen.getByText('— hanya gunakan data contoh')).toHaveClass('sr-only')
    })
    it('does not change the full deployment header', () => {
        const { container } = render(<DemoModeBadge mode="full" />)
        expect(container).toBeEmptyDOMElement()
    })
})
