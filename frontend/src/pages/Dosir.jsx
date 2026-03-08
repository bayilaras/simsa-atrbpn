import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, Plus, FolderOpen, Loader2, Calendar, FileText, ArrowRight, Edit2, Trash2, Clock, CheckCircle2, Archive, MailPlus, MailMinus, Eye, Filter, MoreHorizontal, Folder, Building2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import dosirService from '@/services/dosir.service'
import settingsService from '@/services/settings.service'
import { format, parseISO } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'
import { useNavigate } from 'react-router-dom'
import { Skeleton } from "@/components/ui/skeleton"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const STATUS_CONFIG = {
    open: { label: 'Aktif', variant: 'default', icon: FolderOpen, className: 'bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200' },
    closed: { label: 'Selesai', variant: 'secondary', icon: CheckCircle2, className: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200' },
    archived: { label: 'Diarsipkan', variant: 'outline', icon: Archive, className: 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200' },
}

const KATEGORI_OPTIONS = [
    'Sengketa Tanah',
    'Pengadaan Tanah',
    'Sertipikat',
    'Hak Tanggungan',
    'Peralihan Hak',
    'Layanan Publik',
    'Administrasi Internal',
    'Lainnya',
]

function DosirSkeleton() {
    return (
        <Card className="overflow-hidden">
            <CardHeader className="pb-2 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent>
                <Skeleton className="h-12 w-full mb-4" />
                <div className="flex gap-2">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-16" />
                </div>
            </CardContent>
            <CardFooter>
                <Skeleton className="h-9 w-full" />
            </CardFooter>
        </Card>
    )
}

export default function Dosir() {
    const { user } = useAuth()
    const navigate = useNavigate()
    const isSuperAdmin = user?.role === 'super_admin'
    const [dosirList, setDosirList] = useState([])
    const [stats, setStats] = useState({ total: 0, open: 0, closed: 0, archived: 0 })
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [kategoriFilter, setKategoriFilter] = useState('all')
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [createLoading, setCreateLoading] = useState(false)
    const [formData, setFormData] = useState({
        judul: '',
        deskripsi: '',
        kategori: '',
        tanggalMulai: '',
    })

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

    const fetchData = useCallback(async () => {
        try {
            setLoading(true)
            const [dosirRes, statsRes] = await Promise.all([
                dosirService.getAll({
                    search,
                    status: statusFilter === 'all' ? '' : statusFilter,
                    kategori: kategoriFilter === 'all' ? '' : kategoriFilter,
                    unitKerjaId: resolvedUnitKerjaId,
                }),
                dosirService.getStats(),
            ])
            setDosirList(dosirRes.data || [])
            setStats(statsRes.data || { total: 0, open: 0, closed: 0, archived: 0 })
        } catch (error) {
            console.error('Error fetching dosir:', error)
        } finally {
            setLoading(false)
        }
    }, [search, statusFilter, kategoriFilter, resolvedUnitKerjaId])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    const handleCreate = async () => {
        if (!formData.judul.trim()) return

        try {
            setCreateLoading(true)
            await dosirService.create(formData)
            setIsCreateOpen(false)
            setFormData({ judul: '', deskripsi: '', kategori: '', tanggalMulai: '' })
            fetchData()
        } catch (error) {
            console.error('Error creating dosir:', error)
        } finally {
            setCreateLoading(false)
        }
    }

    const handleDelete = async (id) => {
        if (!confirm('Apakah Anda yakin ingin menghapus dosir ini?')) return

        try {
            await dosirService.delete(id)
            fetchData()
        } catch (error) {
            console.error('Error deleting dosir:', error)
        }
    }

    const formatDate = (dateStr) => {
        if (!dateStr) return '-'
        try {
            return format(parseISO(dateStr), 'dd MMM yyyy', { locale: idLocale })
        } catch {
            return dateStr
        }
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <div className="p-2 bg-indigo-100 rounded-lg">
                            <FolderOpen className="h-6 w-6 text-indigo-600" />
                        </div>
                        Pemberkasan Perkara (Dosir)
                    </h1>
                    <p className="text-muted-foreground">
                        Kelola folder digital untuk mengelompokkan surat berdasarkan kasus
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Unit Kerja Selector for Super Admin */}
                    {isSuperAdmin && unitKerjaList.length > 0 && (
                        <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            <Select value={selectedUnitKerja} onValueChange={setSelectedUnitKerja}>
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
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button className="h-9 shadow-sm bg-indigo-600 hover:bg-indigo-700">
                                <Plus className="h-4 w-4 mr-2" />
                                Buat Dosir Baru
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[500px]">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <Folder className="h-5 w-5 text-indigo-600" />
                                    Buat Dosir Baru
                                </DialogTitle>
                                <DialogDescription>
                                    Buat folder digital untuk mengelompokkan surat terkait
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="space-y-2">
                                    <Label htmlFor="judul">Judul Perkara *</Label>
                                    <Input
                                        id="judul"
                                        value={formData.judul}
                                        onChange={(e) => setFormData(prev => ({ ...prev, judul: e.target.value }))}
                                        placeholder="Contoh: Sengketa Tanah PT Maju Jaya"
                                        className="col-span-3"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="kategori">Kategori</Label>
                                        <Select
                                            value={formData.kategori}
                                            onValueChange={(val) => setFormData(prev => ({ ...prev, kategori: val }))}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Pilih kategori" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {KATEGORI_OPTIONS.map(kat => (
                                                    <SelectItem key={kat} value={kat}>{kat}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="tanggalMulai">Tanggal Mulai</Label>
                                        <Input
                                            id="tanggalMulai"
                                            type="date"
                                            value={formData.tanggalMulai}
                                            onChange={(e) => setFormData(prev => ({ ...prev, tanggalMulai: e.target.value }))}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="deskripsi">Deskripsi</Label>
                                    <Textarea
                                        id="deskripsi"
                                        value={formData.deskripsi}
                                        onChange={(e) => setFormData(prev => ({ ...prev, deskripsi: e.target.value }))}
                                        placeholder="Deskripsi singkat tentang perkara ini"
                                        rows={3}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                                    Batal
                                </Button>
                                <Button onClick={handleCreate} disabled={createLoading || !formData.judul.trim()} className="bg-indigo-600 hover:bg-indigo-700">
                                    {createLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    Buat Dosir
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card className="shadow-sm border-l-4 border-l-slate-500 card-hover">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Dosir</CardTitle>
                        <div className="p-2 bg-slate-100 rounded-full">
                            <FolderOpen className="h-4 w-4 text-slate-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-slate-700">{stats.total}</div>
                        <p className="text-xs text-muted-foreground mt-1">Total seluruh dosir</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-blue-500 card-hover">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Aktif</CardTitle>
                        <div className="p-2 bg-blue-100 rounded-full">
                            <FolderOpen className="h-4 w-4 text-blue-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-600">{stats.open}</div>
                        <p className="text-xs text-muted-foreground mt-1">Dosir sedang berjalan</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-emerald-500 card-hover">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Selesai</CardTitle>
                        <div className="p-2 bg-emerald-100 rounded-full">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-600">{stats.closed}</div>
                        <p className="text-xs text-muted-foreground mt-1">Dosir telah selesai</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-amber-500 card-hover">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Diarsipkan</CardTitle>
                        <div className="p-2 bg-amber-100 rounded-full">
                            <Archive className="h-4 w-4 text-amber-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-amber-600">{stats.archived}</div>
                        <p className="text-xs text-muted-foreground mt-1">Dosir diarsipkan</p>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <Card className="shadow-sm border-border/60">
                <CardContent className="pt-6">
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Cari judul, kode, atau deskripsi dosir..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9 bg-muted/50 focus:bg-background"
                            />
                        </div>
                        <div className="flex gap-4">
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-[180px] bg-muted/50 focus:bg-background">
                                    <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                                    <SelectValue placeholder="Semua Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Semua Status</SelectItem>
                                    <SelectItem value="open">Aktif</SelectItem>
                                    <SelectItem value="closed">Selesai</SelectItem>
                                    <SelectItem value="archived">Diarsipkan</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={kategoriFilter} onValueChange={setKategoriFilter}>
                                <SelectTrigger className="w-[200px] bg-muted/50 focus:bg-background">
                                    <Folder className="h-4 w-4 mr-2 text-muted-foreground" />
                                    <SelectValue placeholder="Semua Kategori" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Semua Kategori</SelectItem>
                                    {KATEGORI_OPTIONS.map(kat => (
                                        <SelectItem key={kat} value={kat}>{kat}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Dosir List */}
            {loading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3, 4, 5, 6].map(i => <DosirSkeleton key={i} />)}
                </div>
            ) : dosirList.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="py-16 text-center flex flex-col items-center justify-center">
                        <div className="p-4 bg-muted rounded-full mb-4">
                            <FolderOpen className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">Belum ada dosir</h3>
                        <p className="text-muted-foreground mb-6 max-w-sm">
                            Mulai dengan membuat dosir baru untuk mengelompokkan surat-menyurat berdasarkan perkara atau topik.
                        </p>
                        <Button onClick={() => setIsCreateOpen(true)} className="bg-indigo-600 hover:bg-indigo-700">
                            <Plus className="h-4 w-4 mr-2" />
                            Buat Dosir Pertama
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {dosirList.map((item) => {
                        const statusConf = STATUS_CONFIG[item.status] || STATUS_CONFIG.open
                        const StatusIcon = statusConf.icon

                        return (
                            <Card key={item.id} className="group hover:shadow-lg transition-all duration-300 border-border/60 hover:border-indigo-200">
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                <Badge variant="outline" className={`text-[10px] uppercase tracking-wider font-semibold ${statusConf.className}`}>
                                                    <StatusIcon className="h-3 w-3 mr-1" />
                                                    {statusConf.label}
                                                </Badge>
                                                {item.kategori && (
                                                    <Badge variant="secondary" className="text-[10px] bg-muted/50">
                                                        {item.kategori}
                                                    </Badge>
                                                )}
                                            </div>
                                            <CardTitle className="text-lg font-bold line-clamp-1 group-hover:text-indigo-600 transition-colors" title={item.judul}>
                                                {item.judul}
                                            </CardTitle>
                                            <CardDescription className="text-xs font-mono mt-1 text-muted-foreground/80">
                                                {item.kode}
                                            </CardDescription>
                                        </div>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" className="h-8 w-8 p-0">
                                                    <span className="sr-only">Open menu</span>
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuLabel>Aksi</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => navigate(`/dosir/${item.id}`)}>
                                                    <Eye className="mr-2 h-4 w-4" /> Lihat Detail
                                                </DropdownMenuItem>
                                                <DropdownMenuItem>
                                                    <Edit2 className="mr-2 h-4 w-4" /> Edit
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onClick={() => handleDelete(item.id)} className="text-destructive focus:text-destructive">
                                                    <Trash2 className="mr-2 h-4 w-4" /> Hapus
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </CardHeader>
                                <CardContent className="pb-4">
                                    <p className="text-sm text-muted-foreground line-clamp-2 h-10 mb-4">
                                        {item.deskripsi || <span className="italic opacity-50">Tidak ada deskripsi</span>}
                                    </p>
                                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground bg-muted/30 p-2 rounded-md">
                                        <div className="flex items-center gap-1.5">
                                            <MailPlus className="h-3.5 w-3.5 text-blue-500" />
                                            <span className="font-medium">{item.suratMasukCount || 0}</span> Masuk
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <MailMinus className="h-3.5 w-3.5 text-orange-500" />
                                            <span className="font-medium">{item.suratKeluarCount || 0}</span> Keluar
                                        </div>
                                        {item.tanggalMulai && (
                                            <div className="col-span-2 flex items-center gap-1.5 pt-1 mt-1 border-t border-border/50">
                                                <Calendar className="h-3.5 w-3.5" />
                                                <span>Mulai: {formatDate(item.tanggalMulai)}</span>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                                <CardFooter className="pt-0">
                                    <Button
                                        className="w-full bg-muted/50 hover:bg-indigo-50 text-foreground hover:text-indigo-700 border border-border/50 hover:border-indigo-200 transition-all font-medium"
                                        variant="outline"
                                        onClick={() => navigate(`/dosir/${item.id}`)}
                                    >
                                        Buka Dosir <ArrowRight className="ml-2 h-4 w-4" />
                                    </Button>
                                </CardFooter>
                            </Card>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
