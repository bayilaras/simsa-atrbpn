import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { AppSidebar } from './app-sidebar'
import { SidebarProvider } from './ui/sidebar'

const state = vi.hoisted(() => ({ role: 'super_admin' }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ features: {}, capabilities: { files: true, advancedArchiveWorkflows: false } }) }))
function RouteControl() {
    const navigate = useNavigate()
    return <button onClick={() => navigate('/users')}>Pergi ke pengguna</button>
}
function show({ route = '/', expanded = true } = {}) {
    return render(<MemoryRouter initialEntries={[route]}><SidebarProvider defaultOpen={expanded}><AppSidebar /><RouteControl /></SidebarProvider></MemoryRouter>)
}
beforeEach(() => {
    state.role = 'super_admin'
    vi.stubGlobal('innerWidth', 1366)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('sidebar task groups', () => {
    it('keeps daily correspondence visible and lets a focused native button expand secondary links', () => {
        show()
        fireEvent.click(screen.getByRole('button', { name: 'Surat', exact: true }))
        expect(screen.getByRole('link', { name: 'Surat Masuk', exact: true })).toBeVisible()
        const trigger = screen.getByRole('button', { name: 'Administrasi', exact: true })
        expect(trigger).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByRole('link', { name: 'Manajemen Pengguna' })).not.toBeInTheDocument()
        act(() => trigger.focus())
        expect(trigger).toHaveFocus()
        expect(trigger.tagName).toBe('BUTTON')
        fireEvent.click(trigger, { detail: 0 })
        expect(trigger).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('link', { name: 'Persetujuan Akses Arsip' })).toHaveAttribute('href', '/record-access-grants')
        fireEvent.click(trigger, { detail: 0 })
        expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })
    it('opens the destination group after route navigation, including nested master routes', () => {
        show({ route: '/master/klasifikasi' })
        expect(screen.getByRole('button', { name: 'Administrasi', exact: true })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('link', { name: 'Klasifikasi Arsip' })).toHaveAttribute('aria-current', 'page')
        fireEvent.click(screen.getByRole('button', { name: 'Administrasi', exact: true }))
        fireEvent.click(screen.getByRole('button', { name: 'Pergi ke pengguna' }))
        expect(screen.getByRole('button', { name: 'Administrasi', exact: true })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('link', { name: 'Manajemen Pengguna' })).toHaveAttribute('aria-current', 'page')
    })
    it('keeps navigation icons available when the desktop sidebar is collapsed', () => {
        show({ expanded: false })
        expect(screen.getByRole('link', { name: 'Manajemen Pengguna' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Peminjaman', exact: true })).toBeInTheDocument()
    })
    it('opens the archive group for a detail route shared by incoming and outgoing archives', () => {
        show({ route: '/arsip/detail/qa-record' })
        expect(screen.getByRole('button', { name: 'Siklus Hidup Arsip', exact: true })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: 'Arsip Aktif', exact: true })).toHaveAttribute('aria-expanded', 'true')
    })
    it('preserves role and optional module restrictions after groups are expanded', () => {
        state.role = 'admin_unit'
        show()
        for (const label of ['Administrasi', 'Layanan & Fisik', 'Siklus Hidup Arsip']) {
            fireEvent.click(screen.getByRole('button', { name: label, exact: true }))
        }
        expect(screen.queryByRole('link', { name: 'Manajemen Pengguna' })).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'Audit Log' })).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'Monitoring Operasional' })).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'Penyusutan' })).not.toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Peminjaman', exact: true })).toBeVisible()
    })
    it('offers operational monitoring only to a super administrator', () => {
        show({ route: '/monitoring-operasional' })
        expect(screen.getByRole('link', { name: 'Monitoring Operasional' })).toHaveAttribute('href', '/monitoring-operasional')
        expect(screen.getByRole('link', { name: 'Monitoring Operasional' })).toHaveAttribute('aria-current', 'page')
    })
})
