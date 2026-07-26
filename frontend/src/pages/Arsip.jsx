import { useState, useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { Archive, RefreshCw, Search, Eye, Edit, Clock, Upload, ChevronUp, Trash2, ExternalLink, Inbox, Filter, ChevronDown, CheckCircle2, AlertCircle, FileText, MoreHorizontal, FolderArchive, Building2, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ExportButton } from '@/components/ExportButton'
import { ArchiveLifecycleWidget } from '@/components/ArchiveLifecycleWidget'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useToast } from '@/hooks/use-toast'
import { useDataTable } from '@/hooks/use-data-table'
import {
    Pagination,
    PaginationContent,
    PaginationItem,
} from "@/components/ui/pagination"
import { arsipService } from '@/services/arsip.service'
import settingsService from '@/services/settings.service'
import { TableSkeleton } from '@/components/LoadingSkeletons'

export default function Arsip() {
    const { tab } = useParams()
    const navigate = useNavigate()
    const { user, canWrite } = useAuth()
    const isAdmin = canWrite()
    const isSuperAdmin = user?.role === 'super_admin'
    const { toast } = useToast()

    // Valid tabs
    const validTabs = ['keluar', 'masuk', 'retensi']
    const activeTab = validTabs.includes(tab) ? tab : 'keluar'

    const [searchTerm, setSearchTerm] = useState('')
    const [arsipStats, setArsipStats] = useState({ total: 0, arsipMasuk: 0, arsipKeluar: 0 })
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)

    // Unit kerja filter for super admin
    const [unitKerjaList, setUnitKerjaList] = useState([])
    const [selectedUnitKerja, setSelectedUnitKerja] = useState(isSuperAdmin ? 'all' : (user?.unitKerjaId || undefined))

    // Load unit kerja list for super admin
    useEffect(() => {
        if (isSuperAdmin) {
            settingsService.getAllUnitKerja().then(result => {
                setUnitKerjaList(result.data || result || [])
            }).catch(err => console.error('Failed to load unit kerja list:', err))
        }
    }, [isSuperAdmin])

    // Resolve effective unitKerjaId
    const resolvedUnitKerjaId = isSuperAdmin
        ? (selectedUnitKerja === 'all' ? undefined : selectedUnitKerja)
        : (user?.unitKerjaId || undefined)

    // Fetch arsip stats
    useEffect(() => {
        const fetchArsipStats = async () => {
            try {
                const result = await arsipService.getStats({ unitKerjaId: resolvedUnitKerjaId })
                if (result) {
                    setArsipStats(result)
                }
            } catch (error) {
                console.error('Error fetching arsip stats:', error)
            }
        }
        fetchArsipStats()
    }, [activeTab, resolvedUnitKerjaId])

    // Filter state
    const [tahunFilter, setTahunFilter] = useState('all')

    // Delete dialog state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [selectedArsip, setSelectedArsip] = useState(null)

    // Redirect if tab is invalid
    useEffect(() => {
        if (!validTabs.includes(tab)) {
            navigate('/arsip/keluar', { replace: true })
        }
    }, [tab, navigate])

    const handleTabChange = (value) => {
        navigate(`/arsip/${value}`)
        setSearchTerm('')
        setTahunFilter('all')
    }

    // Data fetching using useDataTable
    const {
        currentData,
        totalPages,
        currentPage,
        nextPage,
        prevPage,
        canNext,
        canPrev,
        setPage,
        isLoading
    } = useDataTable(
        async (page, limit) => {
            if (activeTab === 'retensi') return { data: [], total: 0 }

            try {
                const response = await arsipService.getAll({
                    page,
                    limit,
                    unitKerjaId: resolvedUnitKerjaId,
                    jenisArsip: activeTab,
                    search: searchTerm,
                    tahun: tahunFilter !== 'all' ? parseInt(tahunFilter) : undefined,
                })
                return {
                    data: response.data,
                    total: response.pagination.total,
                }
            } catch (error) {
                console.error('Failed to fetch arsip:', error)
                return { data: [], total: 0 }
            }
        },
        {
            pageSize: 10,
            dependencies: [activeTab, searchTerm, tahunFilter, user, resolvedUnitKerjaId]
        }
    )

    // Action handlers
    const handleViewDetail = (row) => navigate(`/arsip/detail/${row.id}`)

    const handleEdit = (row) => {
        toast({
            title: 'Fitur dalam pengembangan',
            description: 'Halaman edit arsip akan segera tersedia',
        })
    }

    const handleOpenDeleteDialog = (row) => {
        setSelectedArsip(row)
        setDeleteDialogOpen(true)
    }

    const handleDelete = async () => {
        if (!selectedArsip) return
        try {
            await arsipService.delete(selectedArsip.id)
            toast({
                title: 'Berhasil Dihapus',
                description: `Arsip ${selectedArsip.nomorBerkas || ''} telah dihapus`,
            })
            setDeleteDialogOpen(false)
            setSelectedArsip(null)
            setPage(1) // Refresh data

            // Refresh stats
            const stats = await arsipService.getStats({ unitKerjaId: resolvedUnitKerjaId })
            if (stats) setArsipStats(stats)
        } catch (error) {
            toast({
                title: 'Error',
                description: error.message || 'Gagal menghapus arsip',
                variant: 'destructive',
            })
        }
    }

    const hasActiveFilters = tahunFilter !== 'all' || searchTerm

    const clearAllFilters = () => {
        setSearchTerm('')
        setTahunFilter('all')
        setPage(1)
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Page Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <div className="p-2 bg-blue-100 dark:bg-blue-500/15 rounded-lg">
                            <Archive className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        Manajemen Arsip
                    </h1>
                    <p className="text-muted-foreground">
                        Kelola pusat arsip surat dan pantau jadwal retensi
                    </p>
                </div>
                {/* Unit Kerja Selector for Super Admin */}
                {isSuperAdmin && unitKerjaList.length > 0 && (
                    <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <Select value={selectedUnitKerja} onValueChange={(val) => { setSelectedUnitKerja(val); setPage(1); }}>
                            <SelectTrigger className="w-[220px] h-9">
                                <SelectValue placeholder="Pilih Unit Kerja" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">📊 Semua Unit Kerja</SelectItem>
                                {unitKerjaList.map(uk => (
                                    <SelectItem key={uk.id} value={uk.id}>{uk.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => setPage(1)} size="sm" className="h-9">
                        <RefreshCw className={`h-3.5 w-3.5 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>

                    <ExportButton
                        type="arsip"
                        filters={{
                            jenisArsip: activeTab === 'masuk' ? 'masuk' : activeTab === 'keluar' ? 'keluar' : undefined,
                        }}
                    />

                    {isAdmin && (
                        <Link to="/bulk-upload">
                            <Button variant="default" size="sm" className="h-9 shadow-sm hover:shadow-md transition-shadow">
                                <Upload className="mr-2 h-3.5 w-3.5" />
                                Bulk Upload
                            </Button>
                        </Link>
                    )}
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="shadow-sm border-l-4 border-l-blue-500 card-hover">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total Arsip</p>
                            <p className="text-2xl font-bold">{arsipStats.total}</p>
                        </div>
                        <div className="p-2.5 bg-blue-100 dark:bg-blue-500/15 rounded-full text-blue-600 dark:text-blue-400">
                            <FolderArchive className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-emerald-500 card-hover">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Arsip Masuk</p>
                            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{arsipStats.arsipMasuk}</p>
                        </div>
                        <div className="p-2.5 bg-emerald-100 dark:bg-emerald-500/15 rounded-full text-emerald-600 dark:text-emerald-400">
                            <Inbox className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-yellow-500 card-hover">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Arsip Keluar</p>
                            <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{arsipStats.arsipKeluar}</p>
                        </div>
                        <div className="p-2.5 bg-yellow-100 dark:bg-yellow-500/15 rounded-full text-yellow-600 dark:text-yellow-400">
                            <Upload className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Main Content with Tabs */}
            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
                <div className="flex items-center justify-between">
                    <TabsList className="bg-muted/50 p-1">
                        <TabsTrigger value="keluar" className="gap-2">
                            <Upload className="h-4 w-4" /> Arsip Surat Keluar
                        </TabsTrigger>
                        <TabsTrigger value="masuk" className="gap-2">
                            <Inbox className="h-4 w-4" /> Arsip Surat Masuk
                        </TabsTrigger>
                        <TabsTrigger value="retensi" className="gap-2">
                            <Clock className="h-4 w-4" /> Status Retensi
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="retensi" className="space-y-4 outline-none animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                        <div className="md:col-span-2 lg:col-span-2">
                            <ArchiveLifecycleWidget />
                        </div>
                        <Card className="h-fit">
                            <CardHeader className="bg-muted/30 pb-3">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-primary" />
                                    Panduan Retensi
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="text-sm space-y-4 pt-4">
                                <p className="text-muted-foreground leading-relaxed">
                                    Jadwal Retensi Arsip (JRA) mengacu pada <strong>Permen ATR/BPN No. 8 Tahun 2020</strong>.
                                    Sistem akan otomatis menghitung masa retensi aktif dan inaktif berdasarkan klasifikasi arsip.
                                </p>
                                <div className="space-y-3 pt-2">
                                    <div className="flex items-start gap-3">
                                        <Badge variant="secondary" className="mt-0.5 w-20 justify-center">Aktif</Badge>
                                        <div className="space-y-1">
                                            <p className="font-medium text-xs">Masa Retensi Aktif</p>
                                            <p className="text-xs text-muted-foreground">Arsip frekuensi tinggi penggunaannya dan disimpan di unit kerja.</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <Badge variant="outline" className="mt-0.5 w-20 justify-center border-orange-200 bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300">Inaktif</Badge>
                                        <div className="space-y-1">
                                            <p className="font-medium text-xs">Masa Retensi Inaktif</p>
                                            <p className="text-xs text-muted-foreground">Frekuensi rendah, disimpan di pusat arsip.</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <Badge className="mt-0.5 w-20 justify-center bg-primary hover:bg-primary">Permanen</Badge>
                                        <div className="space-y-1">
                                            <p className="font-medium text-xs">Nasib Akhir: Permanen</p>
                                            <p className="text-xs text-muted-foreground">Memiliki nilai guna berkelanjutan, diserahkan ke ANRI.</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <Badge variant="destructive" className="mt-0.5 w-20 justify-center">Musnah</Badge>
                                        <div className="space-y-1">
                                            <p className="font-medium text-xs">Nasib Akhir: Musnah</p>
                                            <p className="text-xs text-muted-foreground">Tidak memiliki nilai guna, dapat dimusnahkan setelah masa retensi habis.</p>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                {/* Shared Content for Masuk/Keluar Tabs */}
                {(activeTab === 'masuk' || activeTab === 'keluar') && (
                    <TabsContent value={activeTab} className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <Card className="shadow-sm border-border/60">
                            <CardHeader className="pb-4">
                                <div className="flex flex-col space-y-4">
                                    <div className="flex flex-col md:flex-row gap-3">
                                        <div className="relative flex-1">
                                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                            <Input
                                                placeholder={`Cari arsip surat ${activeTab}...`}
                                                className="pl-9 bg-background/50 border-input/60 focus:bg-background transition-colors"
                                                value={searchTerm}
                                                onChange={(e) => setSearchTerm(e.target.value)}
                                            />
                                        </div>
                                        <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen} className="flex-none">
                                            <CollapsibleTrigger asChild>
                                                <Button variant="outline" className={`gap-2 w-full md:w-auto ${isAdvancedOpen ? 'bg-muted' : ''}`}>
                                                    <Filter className="h-4 w-4" />
                                                    <span className="hidden sm:inline">Filter</span>
                                                    {tahunFilter !== 'all' && (
                                                        <Badge variant="secondary" className="ml-0.5 h-5 w-5 p-0 justify-center bg-primary/10 text-primary">!</Badge>
                                                    )}
                                                    {isAdvancedOpen ? <ChevronUp className="h-3 w-3 opacity-50" /> : <ChevronDown className="h-3 w-3 opacity-50" />}
                                                </Button>
                                            </CollapsibleTrigger>
                                        </Collapsible>
                                        {hasActiveFilters && (
                                            <Button variant="ghost" size="icon" onClick={clearAllFilters} className="text-muted-foreground hover:text-destructive shrink-0" title="Reset Filters">
                                                <X className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>

                                    <Collapsible open={isAdvancedOpen}>
                                        <CollapsibleContent className="pt-2">
                                            <div className="bg-muted/30 p-4 rounded-lg border border-border/50 flex flex-col md:flex-row gap-4 items-start md:items-end">
                                                <div className="space-y-1.5 w-full md:w-[200px]">
                                                    <label className="text-xs font-semibold text-muted-foreground uppercase">Tahun Arsip</label>
                                                    <Select value={tahunFilter} onValueChange={setTahunFilter}>
                                                        <SelectTrigger className="h-9 bg-background">
                                                            <SelectValue placeholder="Tahun" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="all">Semua Tahun</SelectItem>
                                                            <SelectItem value="2026">2026</SelectItem>
                                                            <SelectItem value="2025">2025</SelectItem>
                                                            <SelectItem value="2024">2024</SelectItem>
                                                            <SelectItem value="2023">2023</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        </CollapsibleContent>
                                    </Collapsible>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="border-t border-border/60">
                                    {isLoading ? (
                                        <div className="p-4">
                                            <TableSkeleton rows={5} columns={7} />
                                        </div>
                                    ) : (
                                        <Table>
                                            <TableHeader className="bg-muted/30">
                                                <TableRow className="hover:bg-transparent">
                                                    <TableHead className="w-[50px] text-center">No.</TableHead>
                                                    <TableHead className="w-[120px]">No. Berkas</TableHead>
                                                    <TableHead className="w-[100px]">Klasifikasi</TableHead>
                                                    <TableHead className="min-w-[200px]">Uraian Berkas</TableHead>
                                                    <TableHead className="w-[150px]">Lokasi</TableHead>
                                                    <TableHead className="w-[120px]">Retensi</TableHead>
                                                    <TableHead className="w-[100px]">Status</TableHead>
                                                    <TableHead className="w-[80px] text-right">Aksi</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {currentData.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={8} className="text-center py-16 text-muted-foreground">
                                                            <div className="flex flex-col items-center justify-center gap-2">
                                                                <div className="p-3 bg-muted rounded-full">
                                                                    <FolderArchive className="h-8 w-8 opacity-50" />
                                                                </div>
                                                                <p className="font-medium">Belum ada data arsip {activeTab}</p>
                                                                <p className="text-sm opacity-70">
                                                                    {searchTerm || hasActiveFilters
                                                                        ? 'Coba sesuaikan filter pencarian Anda'
                                                                        : 'Gunakan menu Arsip di Surat Masuk/Keluar untuk menambahkan data'
                                                                    }
                                                                </p>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    currentData.map((row, index) => (
                                                        <TableRow key={row.id} className="group hover:bg-muted/30 transition-colors">
                                                            <TableCell className="text-center font-medium text-muted-foreground text-xs">
                                                                {(currentPage - 1) * 10 + index + 1}
                                                            </TableCell>
                                                            <TableCell>
                                                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded border border-border">{row.nomorBerkas || '-'}</code>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex flex-col">
                                                                    <span className="font-mono text-xs font-semibold">{row.kodeKlasifikasi || '-'}</span>
                                                                    <span className="text-[10px] text-muted-foreground hidden lg:inline-block truncate max-w-[100px]">{row.klasifikasi || ''}</span>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex flex-col gap-1 max-w-[300px]">
                                                                    <span className="font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors">
                                                                        {row.uraianBerkas || row.perihalOriginal || '-'}
                                                                    </span>
                                                                    {row.jumlahBerkas && (
                                                                        <span className="text-[10px] text-muted-foreground">{row.jumlahBerkas} berkas</span>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-xs text-muted-foreground">
                                                                {row.lokasiFc || row.lokasiLaci || row.lokasiFolder ? (
                                                                    <div className="flex flex-col gap-0.5">
                                                                        <span className="font-medium text-foreground text-xs">{row.lokasiFc || '-'}</span>
                                                                        <span>{row.lokasiLaci || '-'} / {row.lokasiFolder || '-'}</span>
                                                                    </div>
                                                                ) : '-'}
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex flex-col gap-1">
                                                                    <div className="flex items-center gap-1.5 text-xs">
                                                                        <span className="text-[10px] w-8 text-muted-foreground">Aktif:</span>
                                                                        <span className="font-mono">{row.retensiAktif || '-'}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5 text-xs">
                                                                        <span className="text-[10px] w-8 text-muted-foreground">Inaktif:</span>
                                                                        <span className="font-mono">{row.retensiInaktif || '-'}</span>
                                                                    </div>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <Badge variant={row.hasilAkhir === 'Permanen' ? 'default' : row.hasilAkhir === 'Musnah' ? 'destructive' : 'secondary'} className="text-[10px] px-2">
                                                                    {row.hasilAkhir || '-'}
                                                                </Badge>
                                                            </TableCell>
                                                            <TableCell className="text-right">
                                                                <DropdownMenu>
                                                                    <DropdownMenuTrigger asChild>
                                                                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted">
                                                                            <MoreHorizontal className="h-4 w-4" />
                                                                        </Button>
                                                                    </DropdownMenuTrigger>
                                                                    <DropdownMenuContent align="end">
                                                                        <DropdownMenuItem onClick={() => handleViewDetail(row)}>
                                                                            <Eye className="h-4 w-4 mr-2" /> Detail Arsip
                                                                        </DropdownMenuItem>
                                                                        {isAdmin && (
                                                                            <>
                                                                                <DropdownMenuItem onClick={() => handleEdit(row)}>
                                                                                    <Edit className="h-4 w-4 mr-2" /> Edit Info
                                                                                </DropdownMenuItem>
                                                                                <DropdownMenuSeparator />
                                                                                <DropdownMenuItem onClick={() => handleOpenDeleteDialog(row)} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                                                                                    <Trash2 className="h-4 w-4 mr-2" /> Hapus Data
                                                                                </DropdownMenuItem>
                                                                            </>
                                                                        )}
                                                                    </DropdownMenuContent>
                                                                </DropdownMenu>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))
                                                )}
                                            </TableBody>
                                        </Table>
                                    )}
                                </div>
                                {totalPages > 1 && (
                                    <div className="border-t border-border/60 p-4 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
                                        <p className="text-sm text-muted-foreground order-2 sm:order-1">
                                            Halaman <span className="font-medium text-foreground">{currentPage}</span> dari <span className="font-medium text-foreground">{totalPages}</span>
                                        </p>
                                        <div className="order-1 sm:order-2">
                                            <Pagination>
                                                <PaginationContent>
                                                    <PaginationItem>
                                                        <Button variant="outline" size="sm" onClick={prevPage} disabled={!canPrev} className="h-8 w-8 p-0">
                                                            <ChevronUp className="h-4 w-4 rotate-[-90deg]" />
                                                        </Button>
                                                    </PaginationItem>
                                                    <PaginationItem>
                                                        <Button variant="outline" size="sm" onClick={nextPage} disabled={!canNext} className="h-8 w-8 p-0">
                                                            <ChevronUp className="h-4 w-4 rotate-90" />
                                                        </Button>
                                                    </PaginationItem>
                                                </PaginationContent>
                                            </Pagination>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}
            </Tabs>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Hapus Arsip?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Apakah Anda yakin ingin menghapus arsip <strong>{selectedArsip?.nomorBerkas || selectedArsip?.perihalOriginal}</strong>?
                            Tindakan ini tidak dapat dibatalkan. Data surat terkait tidak akan terhapus, hanya status arsipnya.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Hapus
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
