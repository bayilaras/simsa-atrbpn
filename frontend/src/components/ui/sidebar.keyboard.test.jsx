import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from './sidebar'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './dialog'

function setViewport(width) {
    vi.stubGlobal('innerWidth', width)
    vi.stubGlobal('matchMedia', vi.fn(() => ({
        matches: width < 1024,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    })))
}

function Menu({ defaultOpen = true, nestedDialog = false }) {
    return <SidebarProvider defaultOpen={defaultOpen}>
        <SidebarTrigger />
        <Sidebar collapsible="icon">
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Cari arsip">
                        <a href="#arsip">Arsip</a>
                    </SidebarMenuButton>
                </SidebarMenuItem>
                {nestedDialog && <SidebarMenuItem>
                    <Dialog>
                        <DialogTrigger asChild><button>Buka bantuan</button></DialogTrigger>
                        <DialogContent>
                            <DialogTitle>Bantuan arsip</DialogTitle>
                            <DialogDescription>Petunjuk pencarian arsip.</DialogDescription>
                        </DialogContent>
                    </Dialog>
                </SidebarMenuItem>}
            </SidebarMenu>
        </Sidebar>
    </SidebarProvider>
}

beforeEach(() => {
    setViewport(390)
    // JSDOM has no layout observer; keep Radix layers and keyboard handling real.
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('sidebar keyboard dismissal with real Radix layers', () => {
    it('closes the mobile menu with one Escape after a tooltip-enabled link receives focus', async () => {
        render(<Menu />)
        fireEvent.click(screen.getByRole('button', { name: 'Buka atau tutup menu navigasi' }))
        const menu = await screen.findByRole('dialog', { name: 'Menu navigasi' })
        const link = within(menu).getByRole('link', { name: 'Arsip' })
        act(() => link.focus())
        expect(link).toHaveFocus()
        fireEvent.keyDown(link, { key: 'Escape', code: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu navigasi' })).not.toBeInTheDocument())
    })

    it('does not attach an invisible tooltip to an expanded desktop item', async () => {
        setViewport(1365)
        render(<Menu />)
        const link = screen.getByRole('link', { name: 'Arsip' })
        act(() => link.focus())
        await waitFor(() => expect(link).toHaveFocus())
        expect(link).not.toHaveAttribute('aria-describedby')
        expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument()
    })

    it('preserves the keyboard tooltip on collapsed desktop navigation', async () => {
        setViewport(1365)
        render(<Menu defaultOpen={false} />)
        const link = screen.getByRole('link', { name: 'Arsip' })
        act(() => link.focus())
        expect(await screen.findByRole('tooltip')).toHaveTextContent('Cari arsip')
        fireEvent.keyDown(link, { key: 'Escape', code: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
        expect(link).toHaveFocus()
    })

    it('dismisses a nested dialog first without closing the mobile menu underneath', async () => {
        render(<Menu nestedDialog />)
        fireEvent.click(screen.getByRole('button', { name: 'Buka atau tutup menu navigasi' }))
        const menu = await screen.findByRole('dialog', { name: 'Menu navigasi' })
        fireEvent.click(within(menu).getByRole('button', { name: 'Buka bantuan' }))
        const help = await screen.findByRole('dialog', { name: 'Bantuan arsip' })
        fireEvent.keyDown(help, { key: 'Escape', code: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bantuan arsip' })).not.toBeInTheDocument())
        expect(screen.getByRole('dialog', { name: 'Menu navigasi' })).toBeVisible()
        fireEvent.keyDown(screen.getByRole('dialog', { name: 'Menu navigasi' }), { key: 'Escape', code: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu navigasi' })).not.toBeInTheDocument())
    })
})
