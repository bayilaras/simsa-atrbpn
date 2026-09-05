import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
    LayoutDashboard,
    Mail,
    MailOpen,
    Send,
    Archive,
    FileBarChart,
    ClipboardList,
    ChevronDown,
    Users,
    FolderTree,
    Clock,
    MapPin,
    ArrowLeftRight,
    FolderOpen,
    Scissors,
    ShieldAlert,
    Lock,
    HardDrive,
    Link2,
    BookOpen,
    FileKey2,
    CloudCog,
    GitBranch,
    Scale,
    Settings2,
} from 'lucide-react'

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubItem,
    SidebarMenuSubButton,
    useSidebar,
} from '@/components/ui/sidebar'
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import appConfig from '@/lib/app-config'
import { PROVISIONED_ROLES } from '@/lib/provisioning-access'
import { useAppConfig } from '@/context/app-config-context'

// Role constants for menu access
const ADMIN_ROLES = ['super_admin', 'admin_dirjen', 'admin_sesditjen']
const ADMIN_AND_AUDITOR = ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor']
const ALL_PROVISIONED_ROLES = PROVISIONED_ROLES

// Menu items grouped by section
// allowedRoles: if set, only users with these roles can see the menu item
// If not set, the item is visible to ALL authenticated users
const menuGroups = [
    {
        label: 'Utama',
        items: [
            {
                title: 'Dashboard',
                url: '/',
                icon: LayoutDashboard,
            },
        ]
    },
    {
        label: 'Manajemen Surat',
        items: [
            {
                title: 'Surat',
                icon: Mail,
                allowedRoles: ALL_PROVISIONED_ROLES,
                subItems: [
                    { title: 'Surat Masuk', url: '/surat/masuk', icon: MailOpen },
                    { title: 'Surat Keluar', url: '/surat/keluar', icon: Send },
                ],
            },
            {
                title: 'Distribusi',
                url: '/distribusi',
                icon: ArrowLeftRight,
                allowedRoles: ADMIN_ROLES,
            },
        ]
    },
    {
        label: 'Siklus Hidup Arsip',
        items: [
            {
                title: 'Arsip Aktif',
                icon: Archive,
                url: '/arsip',
                allowedRoles: ALL_PROVISIONED_ROLES,
                subItems: [
                    { title: 'Arsip Surat Masuk', url: '/arsip/masuk' },
                    { title: 'Arsip Surat Keluar', url: '/arsip/keluar' },
                ],
            },
            {
                title: 'Pemberkasan (Dosir)',
                url: '/dosir',
                icon: FolderOpen,
                allowedRoles: ADMIN_ROLES,
            },
            {
                title: 'Jadwal Retensi',
                url: '/master/jra',
                icon: Clock,
                allowedRoles: ADMIN_ROLES,
            },
            {
                title: 'Manajemen Retensi',
                url: '/retention',
                icon: FileBarChart,
                allowedRoles: ADMIN_ROLES,
            },
            {
                title: 'Tata Kelola Retensi',
                url: '/retention-governance',
                icon: Scale,
                allowedRoles: ADMIN_AND_AUDITOR,
            },
            {
                title: 'Penyusutan',
                url: '/penyusutan',
                icon: Scissors,
                allowedRoles: ADMIN_ROLES,
            },
        ]
    },
    {
        label: 'Layanan & Fisik',
        allowedRoles: ALL_PROVISIONED_ROLES,
        items: [
            {
                title: 'Layanan Arsip',
                url: '/layanan-arsip',
                icon: ClipboardList,
                allowedRoles: ALL_PROVISIONED_ROLES,
            },
            {
                title: 'Peminjaman',
                url: '/archive-lending',
                icon: ArrowLeftRight,
                allowedRoles: ADMIN_ROLES,
            },
            {
                title: 'Lokasi Simpan',
                url: '/storage-locations',
                icon: MapPin,
                allowedRoles: ADMIN_ROLES,
            },
            {
                title: 'Arsip Vital',
                url: '/arsip-vital',
                icon: ShieldAlert,
                allowedRoles: ADMIN_ROLES,
            },
            {
                title: 'Arsip Terjaga',
                url: '/arsip-terjaga',
                icon: Lock,
                allowedRoles: ADMIN_ROLES,
            },
        ]
    },
    {
        label: 'Media & Autentikasi',
        allowedRoles: ADMIN_ROLES,
        items: [
            {
                title: 'Arsip Elektronik',
                url: '/arsip-elektronik',
                icon: HardDrive,
                allowedRoles: ADMIN_ROLES,
                capability: 'files',
            },
            {
                title: 'Autentikasi',
                url: '/autentikasi',
                icon: ShieldAlert,
                allowedRoles: ['super_admin'],
                capability: 'files',
            },
            {
                title: 'Tunjuk Silang',
                url: '/tunjuk-silang',
                icon: Link2,
                allowedRoles: ADMIN_ROLES,
            },
        ]
    },
    {
        label: 'Administrasi',
        items: [
            {
                title: 'Laporan',
                url: '/laporan',
                icon: FileBarChart,
                allowedRoles: ALL_PROVISIONED_ROLES,
            },
            {
                title: 'Audit Log',
                url: '/audit-log',
                icon: ClipboardList,
                // Backend intentionally limits global audit rows to super admin
                // until every row carries an enforceable unit dimension.
                allowedRoles: ['super_admin'],
            },
            {
                title: 'Persetujuan Akses',
                url: '/record-access-grants',
                icon: FileKey2,
                allowedRoles: ALL_PROVISIONED_ROLES,
            },
            {
                title: 'Pengaturan',
                url: '/settings',
                icon: Settings2,
                allowedRoles: ALL_PROVISIONED_ROLES,
            },
            {
                title: 'Integrasi SRIKANDI',
                url: '/integrations/srikandi',
                icon: CloudCog,
                allowedRoles: ADMIN_ROLES,
                feature: 'srikandi',
            },
            {
                title: 'Manajemen Pengguna',
                url: '/users',
                icon: Users,
                allowedRoles: ['super_admin'],
            },
            {
                title: 'Master Data',
                icon: FolderTree,
                allowedRoles: ADMIN_AND_AUDITOR,
                subItems: [
                    { title: 'Versi Aturan', url: '/master/regulatory-rules', icon: GitBranch, allowedRoles: ADMIN_AND_AUDITOR },
                    { title: 'Klasifikasi Arsip', url: '/master/klasifikasi', allowedRoles: ADMIN_ROLES },
                ],
            },
        ]
    }
]

