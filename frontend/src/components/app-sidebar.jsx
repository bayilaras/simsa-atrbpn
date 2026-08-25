import { Link, useLocation } from 'react-router-dom'
import {
    LayoutDashboard,
    Mail,
    MailOpen,
    Send,
    Archive,
    FileBarChart,
    ClipboardList,
    Settings,
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
    ExternalLink,
    FileKey2,
    CloudCog,
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
} from '@/components/ui/sidebar'
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import appConfig from '@/lib/app-config'
import { useAppConfig } from '@/context/app-config-context'

// Role constants for menu access
const ADMIN_ROLES = ['super_admin', 'admin_dirjen', 'admin_sesditjen']
const STAFF_AND_ABOVE = ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'staff']
const ADMIN_AND_AUDITOR = ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor']
const ALL_PROVISIONED_ROLES = ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor']

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
                allowedRoles: STAFF_AND_ABOVE,
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
                allowedRoles: STAFF_AND_ABOVE,
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
                title: 'Penyusutan',
                url: '/penyusutan',
                icon: Scissors,
                allowedRoles: ADMIN_ROLES,
            },
        ]
    },
    {
        label: 'Layanan & Fisik',
        allowedRoles: ADMIN_ROLES,
        items: [
            {
                title: 'Layanan Arsip',
                url: '/layanan-arsip',
                icon: ClipboardList,
                allowedRoles: ADMIN_ROLES,
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
            },
            {
                title: 'Autentikasi',
                url: '/autentikasi',
                icon: ShieldAlert,
                allowedRoles: ADMIN_ROLES,
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
                allowedRoles: STAFF_AND_ABOVE,
            },
            {
                title: 'Audit Log',
                url: '/audit-log',
                icon: ClipboardList,
                allowedRoles: ADMIN_AND_AUDITOR,
            },
            {
                title: 'Persetujuan Akses',
                url: '/record-access-grants',
                icon: FileKey2,
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
                title: 'User Management',
                url: '/users',
                icon: Users,
                allowedRoles: ['super_admin'],
            },
            {
                title: 'Master Data',
                icon: FolderTree,
                allowedRoles: ADMIN_ROLES,
                subItems: [
                    { title: 'Klasifikasi Arsip', url: '/master/klasifikasi' },
                    { title: 'Template Surat', url: '/settings' },
                ],
            },
        ]
    }
]

import { useAuth } from '@/context/AuthContext'

// URL for the documentation/user guide
const DOCS_URL = 'https://panduan-simsa.vercel.app'

export function AppSidebar() {
    const { features } = useAppConfig()
    const location = useLocation()
    const { user } = useAuth()
    const userRole = user?.role || 'user'

    // Check if a menu item is visible to the current user
    const isAllowed = (item) => {
        if (item.feature && !features[item.feature]) return false
        if (!item.allowedRoles) return true
        return item.allowedRoles.includes(userRole)
    }

    const isActive = (url) => {
        if (url === '/') return location.pathname === '/'
        return location.pathname.startsWith(url)
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
                        <span className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Ditjen PTPP</span>
                    </div>
                </div>
            </SidebarHeader>

            <SidebarContent>
                {menuGroups
                    .filter(group => !group.allowedRoles || group.allowedRoles.includes(userRole))
                    .map((group, groupIndex) => {
                        const visibleItems = group.items.filter(isAllowed)
                        if (visibleItems.length === 0) return null
                        return (
                            <SidebarGroup key={group.label} className={groupIndex === 0 ? '' : 'mt-2'}>
                                <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</SidebarGroupLabel>
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
                                                                            <Link to={subItem.url}>{subItem.title}</Link>
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
                                                        <Link to={item.url}>
                                                            <item.icon className="h-4 w-4" />
                                                            <span className="font-medium">{item.title}</span>
                                                            {/* Badge simulation for Surat Masuk */}
                                                            {(item.title === 'Surat Masuk' || item.title === 'Distribusi') && !isActive(item.url) && (
                                                                <div className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary animate-pulse" />
                                                            )}
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
                            {userRole === 'super_admin' && (
                                <SidebarMenuItem>
                                    <SidebarMenuButton asChild tooltip="Settings" isActive={isActive('/settings')}>
                                        <Link to="/settings">
                                            <Settings className="h-4 w-4" />
                                            <span>Settings</span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            )}
                            <SidebarMenuItem>
                                <SidebarMenuButton asChild tooltip="Panduan Pengguna">
                                    <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                                        <BookOpen className="h-4 w-4" />
                                        <span>Panduan</span>
                                        <ExternalLink className="ml-auto h-3 w-3 opacity-50" />
                                    </a>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter className="border-t border-sidebar-border/50 p-4">
                <div className="flex flex-col items-start gap-1.5 group-data-[collapsible=icon]:hidden">
                    <div className="text-[10px] font-medium text-sidebar-foreground/50">{appConfig.name} v1.0.0</div>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-sidebar-foreground/70">
                        {appConfig.usageBadge}
                    </Badge>
                </div>
            </SidebarFooter>
        </Sidebar>
    )
}
