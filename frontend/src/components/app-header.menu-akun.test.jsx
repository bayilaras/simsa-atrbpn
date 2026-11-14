import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ user: null, navigate: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: state.user, signOut: vi.fn() }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: {} }) }))
vi.mock('@/context/theme-context', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn(), textSize: 'standard', setTextSize: vi.fn() }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }))
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => ({
    counts: { total: 0 }, loading: false, hasUrgent: false, refresh: vi.fn(), markAsRead: vi.fn(), markAllAsRead: vi.fn(),
    getByCategory: () => [], suratCount: 0, arsipCount: 0, workflowCount: 0,
}) }))
vi.mock('@/hooks/use-notification-unit-scope', () => ({ useNotificationUnitScope: user => ({
    isSuperAdmin: user?.role === 'super_admin', unitKerjaId: user?.unitKerjaId || '', unitKerjaList: [], setUnitKerjaId: vi.fn(), error: '',
}) }))
vi.mock('@/hooks/use-global-search-shortcut', () => ({ useGlobalSearchShortcut: vi.fn() }))
vi.mock('@/services/settings.service', () => ({ default: { getPreferences: vi.fn().mockResolvedValue({}), updatePreferences: vi.fn() } }))
vi.mock('@/components/GlobalSearch', () => ({ GlobalSearch: () => null }))
vi.mock('@/components/ui/sidebar', () => ({ SidebarTrigger: () => null }))
vi.mock('@/lib/app-config', () => ({ default: { name: 'SIMSA', shortName: 'SIMSA', usageBadge: 'Internal' } }))
// Menus render inline so their items can be queried directly.
vi.mock('@/components/ui/dropdown-menu', () => ({
    DropdownMenu: ({ children }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }) => <>{children}</>,
    DropdownMenuContent: ({ children }) => <div role="menu">{children}</div>,
    DropdownMenuItem: ({ children, onClick, onSelect }) => <button type="button" role="menuitem" onClick={onSelect || onClick}>{children}</button>,
    DropdownMenuLabel: ({ children }) => <div>{children}</div>,
    DropdownMenuSeparator: () => null,
}))

import { AppHeader } from './app-header'

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('menu akun di header', () => {
    it.each(['super_admin', 'admin_unit', 'staff', 'auditor'])('menyediakan Pengaturan untuk peran %s', role => {
        state.user = { id: 'u-1', name: 'Pegawai Uji', email: 'pegawai@example.test', role, unitKerjaId: role === 'super_admin' ? '' : 'dir_bppt' }
        render(<AppHeader />)
        fireEvent.click(screen.getByRole('menuitem', { name: 'Pengaturan' }))
        expect(state.navigate).toHaveBeenCalledWith('/settings')
        expect(screen.getByRole('menuitem', { name: 'Panduan Pengguna' })).toBeInTheDocument()
    })
})