import { useAuth } from '@/context/AuthContext'

export function AppSidebar() {
    const { features, capabilities } = useAppConfig()
    const location = useLocation()
    const { setOpenMobile } = useSidebar()
    const { user } = useAuth()
    const userRole = user?.role || 'user'

    useEffect(() => {
        setOpenMobile(false)
    }, [location.pathname, setOpenMobile])

    // Check if a menu item is visible to the current user
    const isAllowed = (item) => {
        if (item.feature && !features[item.feature]) return false
        if (item.capability && !capabilities[item.capability]) return false
        if (!item.allowedRoles) return true
        return item.allowedRoles.includes(userRole)
    }

    const isActive = (url) => {
        if (url === '/') return location.pathname === '/'
        return location.pathname === url || location.pathname.startsWith(`${url}/`)
    }

    const isParentActive = (item) => {
        if (item.subItems) {
            return item.subItems.some(sub => isActive(sub.url))
        }
        return isActive(item.url)
    }

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader className="border-b border-sidebar-border">
                <div className="flex items-center gap-2.5 px-2 py-2.5">
                    <img
                        src="/logo-simsa.png"
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-md bg-card p-1 ring-1 ring-sidebar-border"
                    />
                    <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
                        <span className="truncate text-sm font-semibold leading-none tracking-tight">{appConfig.shortName}</span>
                        <span className="mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Ditjen PTPP</span>
                    </div>
                </div>
            </SidebarHeader>

            <SidebarContent>
                <nav aria-label="Navigasi utama" className="flex min-h-0 flex-1 flex-col">
                {menuGroups
                    .filter(group => !group.allowedRoles || group.allowedRoles.includes(userRole))
                    .map((group, groupIndex) => {
                        const visibleItems = group.items
                            .filter(isAllowed)
                            .map((item) => item.subItems
                                ? { ...item, subItems: item.subItems.filter(isAllowed) }
                                : item)
                            .filter((item) => !item.subItems || item.subItems.length > 0)
                        if (visibleItems.length === 0) return null
                        return (
                            <SidebarGroup key={group.label} className={groupIndex === 0 ? '' : 'mt-2'}>
                                <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</SidebarGroupLabel>
                                <SidebarGroupContent>
                                    <SidebarMenu>
                                        {visibleItems.map((item) => (
                                            item.subItems ? (
                                                <Collapsible key={item.title} defaultOpen={isParentActive(item)} className="group/collapsible">
                                                    <SidebarMenuItem>
                                                        <CollapsibleTrigger asChild>
                                                            <SidebarMenuButton tooltip={item.title} isActive={isParentActive(item)}>
                                                                <item.icon className="h-4 w-4" />
                                                                <span className="font-medium">{item.title}</span>
                                                                <ChevronDown className="ml-auto h-3 w-3 transition-transform group-data-[state=open]/collapsible:rotate-180 opacity-70" />
                                                            </SidebarMenuButton>
                                                        </CollapsibleTrigger>
                                                        <CollapsibleContent>
                                                            <SidebarMenuSub>
                                                                {item.subItems.map((subItem) => (
                                                                    <SidebarMenuSubItem key={subItem.title}>
                                                                        <SidebarMenuSubButton asChild isActive={isActive(subItem.url)}>
                                                                            <Link to={subItem.url} aria-current={isActive(subItem.url) ? 'page' : undefined}>{subItem.title}</Link>
                                                                        </SidebarMenuSubButton>
                                                                    </SidebarMenuSubItem>
                                                                ))}
                                                            </SidebarMenuSub>
                                                        </CollapsibleContent>
                                                    </SidebarMenuItem>
                                                </Collapsible>
                                            ) : (
                                                <SidebarMenuItem key={item.title}>
                                                    <SidebarMenuButton asChild tooltip={item.title} isActive={isActive(item.url)}>
                                                        <Link to={item.url} aria-current={isActive(item.url) ? 'page' : undefined}>
                                                            <item.icon className="h-4 w-4" />
                                                            <span className="font-medium">{item.title}</span>
                                                        </Link>
                                                    </SidebarMenuButton>
                                                </SidebarMenuItem>
                                            )
                                        ))}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </SidebarGroup>
                        )
                    })}

                <SidebarGroup className="mt-auto">
                    <SidebarGroupContent>
                        <SidebarMenu>
                            <SidebarMenuItem>
                                <SidebarMenuButton asChild tooltip="Panduan Pengguna" isActive={isActive('/panduan')}>
                                    <Link to="/panduan" aria-current={isActive('/panduan') ? 'page' : undefined}>
                                        <BookOpen className="h-4 w-4" />
                                        <span>Panduan</span>
                                    </Link>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
                </nav>
            </SidebarContent>

            <SidebarFooter className="border-t border-sidebar-border/50 p-4">
                <div className="flex flex-col items-start gap-1.5 group-data-[collapsible=icon]:hidden">
                    <div className="text-xs font-medium text-sidebar-foreground/60">{appConfig.name} v1.0.0</div>
                    <Badge variant="outline" className="h-6 px-2 text-[11px] text-sidebar-foreground/75">
                        {appConfig.usageBadge}
                    </Badge>
                </div>
            </SidebarFooter>
        </Sidebar>
    )
}
