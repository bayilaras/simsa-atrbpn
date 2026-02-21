import { useState, useMemo } from 'react'
import { Bell, Building2, Users, ChevronDown, LogOut, User, Settings, AlertCircle, Clock, FileText, Archive, Loader2, Moon, Sun, Search, CheckCircle2, RefreshCw, BookOpen, ExternalLink } from 'lucide-react'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import { useNotifications } from '@/hooks/useNotifications'
import { useTheme } from '@/components/theme-provider'
import { GlobalSearch, useGlobalSearchShortcut } from '@/components/GlobalSearch'
import { useAuth } from '@/context/AuthContext'
import { useNavigate } from 'react-router-dom'

// Role label mapping for display in Indonesian
const ROLE_LABELS = {
    super_admin: 'Super Admin',
    admin_dirjen: 'Admin Dirjen',
    admin_sesditjen: 'Admin Sesditjen',
    user: 'Pengguna',
}

// Unit kerja options for super admin notification filter
const UNIT_KERJA_OPTIONS = [
    { id: 'ditjen', label: 'Dirjen PTPP' },
    { id: 'sesditjen', label: 'Sesditjen' },
    { id: 'dir_bppt', label: 'Dir. BPPT' },
    { id: 'dir_ptep', label: 'Dir. PTEP' },
    { id: 'dir_ktpp', label: 'Dir. KTPP' },
    { id: 'dir_plp', label: 'Dir. PLP' },
]

