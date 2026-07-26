import { useState, useEffect, useCallback } from 'react'
import {
    Link2, Search, Plus, Trash2, RefreshCw, ArrowRight, ArrowLeft,
    FileText, Mail, Send, FolderOpen, ChevronUp, Info, ExternalLink,
    Filter, MoreHorizontal, ArrowRightLeft, Target, GitMerge
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { tunjukSilangService } from '@/services/tunjuk-silang.service'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

const ENTITY_TYPES = [
    { value: 'arsip', label: 'Arsip', icon: FileText, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/15' },
    { value: 'surat_masuk', label: 'Surat Masuk', icon: Mail, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-500/15' },
    { value: 'surat_keluar', label: 'Surat Keluar', icon: Send, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-500/15' },
    { value: 'dosir', label: 'Dosir', icon: FolderOpen, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-500/15' },
]

const RELASI_TYPES = [
    { value: 'balasan', label: 'Balasan', color: 'bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-200' },
    { value: 'tindak_lanjut', label: 'Tindak Lanjut', color: 'bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300 border-green-200' },
    { value: 'lampiran', label: 'Lampiran', color: 'bg-purple-100 dark:bg-purple-500/15 text-purple-800 dark:text-purple-300 border-purple-200' },
    { value: 'referensi', label: 'Referensi', color: 'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-800 dark:text-yellow-300 border-yellow-200' },
    { value: 'revisi', label: 'Revisi', color: 'bg-orange-100 dark:bg-orange-500/15 text-orange-800 dark:text-orange-300 border-orange-200' },
    { value: 'duplikat', label: 'Duplikat', color: 'bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300 border-red-200' },
    { value: 'berkaitan', label: 'Berkaitan', color: 'bg-muted text-foreground border-border' },
]

const getEntityIcon = (type) => {
    const found = ENTITY_TYPES.find(e => e.value === type)
    return found ? found.icon : FileText
}

const getEntityLabel = (type) => {
    const found = ENTITY_TYPES.find(e => e.value === type)
    return found ? found.label : type
}

const getEntityStyle = (type) => {
    const found = ENTITY_TYPES.find(e => e.value === type)
    return found || { color: 'text-muted-foreground', bg: 'bg-muted/50' }
}

const getRelasiConfig = (relasi) => {
    return RELASI_TYPES.find(r => r.value === relasi) || { label: relasi, color: 'bg-muted text-foreground border-border' }
}

export default function TunjukSilang() {
    const [data, setData] = useState([])
    const [stats, setStats] = useState(null)
    const [loading, setLoading] = useState(false)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [total, setTotal] = useState(0)
    const [filterRelasi, setFilterRelasi] = useState('all')
    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const { toast } = useToast()
    const [activeTab, setActiveTab] = useState('list')

    // Lookup state
    const [lookupType, setLookupType] = useState('arsip')
    const [lookupId, setLookupId] = useState('')
    const [lookupResults, setLookupResults] = useState(null)
    const [lookupLoading, setLookupLoading] = useState(false)

    // Add form
    const [newRef, setNewRef] = useState({
        sourceType: 'arsip', sourceId: '',
        targetType: 'surat_masuk', targetId: '',
        jenisRelasi: 'referensi', keterangan: '',
    })

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const filters = { page, limit: 20 }
            if (filterRelasi !== 'all') filters.jenisRelasi = filterRelasi
            const result = await tunjukSilangService.getAll(filters)
            setData(result.data || [])
            setTotalPages(result.totalPages || 1)
            setTotal(result.total || 0)
        } catch (err) {
            console.error('Error:', err)
        }
        setLoading(false)
    }, [page, filterRelasi])

    const fetchStats = useCallback(async () => {
        try {
            const result = await tunjukSilangService.getStats()
            setStats(result)
        } catch (err) {
            console.error('Error:', err)
        }
    }, [])

    useEffect(() => { fetchData(); fetchStats(); }, [fetchData, fetchStats])

    const handleLookup = async () => {
        if (!lookupId.trim()) return
        setLookupLoading(true)
        try {
            const result = await tunjukSilangService.getByEntity(lookupType, lookupId.trim())
            setLookupResults(result.data || result || [])
        } catch (err) {
            toast({ title: 'Gagal mencari', description: err.message, variant: 'destructive' })
            setLookupResults([])
        }
        setLookupLoading(false)
    }

    const handleCreate = async () => {
        try {
            if (!newRef.sourceId || !newRef.targetId) {
                toast({ title: 'Source ID dan Target ID wajib diisi', variant: 'destructive' })
                return
            }
            await tunjukSilangService.create(newRef)
            toast({ title: 'Tunjuk silang berhasil ditambahkan' })
            setAddDialogOpen(false)
            setNewRef({
                sourceType: 'arsip', sourceId: '',
                targetType: 'surat_masuk', targetId: '',
                jenisRelasi: 'referensi', keterangan: '',
            })
            fetchData()
            fetchStats()
            // Refresh lookup if active
            if (activeTab === 'lookup' && lookupId) handleLookup()
        } catch (err) {
            toast({ title: 'Gagal', description: err.message, variant: 'destructive' })
        }
    }

    const handleDelete = async (id) => {
        if (!confirm('Hapus tunjuk silang ini?')) return
        try {
            await tunjukSilangService.delete(id)
            toast({ title: 'Berhasil dihapus' })
            fetchData()
            fetchStats()
            if (activeTab === 'lookup' && lookupId) handleLookup()
        } catch (err) {
            toast({ title: 'Gagal', description: err.message, variant: 'destructive' })
        }
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-500/15 rounded-lg">
                            <Link2 className="h-6 w-6 text-indigo-600" />
                        </div>
                        Tunjuk Silang
                    </h1>
                    <p className="text-muted-foreground">
                        Kelola referensi silang dan keterkaitan antar dokumen
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="bg-indigo-600 hover:bg-indigo-700 shadow-sm">
                                <Plus className="mr-2 h-4 w-4" /> Tambah Referensi
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[600px]">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <GitMerge className="h-5 w-5 text-indigo-600" />
                                    Tambah Tunjuk Silang
                                </DialogTitle>
                                <DialogDescription>
                                    Buat hubungan baru antara satu entitas dengan entitas lainnya
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-6 py-4">
                                <div className="space-y-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex-1 p-4 bg-muted/40 rounded-lg border-2 border-transparent focus-within:border-indigo-500/50 transition-colors">
                                            <p className="text-xs font-semibold text-muted-foreground mb-3 text-center uppercase tracking-wider">Sumber (Source)</p>
                                            <div className="space-y-3">
                                                <Select value={newRef.sourceType} onValueChange={(v) => setNewRef(r => ({ ...r, sourceType: v }))}>
                                                    <SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {ENTITY_TYPES.map(e => (
                                                            <SelectItem key={e.value} value={e.value}>
                                                                <div className="flex items-center gap-2">
                                                                    <e.icon className={`h-4 w-4 ${e.color}`} />
                                                                    {e.label}
                                                                </div>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <Input
                                                    placeholder="UUID Sumber..."
                                                    value={newRef.sourceId}
                                                    onChange={(e) => setNewRef(r => ({ ...r, sourceId: e.target.value }))}
                                                    className="font-mono text-xs"
                                                />
                                            </div>
                                        </div>

                                        <div className="px-2 flex flex-col items-center justify-center -mt-6 z-10">
                                            <ArrowRightLeft className="h-6 w-6 text-muted-foreground/50" />
                                        </div>

                                        <div className="flex-1 p-4 bg-muted/40 rounded-lg border-2 border-transparent focus-within:border-indigo-500/50 transition-colors">
                                            <p className="text-xs font-semibold text-muted-foreground mb-3 text-center uppercase tracking-wider">Tujuan (Target)</p>
                                            <div className="space-y-3">
                                                <Select value={newRef.targetType} onValueChange={(v) => setNewRef(r => ({ ...r, targetType: v }))}>
                                                    <SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {ENTITY_TYPES.map(e => (
                                                            <SelectItem key={e.value} value={e.value}>
                                                                <div className="flex items-center gap-2">
                                                                    <e.icon className={`h-4 w-4 ${e.color}`} />
                                                                    {e.label}
                                                                </div>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <Input
                                                    placeholder="UUID Tujuan..."
                                                    value={newRef.targetId}
                                                    onChange={(e) => setNewRef(r => ({ ...r, targetId: e.target.value }))}
                                                    className="font-mono text-xs"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <div>
                                            <label className="text-sm font-medium mb-1.5 block">Jenis Relasi</label>
                                            <Select value={newRef.jenisRelasi} onValueChange={(v) => setNewRef(r => ({ ...r, jenisRelasi: v }))}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Pilih jenis hubungan" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {RELASI_TYPES.map(r => (
                                                        <SelectItem key={r.value} value={r.value}>
                                                            <div className="flex items-center gap-2">
                                                                <span className={`w-2 h-2 rounded-full ${r.color.split(' ')[0].replace('bg-', 'bg-')}`} />
                                                                {r.label}
                                                            </div>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div>
                                            <label className="text-sm font-medium mb-1.5 block">Keterangan</label>
                                            <Textarea
                                                placeholder="Tambahkan catatan tentang hubungan ini..."
                                                value={newRef.keterangan}
                                                onChange={(e) => setNewRef(r => ({ ...r, keterangan: e.target.value }))}
                                                className="resize-none"
                                                rows={3}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <DialogFooter className="gap-2 sm:gap-0">
                                <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Batal</Button>
                                <Button onClick={handleCreate} className="bg-indigo-600 hover:bg-indigo-700">Simpan Relasi</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid gap-4 lg:grid-cols-4">
                <Card className="border-indigo-100 shadow-sm bg-indigo-50/30">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Referensi</CardTitle>
                        <Link2 className="h-4 w-4 text-indigo-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-indigo-700 dark:text-indigo-300">{stats?.total || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">Data hubungan tersimpan</p>
                    </CardContent>
                </Card>
                {(stats?.byRelasi || []).slice(0, 3).map(item => {
                    const cfg = getRelasiConfig(item.jenisRelasi)
                    return (
                        <Card key={item.jenisRelasi} className="shadow-sm">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium capitalize">{cfg.label}</CardTitle>
                                <Target className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{item.count}</div>
                                <Badge variant="outline" className={`mt-1 border-0 ${cfg.color} h-5 text-[10px]`}>{cfg.label}</Badge>
                            </CardContent>
                        </Card>
                    )
                })}
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList className="grid w-full max-w-[400px] grid-cols-2">
                    <TabsTrigger value="list">Daftar Referensi</TabsTrigger>
                    <TabsTrigger value="lookup">Cari & Telusuri</TabsTrigger>
                </TabsList>

                <TabsContent value="list" className="space-y-4">
                    <Card className="border-border/60 shadow-sm">
                        <CardHeader className="pb-4 bg-muted/20">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <CardTitle>Semua Data Tunjuk Silang</CardTitle>
                                    <CardDescription>Daftar lengkap referensi silang yang tercatat di sistem</CardDescription>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={() => { fetchData(); fetchStats(); }} className="h-8">
                                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
                                    </Button>
                                    <Select value={filterRelasi} onValueChange={(v) => { setFilterRelasi(v); setPage(1); }}>
                                        <SelectTrigger className="w-full sm:w-[160px] h-8 text-xs bg-background">
                                            <Filter className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                                            <SelectValue placeholder="Semua Jenis" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">Semua Jenis</SelectItem>
                                            {RELASI_TYPES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table responsive>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead className="w-[50px] text-center">No.</TableHead>
                                        <TableHead className="w-[30%]">Sumber (Source)</TableHead>
                                        <TableHead className="w-[150px] text-center">Relasi</TableHead>
                                        <TableHead className="w-[30%]">Tujuan (Target)</TableHead>
                                        <TableHead>Keterangan</TableHead>
                                        <TableHead className="w-[100px]">Tanggal</TableHead>
                                        <TableHead className="w-[60px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-32 text-center">
                                                <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                                                    <RefreshCw className="h-6 w-6 animate-spin" />
                                                    <span className="text-sm">Memuat data...</span>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : data.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                                                <div className="flex flex-col items-center justify-center gap-2">
                                                    <Link2 className="h-8 w-8 opacity-20" />
                                                    <p>Tidak ada data tunjuk silang ditemukan</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : data.map((ref, index) => {
                                        const relCfg = getRelasiConfig(ref.jenisRelasi)
                                        const SrcIcon = getEntityIcon(ref.sourceType)
                                        const TgtIcon = getEntityIcon(ref.targetType)
                                        const srcStyle = getEntityStyle(ref.sourceType)
                                        const tgtStyle = getEntityStyle(ref.targetType)

                                        return (
                                            <TableRow key={ref.id} className="hover:bg-muted/30">
                                                <TableCell data-label="No." className="text-center text-muted-foreground text-xs">{(page - 1) * 20 + index + 1}</TableCell>
                                                <TableCell data-label="Sumber (Source)">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`p-1.5 rounded-md ${srcStyle.bg}`}>
                                                            <SrcIcon className={`h-4 w-4 ${srcStyle.color}`} />
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="text-xs font-medium text-foreground">{getEntityLabel(ref.sourceType)}</span>
                                                            <code className="text-[10px] text-muted-foreground bg-muted px-1 rounded truncate max-w-[120px] font-mono">
                                                                {ref.sourceId}
                                                            </code>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell data-label="Relasi" className="text-center">
                                                    <Badge variant="outline" className={`${relCfg.color} text-[10px] h-5`}>{relCfg.label}</Badge>
                                                </TableCell>
                                                <TableCell data-label="Tujuan (Target)">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`p-1.5 rounded-md ${tgtStyle.bg}`}>
                                                            <TgtIcon className={`h-4 w-4 ${tgtStyle.color}`} />
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="text-xs font-medium text-foreground">{getEntityLabel(ref.targetType)}</span>
                                                            <code className="text-[10px] text-muted-foreground bg-muted px-1 rounded truncate max-w-[120px] font-mono">
                                                                {ref.targetId}
                                                            </code>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell data-label="Keterangan" className="text-xs text-muted-foreground max-w-[150px] truncate" title={ref.keterangan}>
                                                    {ref.keterangan || '-'}
                                                </TableCell>
                                                <TableCell data-label="Tanggal" className="text-xs text-muted-foreground">
                                                    {new Date(ref.createdAt).toLocaleDateString('id-ID')}
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                        onClick={() => handleDelete(ref.id)}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </CardContent>

                        {totalPages > 1 && (
                            <div className="flex items-center justify-end gap-2 p-4 border-t bg-muted/10">
                                <span className="text-xs text-muted-foreground mr-2">Halaman {page} dari {totalPages}</span>
                                <Button variant="outline" size="sm" className="h-8 text-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                                    <ChevronUp className="h-3 w-3 rotate-[-90deg] mr-1" /> Prev
                                </Button>
                                <Button variant="outline" size="sm" className="h-8 text-xs" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                                    Next <ChevronUp className="h-3 w-3 rotate-90 ml-1" />
                                </Button>
                            </div>
                        )}
                    </Card>
                </TabsContent>

                <TabsContent value="lookup" className="space-y-4">
                    <Card className="border-border/60 shadow-sm">
                        <CardHeader className="pb-4 bg-muted/20">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Search className="h-4 w-4" />
                                Cari & Telusuri Referensi Silang
                            </CardTitle>
                            <CardDescription>
                                Masukkan ID entitas untuk melihat semua dokumen yang terhubung dengannya
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-6">
                            <div className="flex flex-col md:flex-row gap-4 items-end mb-6 p-4 bg-muted/30 rounded-lg border">
                                <div className="w-full md:w-auto">
                                    <label className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 block">Tipe Entitas</label>
                                    <Select value={lookupType} onValueChange={setLookupType}>
                                        <SelectTrigger className="w-full md:w-[180px] bg-background">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {ENTITY_TYPES.map(e => (
                                                <SelectItem key={e.value} value={e.value}>
                                                    <div className="flex items-center gap-2">
                                                        <e.icon className={`h-4 w-4 ${e.color}`} />
                                                        {e.label}
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="flex-1 w-full">
                                    <label className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 block">UUID Entitas</label>
                                    <div className="relative">
                                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            className="pl-9 font-mono text-sm bg-background"
                                            placeholder="Masukkan ID entitas (misal: a1b2c3d4...)"
                                            value={lookupId}
                                            onChange={(e) => setLookupId(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
                                        />
                                    </div>
                                </div>
                                <Button onClick={handleLookup} disabled={lookupLoading} className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700">
                                    {lookupLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                    Cari Relasi
                                </Button>
                            </div>

                            {lookupResults !== null && (
                                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                                    {lookupResults.length === 0 ? (
                                        <div className="text-center py-12 border-2 border-dashed rounded-lg bg-muted/10">
                                            <div className="p-3 bg-muted rounded-full w-12 h-12 mx-auto mb-3 flex items-center justify-center">
                                                <Info className="h-6 w-6 text-muted-foreground" />
                                            </div>
                                            <h3 className="font-medium text-foreground">Tidak Ditemukan</h3>
                                            <p className="text-sm text-muted-foreground mt-1">Tidak ada referensi silang yang ditemukan untuk entitas ini</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                <p className="text-sm font-medium flex items-center gap-2">
                                                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                                                    {lookupResults.length} referensi ditemukan
                                                </p>
                                            </div>
                                            <div className="grid gap-3">
                                                {lookupResults.map((ref) => {
                                                    const relCfg = getRelasiConfig(ref.jenisRelasi)
                                                    const RelIcon = ref.direction === 'outgoing' ? ArrowRight : ArrowLeft
                                                    const EntityIcon = getEntityIcon(ref.relatedType)
                                                    const entStyle = getEntityStyle(ref.relatedType)

                                                    return (
                                                        <div
                                                            key={ref.id}
                                                            className="group flex flex-col md:flex-row md:items-center gap-4 p-4 border rounded-lg hover:border-indigo-200 hover:bg-indigo-50/10 transition-all bg-card shadow-sm"
                                                        >
                                                            <div className="flex items-center gap-3 min-w-[150px]">
                                                                <div className={`p-2 rounded-full ${ref.direction === 'outgoing' ? 'bg-blue-100 dark:bg-blue-500/15 text-blue-600' : 'bg-green-100 dark:bg-green-500/15 text-green-600'}`}>
                                                                    <RelIcon className="h-4 w-4" />
                                                                </div>
                                                                <div>
                                                                    <p className="text-xs font-medium text-muted-foreground uppercase">{ref.direction === 'outgoing' ? 'Menunjuk Ke' : 'Ditunjuk Oleh'}</p>
                                                                    <Badge variant="outline" className={`mt-1 border-0 ${relCfg.color} text-[10px]`}>
                                                                        {relCfg.label}
                                                                    </Badge>
                                                                </div>
                                                            </div>

                                                            <div className="flex-1 flex items-center gap-4 p-3 bg-muted/30 rounded-md border border-transparent group-hover:border-indigo-100 group-hover:bg-card transition-colors">
                                                                <div className={`p-2 rounded-md ${entStyle.bg}`}>
                                                                    <EntityIcon className={`h-5 w-5 ${entStyle.color}`} />
                                                                </div>
                                                                <div className="min-w-0 flex-1">
                                                                    <p className="text-sm font-medium text-foreground">{getEntityLabel(ref.relatedType)}</p>
                                                                    <div className="flex items-center gap-2 mt-1">
                                                                        <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                                                                            {ref.relatedId}
                                                                        </code>
                                                                        <Button variant="ghost" size="icon" className="h-5 w-5">
                                                                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {ref.keterangan && (
                                                                <div className="md:w-1/3 text-sm text-muted-foreground border-l pl-4 italic">
                                                                    "{ref.keterangan}"
                                                                </div>
                                                            )}

                                                            <div className="flex justify-end md:block">
                                                                <Button
                                                                    variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                                    onClick={() => handleDelete(ref.id)}
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}

function CheckCircle2({ className }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>
    )
}
