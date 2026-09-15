import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { Breadcrumbs } from './breadcrumbs'

afterEach(cleanup)
function Location() { return <output data-testid="location">{useLocation().pathname}</output> }
function mount(path) { render(<MemoryRouter initialEntries={[path]}><Breadcrumbs /><Location /></MemoryRouter>) }

describe('breadcrumb destinations', () => {
    it.each(['masuk', 'keluar'])('keeps Surat as a grouping label and navigates to the real %s list', kind => {
        mount(`/surat/${kind}/tambah`)
        expect(screen.getByText('Surat')).toBeVisible()
        expect(screen.queryByRole('link', { name: 'Surat', exact: true })).not.toBeInTheDocument()
        const name = kind === 'masuk' ? 'Masuk' : 'Keluar'
        fireEvent.click(screen.getByRole('link', { name, exact: true }))
        expect(screen.getByTestId('location')).toHaveTextContent(`/surat/${kind}`)
        expect(screen.queryByRole('link', { name, exact: true })).not.toBeInTheDocument()
    })

    it.each([
        ['/master/klasifikasi', 'Master Data'],
        ['/integrations/srikandi', 'Integrasi'],
        ['/surat/masuk/edit/11111111-1111-4111-8111-111111111111', 'Edit'],
        ['/surat/keluar/edit/11111111-1111-4111-8111-111111111111', 'Edit'],
        ['/arsip/detail/11111111-1111-4111-8111-111111111111', 'Detail'],
    ])('does not offer a broken intermediate link on %s', (path, label) => {
        mount(path)
        expect(screen.getAllByText(label).length).toBeGreaterThan(0)
        expect(screen.queryByRole('link', { name: label, exact: true })).not.toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/')
    })
})
