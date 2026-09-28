import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { AppSidebar } from './app-sidebar'
import { SidebarProvider } from './ui/sidebar'

const state = vi.hoisted(() => ({ role: 'super_admin' }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ features: {}, capabilities: { files: true, advancedArchiveWorkflows: false } }) }))
const perlu = vi.hoisted(() => ({ total: 0, opsi: [] }))
vi.mock('@/hooks/use-perlu-dilengkapi-count', () => ({
    usePerluDilengkapiCount: (opsi) => { perlu.opsi.push(opsi); return { total: perlu.total } },
}))
function RouteControl() {
    const navigate = useNavigate()
    return <button onClick={() => navigate('/users')}>Pergi ke pengguna</button>
}
function show({ route = '/', expanded = true } = {}) {
    return render(<MemoryRouter initialEntries={[route]}><SidebarProvider defaultOpen={expanded}><AppSidebar /><RouteControl /></SidebarProvider></MemoryRouter>)
}
beforeEach(() => {
    state.role = 'super_admin'
    perlu.total = 0
    perlu.opsi.length = 0
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
    it('menawarkan Lacak Surat di grup Surat untuk setiap role terprovisi', () => {
        for (const role of ['staff', 'auditor', 'admin_unit', 'super_admin']) {
            state.role = role
            const { unmount } = show({ route: '/surat/lacak' })
            const link = screen.getByRole('link', { name: 'Lacak Surat' })
            expect(link).toHaveAttribute('href', '/surat/lacak')
            expect(link).toHaveAttribute('aria-current', 'page')
            expect(screen.getByRole('link', { name: 'Surat Masuk', exact: true })).not.toHaveAttribute('aria-current')
            unmount()
        }
    })
    it('menampilkan badge Perlu Dilengkapi pada Lacak Surat hanya untuk admin, tanpa mengubah tujuan tautan', () => {
        state.role = 'admin_unit'
        perlu.total = 12
        const pertama = show({ route: '/surat/lacak' })
        const link = screen.getByRole('link', { name: 'Lacak Surat (12 perlu dilengkapi)' })
        expect(link).toHaveAttribute('href', '/surat/lacak')
        expect(link).toHaveAttribute('aria-current', 'page')
        expect(within(link).getByText('12')).toHaveAttribute('aria-hidden', 'true')
        expect(perlu.opsi.at(-1)).toEqual({ enabled: true })
        pertama.unmount()

        perlu.total = 150
        const kedua = show({ route: '/surat/lacak' })
        expect(within(screen.getByRole('link', { name: 'Lacak Surat (150 perlu dilengkapi)' })).getByText('99+')).toBeInTheDocument()
        kedua.unmount()

        state.role = 'staff'
        perlu.total = 0
        show({ route: '/surat/lacak' })
        expect(perlu.opsi.at(-1)).toEqual({ enabled: false })
        expect(screen.getByRole('link', { name: 'Lacak Surat' })).toHaveAttribute('href', '/surat/lacak')
    })
})
