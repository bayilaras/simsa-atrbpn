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

// Menu items grouped by section
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
                subItems: [
                    { title: 'Surat Masuk', url: '/surat/masuk', icon: MailOpen },
                    { title: 'Surat Keluar', url: '/surat/keluar', icon: Send },
                ],
            },
            {
                title: 'Distribusi',
                url: '/distribusi',
                icon: ArrowLeftRight,
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
                subItems: [
                    { title: 'Arsip Surat Masuk', url: '/arsip/masuk' },
                    { title: 'Arsip Surat Keluar', url: '/arsip/keluar' },
                ],
            },
            {
                title: 'Pemberkasan (Dosir)',
                url: '/dosir',
                icon: FolderOpen,
            },
            {
                title: 'Jadwal Retensi',
                url: '/master/jra', // Moved here for easier access
                icon: Clock,
            },
            {
                title: 'Manajemen Retensi',
                url: '/retention',
                icon: FileBarChart,
            },
            {
                title: 'Penyusutan',
                url: '/penyusutan',
                icon: Scissors,
            },
        ]
    },
    {
        label: 'Layanan & Fisik',
        items: [
            {
                title: 'Layanan Arsip',
                url: '/layanan-arsip',
                icon: ClipboardList,
            },
            {
                title: 'Peminjaman',
                url: '/archive-lending',
                icon: ArrowLeftRight,
            },
            {
                title: 'Lokasi Simpan',
                url: '/storage-locations',
                icon: MapPin,
            },
            {
                title: 'Arsip Vital',
                url: '/arsip-vital',
                icon: ShieldAlert,
                adminOnly: true,
            },
            {
                title: 'Arsip Terjaga',
                url: '/arsip-terjaga',
                icon: Lock,
                adminOnly: true,
            },
        ]
    },
    {
        label: 'Media & Autentikasi',
        items: [
            {
                title: 'Arsip Elektronik',
                url: '/arsip-elektronik',
                icon: HardDrive,
            },
            {
                title: 'Autentikasi',
                url: '/autentikasi',
                icon: ShieldAlert,
            },
            {
                title: 'Tunjuk Silang',
                url: '/tunjuk-silang',
                icon: Link2,
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
            },
            {
                title: 'Audit Log',
                url: '/audit-log',
                icon: ClipboardList,
            },
            {
                title: 'User Management',
                url: '/users',
                icon: Users,
                adminOnly: true,
            },
            {
                title: 'Master Data',
                icon: FolderTree,
                adminOnly: true,
                subItems: [
                    { title: 'Klasifikasi Arsip', url: '/master/klasifikasi' },
                    // JRA moved to Siklus Hidup for better access
                    { title: 'Template Surat', url: '/settings' }, // Redirect to settings for now
                ],
            },
        ]
    }
]

import { useAuth } from '@/context/AuthContext'

export function AppSidebar() {
    const location = useLocation()
    const { hasRole } = useAuth()
    const isAdmin = hasRole(['super_admin'])

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
            <SidebarHeader className="border-b border-sidebar-border/50 bg-gradient-to-r from-sidebar-primary/10 to-transparent">
                <div className="flex items-center gap-3 px-2 py-3">
                    <div className="relative">
                        <div className="absolute inset-0 bg-sidebar-primary/20 blur-md rounded-full"></div>
                        <img
                            src="/logo-simsa.png"
                            alt="Logo"
                            className="relative h-9 w-9 rounded-lg bg-white p-1 shadow-sm transition-transform hover:scale-105"
                        />
                    </div>
                    <div className="flex flex-col group-data-[collapsible=icon]:hidden">
                        <span className="font-bold text-lg leading-none tracking-tight">SIMSA</span>
                        <span className="text-[10px] uppercase tracking-wider text-sidebar-primary font-medium">ATR/BPN</span>
                    </div>
                </div>
            </SidebarHeader>

            <SidebarContent>
                {menuGroups.map((group, groupIndex) => (
                    <SidebarGroup key={group.label} className={groupIndex === 0 ? '' : 'mt-2'}>
                        <SidebarGroupLabel className="text-[10px] uppercase tracking-widest font-semibold text-sidebar-foreground/50">{group.label}</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                {group.items.filter(item => !item.adminOnly || isAdmin).map((item) => (
                                    item.subItems ? (
                                        <Collapsible key={item.title} defaultOpen={isParentActive(item)} className="group/collapsible">
                                            <SidebarMenuItem>
                                                <CollapsibleTrigger asChild>
                                                    <SidebarMenuButton tooltip={item.title} isActive={isParentActive(item)} className="transition-all duration-200">
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
                                            <SidebarMenuButton asChild tooltip={item.title} isActive={isActive(item.url)} className="transition-all duration-200">
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
                ))}

                <SidebarGroup className="mt-auto">
                    <SidebarGroupContent>
                        <SidebarMenu>
                            <SidebarMenuItem>
                                <SidebarMenuButton asChild tooltip="Settings" isActive={isActive('/settings')}>
                                    <Link to="/settings">
                                        <Settings className="h-4 w-4" />
                                        <span>Settings</span>
                                    </Link>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter className="border-t border-sidebar-border/50 p-4">
                <div className="flex items-center justify-between group-data-[collapsible=icon]:hidden">
                    <div className="text-[10px] text-sidebar-foreground/50 font-medium">SIMSA v1.0.0</div>
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-sidebar-border/50 text-sidebar-foreground/50">BETA</Badge>
                </div>
            </SidebarFooter>
        </Sidebar>
    )
}