export function AppHeader() {
    const { user: authUser, signOut } = useAuth()
    const navigate = useNavigate()

    const [searchOpen, setSearchOpen] = useState(false)
    const [activeTab, setActiveTab] = useState('all') // 'all', 'surat-masuk', 'arsip-retensi'
    const { setTheme } = useTheme()

    // Super admin can switch unit kerja for notifications
    const isSuperAdmin = authUser?.role === 'super_admin'
    const [selectedUnitKerja, setSelectedUnitKerja] = useState(authUser?.unitKerjaId || 'ditjen')
    const notifUnitKerjaId = isSuperAdmin ? selectedUnitKerja : authUser?.unitKerjaId

    const { notifications, counts, loading, hasUrgent, refresh, markAsRead, markAllAsRead, getByCategory, suratCount, arsipCount } = useNotifications({
        unitKerjaId: notifUnitKerjaId,
        limit: 20,
        refreshInterval: 60000, // Refresh every minute
    })

    // Get label for selected unit kerja
    const selectedUnitLabel = useMemo(() => {
        return UNIT_KERJA_OPTIONS.find(u => u.id === selectedUnitKerja)?.label || selectedUnitKerja
    }, [selectedUnitKerja])

    const filteredNotifications = getByCategory(activeTab)

    const handleNotificationClick = (notif) => {
        markAsRead(notif.id)

        if (notif.category === 'surat-masuk') {
            navigate(`/surat/masuk/${notif.referenceId}`)
        } else if (notif.category === 'arsip-retensi') {
            navigate(`/arsip`)
        }
    }

    const handleMarkAllAsRead = () => {
        if (activeTab === 'all') {
            markAllAsRead()
        } else {
            markAllAsRead(activeTab)
        }
    }

    // Get user display data from authenticated user
    const user = {
        name: authUser?.name || 'Guest',
        email: authUser?.email || '',
        role: ROLE_LABELS[authUser?.role] || authUser?.role || 'User',
        image: authUser?.image || null,
        initials: authUser?.name ? authUser.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'G',
    }

    // Global search keyboard shortcut (Cmd+K / Ctrl+K)
    useGlobalSearchShortcut(() => setSearchOpen(true))

    return (
        <>
            <header className="sticky top-0 z-50 flex h-16 items-center gap-4 border-b border-border/40 bg-background/80 backdrop-blur-md px-6 shadow-sm transition-all duration-300">
                <SidebarTrigger className="hover:bg-accent/50 hover:text-accent-foreground transition-colors" />
                <Separator orientation="vertical" className="h-6 opacity-50" />

                {/* Unit Kerja Label */}
                {authUser?.unitKerjaId && (
                    <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                        <Building2 className="h-3.5 w-3.5" />
                        <span>
                            {authUser.unitKerjaId === 'dirjen' ? 'Dirjen PTPP' : authUser.unitKerjaId === 'sesditjen' ? 'Sesditjen' : authUser.unitKerjaId}
                        </span>
                    </div>
                )}

                {/* Global Search Button */}
                <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-64 justify-start text-muted-foreground bg-muted/30 border-input/50 focus-within:ring-2 focus-within:ring-primary/20 hover:bg-muted/50 transition-all ml-2"
                    onClick={() => setSearchOpen(true)}
                >
                    <Search className="mr-2 h-4 w-4 opacity-50" />
                    <span className="text-xs">Cari surat, arsip...</span>
                    <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground shadow-sm">
                        <span className="text-xs">⌘</span>K
                    </kbd>
                </Button>

                <div className="flex-1" />

                {/* Theme Toggle */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-accent/50">
                            <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                            <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                            <span className="sr-only">Toggle theme</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setTheme("light")}>
                            Light
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTheme("dark")}>
                            Dark
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTheme("system")}>
                            System
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Notifications */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-full hover:bg-accent/50">
                            {loading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Bell className={`h-4 w-4 transition-colors ${hasUrgent ? 'text-destructive animate-pulse' : ''}`} />
                            )}
                            {counts.total > 0 && (
                                <span className={`absolute top-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white shadow-sm ring-2 ring-background ${hasUrgent ? 'bg-destructive' : 'bg-primary'}`}>
                                    {counts.total > 9 ? '9+' : counts.total}
                                </span>
                            )}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[400px] p-0">
                        <div className="flex items-center justify-between p-4 pb-2">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 rounded-full bg-primary/10 text-primary">
                                    <Bell className="h-4 w-4" />
                                </div>
                                <span className="font-semibold text-sm">Notifikasi</span>
                            </div>
                            {filteredNotifications.length > 0 && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 rounded-full hover:bg-primary/10 hover:text-primary transition-colors"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    handleMarkAllAsRead();
                                                }}
                                            >
                                                <CheckCircle2 className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {activeTab === 'all' ? 'Tandai semua sudah dibaca' : `Tandai semua ${activeTab === 'surat-masuk' ? 'surat' : 'arsip'} sudah dibaca`}
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                        </div>

                        {/* Super Admin: Unit Kerja Selector */}
                        {isSuperAdmin && (
                            <div className="px-4 pb-2">
                                <div className="flex items-center gap-2">
                                    <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                    <select
                                        value={selectedUnitKerja}
                                        onChange={(e) => setSelectedUnitKerja(e.target.value)}
                                        className="flex-1 text-xs font-medium rounded-md border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors cursor-pointer hover:bg-accent/50"
                                    >
                                        {UNIT_KERJA_OPTIONS.map(unit => (
                                            <option key={unit.id} value={unit.id}>{unit.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}

                        {/* Category Tabs: Surat | Arsip | Semua */}
                        <div className="px-4 pb-2">
                            <div className="flex rounded-lg bg-muted/50 p-1 gap-1">
                                <button
                                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${activeTab === 'surat-masuk'
                                        ? 'bg-background shadow-sm text-foreground'
                                        : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
                                        }`}
                                    onClick={(e) => { e.preventDefault(); setActiveTab('surat-masuk'); }}
                                >
                                    <FileText className="h-3 w-3" />
                                    <span>Surat</span>
                                    {suratCount > 0 && (
                                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 text-[10px] font-semibold px-1">
                                            {suratCount}
                                        </span>
                                    )}
                                </button>
                                <button
                                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${activeTab === 'arsip-retensi'
                                        ? 'bg-background shadow-sm text-foreground'
                                        : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
                                        }`}
                                    onClick={(e) => { e.preventDefault(); setActiveTab('arsip-retensi'); }}
                                >
                                    <Archive className="h-3 w-3" />
                                    <span>Arsip</span>
                                    {arsipCount > 0 && (
                                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 text-[10px] font-semibold px-1">
                                            {arsipCount}
                                        </span>
                                    )}
                                </button>
                                <button
                                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${activeTab === 'all'
                                        ? 'bg-background shadow-sm text-foreground'
                                        : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
                                        }`}
                                    onClick={(e) => { e.preventDefault(); setActiveTab('all'); }}
                                >
                                    <Bell className="h-3 w-3" />
                                    <span>Semua</span>
                                    {counts.total > 0 && (
                                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted text-muted-foreground text-[10px] font-semibold px-1">
                                            {counts.total}
                                        </span>
                                    )}
                                </button>
                            </div>
                        </div>

                        <DropdownMenuSeparator className="my-0" />

                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
                            </div>
                        ) : filteredNotifications.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/70">
                                <div className="bg-muted/50 p-4 rounded-full mb-3 ring-1 ring-border/50">
                                    {activeTab === 'surat-masuk' ? (
                                        <FileText className="h-6 w-6 opacity-50" />
                                    ) : activeTab === 'arsip-retensi' ? (
                                        <Archive className="h-6 w-6 opacity-50" />
                                    ) : (
                                        <CheckCircle2 className="h-6 w-6 opacity-50" />
                                    )}
                                </div>
                                <p className="text-sm font-medium">
                                    {activeTab === 'surat-masuk' ? 'Semua surat sudah diproses!' :
                                        activeTab === 'arsip-retensi' ? 'Tidak ada arsip mendekati kadaluarsa' :
                                            'Semua sudah dibaca!'}
                                </p>
                                <p className="text-xs mt-1">
                                    {activeTab === 'surat-masuk' ? 'Tidak ada surat masuk yang perlu ditindaklanjuti.' :
                                        activeTab === 'arsip-retensi' ? 'Jadwal retensi arsip aman untuk saat ini.' :
                                            'Tidak ada notifikasi baru saat ini.'}
                                </p>
                            </div>
                        ) : (
                            <div className="max-h-[350px] overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                                {filteredNotifications.map((notif) => (
                                    <DropdownMenuItem
                                        key={notif.id}
                                        className="flex items-start gap-3 p-3 cursor-pointer focus:bg-accent/50 mx-2 my-1 rounded-lg border border-transparent hover:border-border/50 transition-colors"
                                        onClick={() => handleNotificationClick(notif)}
                                    >
                                        <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full flex-shrink-0 shadow-sm ring-1 ring-black/5 ${notif.type === 'urgent' ? 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400' :
                                            notif.type === 'warning' ? 'bg-yellow-50 text-yellow-600 dark:bg-yellow-950/50 dark:text-yellow-400' :
                                                'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
                                            }`}>
                                            {notif.category === 'surat-masuk' ? (
                                                <FileText className="h-3.5 w-3.5" />
                                            ) : (
                                                <Archive className="h-3.5 w-3.5" />
                                            )}
                                        </div>
                                        <div className="flex-1 space-y-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="text-sm font-medium leading-none truncate">{notif.title}</p>
                                                {notif.type === 'urgent' && (
                                                    <span className="flex h-1.5 w-1.5 rounded-full bg-destructive flex-shrink-0 mt-1 animate-pulse" />
                                                )}
                                            </div>
                                            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{notif.message}</p>
                                            <div className="flex items-center justify-between pt-1.5">
                                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium bg-muted/30 px-1.5 py-0.5 rounded-md">
                                                    <Clock className="h-3 w-3" />
                                                    {notif.category === 'surat-masuk'
                                                        ? `${notif.daysLeft} hari sejak diterima`
                                                        : `${notif.daysLeft} hari lagi`
                                                    }
                                                </div>
                                                {/* Category badge */}
                                                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-md ${notif.category === 'surat-masuk'
                                                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400'
                                                    : 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400'
                                                    }`}>
                                                    {notif.category === 'surat-masuk' ? 'Surat' : 'Retensi'}
                                                </span>
                                            </div>
                                        </div>
                                    </DropdownMenuItem>
                                ))}
                            </div>
                        )}

                        <DropdownMenuSeparator className="my-0" />
                        <div className="p-2 bg-muted/20">
                            <DropdownMenuItem className="justify-center text-primary cursor-pointer font-medium text-xs rounded-md hover:bg-primary/5 hover:text-primary transition-colors h-8" onClick={refresh}>
                                <RefreshCw className="mr-2 h-3 w-3" />
                                Refresh Notifikasi
                            </DropdownMenuItem>
                        </div>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* User Menu */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="gap-3 pl-2 h-10 rounded-full hover:bg-accent/50 pr-4">
                            <Avatar className="h-8 w-8 ring-2 ring-background shadow-sm transition-transform hover:scale-105">
                                {user.image && (
                                    <AvatarImage src={user.image} alt={user.name} referrerPolicy="no-referrer" />
                                )}
                                <AvatarFallback className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground text-xs font-bold">{user.initials}</AvatarFallback>
                            </Avatar>
                            <div className="hidden flex-col items-start md:flex gap-0.5">
                                <span className="text-sm font-semibold leading-none">{user.name}</span>
                                <Badge variant="secondary" className="h-4 px-1.5 text-[9px] font-medium bg-secondary/20 text-secondary-foreground shadow-none">{user.role}</Badge>
                            </div>
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground opacity-50" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 p-2">
                        <DropdownMenuLabel className="p-2">
                            <div className="flex flex-col space-y-1">
                                <p className="font-medium text-sm">{user.name}</p>
                                <p className="text-xs text-muted-foreground font-normal">{user.email}</p>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild className="cursor-pointer rounded-md">
                            <a href="/settings" className="flex items-center">
                                <User className="mr-2 h-4 w-4 text-muted-foreground" />
                                Profil Saya
                            </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild className="cursor-pointer rounded-md">
                            <a href="/settings" className="flex items-center">
                                <Settings className="mr-2 h-4 w-4 text-muted-foreground" />
                                Pengaturan
                            </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild className="cursor-pointer rounded-md">
                            <a href="https://bayilaras.gitbook.io/panduan-simsa" target="_blank" rel="noopener noreferrer" className="flex items-center">
                                <BookOpen className="mr-2 h-4 w-4 text-muted-foreground" />
                                Panduan Pengguna
                                <ExternalLink className="ml-auto h-3 w-3 opacity-50" />
                            </a>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive cursor-pointer rounded-md bg-destructive/5 focus:bg-destructive/10">
                            <LogOut className="mr-2 h-4 w-4" />
                            Keluar
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </header>

            {/* Global Search Dialog */}
            <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
        </>
    )
}
