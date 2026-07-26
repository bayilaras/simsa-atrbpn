import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
    Card, CardContent, CardHeader, CardTitle, CardDescription
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import {
    ArrowLeft, Edit2, Trash2, Clock, CheckCircle2,
    MailPlus, MailMinus, ExternalLink, FolderOpen, Save,
    X, Calendar, FileText, LayoutGrid, Info, MoreHorizontal,
    ArrowRight, Plus, Loader2
} from 'lucide-react'
import dosirService from '@/services/dosir.service'
import { format, parseISO, formatDistanceToNow } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'

const STATUS_OPTIONS = [
    { value: 'open', label: 'Aktif', color: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-200' },
    { value: 'closed', label: 'Selesai', color: 'bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-200' },
    { value: 'archived', label: 'Diarsipkan', color: 'bg-stone-100 text-stone-800 border-stone-200' },
]

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color }) {
    return (
        <Card className="shadow-sm border-l-4" style={{ borderLeftColor: color }}>
            <CardContent className="p-4 flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-muted-foreground">{label}</p>
                    <p className="text-2xl font-bold mt-1">{value}</p>
                </div>
                <div className={`p-2 rounded-lg bg-opacity-10`} style={{ backgroundColor: color }}>
                    <Icon className="h-5 w-5" style={{ color: color }} />
                </div>
            </CardContent>
        </Card>
    )
}

function TimelineItem({ item, isLast }) {
    const isMasuk = item.type === 'masuk';
    const navigate = useNavigate();

    return (
        <div className="relative pl-8 pb-8 last:pb-0">
            {/* Connector line */}
            {!isLast && (
                <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-muted" />
            )}

            {/* Icon */}
            <div className={`absolute left-0 top-1 p-1.5 rounded-full ring-4 ring-white ${isMasuk ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600' : 'bg-blue-100 dark:bg-blue-500/15 text-blue-600'
                }`}>
                {isMasuk ? <MailPlus className="h-4 w-4" /> : <MailMinus className="h-4 w-4" />}
            </div>

            <Card className="hover:shadow-md transition-shadow duration-200">
                <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row gap-4 justify-between items-start">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 mb-1">
                                <Badge variant={isMasuk ? 'default' : 'secondary'} className={isMasuk ? 'bg-emerald-600' : 'bg-primary text-white'}>
                                    {isMasuk ? 'Surat Masuk' : 'Surat Keluar'}
                                </Badge>
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {format(parseISO(item.tanggal), 'dd MMMM yyyy, HH:mm', { locale: idLocale })}
                                </span>
                            </div>
                            <h4 className="font-semibold text-base">{item.perihal || 'Tanpa Perihal'}</h4>
                            <p className="text-sm text-muted-foreground font-mono bg-muted/50 px-2 py-0.5 rounded inline-block">
                                {item.nomorSurat || 'Tanpa Nomor'}
                            </p>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                                <span className={isMasuk ? 'text-emerald-700 dark:text-emerald-300' : 'text-blue-700 dark:text-blue-300'}>
                                    {isMasuk ? `Dari: ${item.dari}` : `Kepada: ${item.kepada}`}
                                </span>
                            </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                            <Button variant="outline" size="sm" onClick={() => navigate(`/surat/${item.type}/${item.id}`)}>
                                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                                Detail
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

function EmptyState({ icon: Icon, title, description, action }) {
    return (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border-2 border-dashed bg-muted/50">
            <div className="bg-card p-3 rounded-full shadow-sm mb-4">
                <Icon className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground max-w-sm mt-1 mb-6">{description}</p>
            {action}
        </div>
    )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function DosirDetail() {
    const { id } = useParams()
    const navigate = useNavigate()
    const [dosir, setDosir] = useState(null)
    const [timeline, setTimeline] = useState([])
    const [loading, setLoading] = useState(true)
    const [editing, setEditing] = useState(false)
    const [editForm, setEditForm] = useState({})
    const [saveLoading, setSaveLoading] = useState(false)

    // Data fetching
    const fetchData = useCallback(async () => {
        try {
            setLoading(true)
            const [dosirRes, timelineRes] = await Promise.all([
                dosirService.getById(id),
                dosirService.getTimeline(id),
            ])
            setDosir(dosirRes.data)
            setTimeline(timelineRes.data || [])
            setEditForm({
                judul: dosirRes.data?.judul || '',
                deskripsi: dosirRes.data?.deskripsi || '',
                status: dosirRes.data?.status || 'open',
                kategori: dosirRes.data?.kategori || '',
                tanggalMulai: dosirRes.data?.tanggalMulai ? dosirRes.data.tanggalMulai.split('T')[0] : '', // Format for date input
                tanggalSelesai: dosirRes.data?.tanggalSelesai ? dosirRes.data.tanggalSelesai.split('T')[0] : '',
            })
        } catch (error) {
            console.error('Error fetching dosir:', error)
        } finally {
            setLoading(false)
        }
    }, [id])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // Handlers
    const handleSave = async () => {
        try {
            setSaveLoading(true)
            await dosirService.update(id, editForm)
            setEditing(false)
            fetchData()
        } catch (error) {
            console.error('Error updating dosir:', error)
        } finally {
            setSaveLoading(false)
        }
    }

    const handleRemoveSurat = async (type, suratId) => {
        if (!confirm('Hapus surat dari dosir ini?')) return
        try {
            await dosirService.removeSurat(id, type, suratId)
            fetchData()
        } catch (error) {
            console.error('Error removing surat:', error)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[50vh]">
                <div className="flex flex-col items-center gap-2">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" />
                    <p className="text-muted-foreground animate-pulse">Memuat data dosir...</p>
                </div>
            </div>
        )
    }

    if (!dosir) {
        return (
            <div className="p-8 max-w-md mx-auto mt-20 text-center">
                <FolderOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                <h2 className="text-2xl font-bold mb-2">Dosir Tidak Ditemukan</h2>
                <p className="text-muted-foreground mb-6">Data dosir yang Anda cari tidak tersedia atau telah dihapus.</p>
                <Button onClick={() => navigate('/dosir')}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Kembali ke Daftar
                </Button>
            </div>
        )
    }

    const statusConf = STATUS_OPTIONS.find(s => s.value === dosir.status) || STATUS_OPTIONS[0]

    // Sort timeline descending by date
    const sortedTimeline = [...timeline].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));

    return (
        <div className="space-y-8 animate-in fade-in duration-500">

            {/* ─── Hero Header ──────────────────────────────────────────────── */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 text-white shadow-xl">
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-10">
                    <div className="absolute top-0 right-0 w-96 h-96 bg-card rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2" />
                    <div className="absolute bottom-0 left-1/4 w-64 h-64 bg-card rounded-full blur-3xl opacity-50" />
                </div>

                <div className="relative p-6 md:p-8">
                    <div className="flex flex-col md:flex-row gap-6 md:gap-0 justify-between items-start md:items-center mb-6">
                        <Button
                            variant="ghost"
                            className="text-white/80 hover:text-white hover:bg-card/10 -ml-2"
                            onClick={() => navigate('/dosir')}
                        >
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Kembali ke Daftar
                        </Button>

                        <div className="flex gap-2">
                            <Badge className="bg-card/20 hover:bg-card/30 text-white border-0 backdrop-blur-md px-3 py-1">
                                {dosir.kategori || 'Umum'}
                            </Badge>
                            <Badge className={`border-0 backdrop-blur-md px-3 py-1 ${dosir.status === 'open' ? 'bg-emerald-500/80 text-white' :
                                dosir.status === 'closed' ? 'bg-blue-500/80 text-white' :
                                    'bg-slate-500/80 text-white'
                                }`}>
                                {statusConf.label}
                            </Badge>
                        </div>
                    </div>

                    <div className="flex flex-col md:flex-row gap-6 items-start">
                        <div className="bg-card/20 p-4 rounded-2xl backdrop-blur-sm shadow-inner shrink-0 hidden md:block">
                            <FolderOpen className="h-10 w-10 text-white" />
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                                <span className="font-mono text-white/70 text-sm bg-black/20 px-2 py-0.5 rounded">
                                    {dosir.kode}
                                </span>
                                <span className="text-white/60 text-sm">•</span>
                                <span className="text-white/80 text-sm flex items-center gap-1">
                                    <Calendar className="h-3.5 w-3.5" />
                                    Dibuat {format(parseISO(dosir.createdAt), 'dd MMM yyyy', { locale: idLocale })}
                                </span>
                            </div>

                            <h1 className="text-2xl md:text-4xl font-bold leading-tight mb-3">
                                {dosir.judul}
                            </h1>

                            {dosir.deskripsi && (
                                <p className="text-white/80 text-sm md:text-base max-w-3xl leading-relaxed">
                                    {dosir.deskripsi}
                                </p>
                            )}
                        </div>

                        <div className="flex flex-row md:flex-col gap-3 w-full md:w-auto shrink-0">
                            <Dialog open={editing} onOpenChange={setEditing}>
                                <DialogTrigger asChild>
                                    <Button className="bg-card text-indigo-700 dark:text-indigo-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/15 w-full md:w-auto shadow-lg hover:shadow-xl transition-all">
                                        <Edit2 className="mr-2 h-4 w-4" />
                                        Edit Dosir
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[600px]">
                                    <DialogHeader>
                                        <DialogTitle>Edit Informasi Dosir</DialogTitle>
                                        <DialogDescription>
                                            Perbarui judul, deskripsi, dan status dosir ini.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="grid gap-6 py-4">
                                        <div className="space-y-4">
                                            <div className="grid gap-2">
                                                <Label htmlFor="judul">Judul Dosir</Label>
                                                <Input
                                                    id="judul"
                                                    value={editForm.judul}
                                                    onChange={(e) => setEditForm(p => ({ ...p, judul: e.target.value }))}
                                                />
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="grid gap-2">
                                                    <Label htmlFor="status">Status</Label>
                                                    <Select value={editForm.status} onValueChange={(v) => setEditForm(p => ({ ...p, status: v }))}>
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {STATUS_OPTIONS.map(s => (
                                                                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="grid gap-2">
                                                    <Label htmlFor="kategori">Kategori</Label>
                                                    <Input
                                                        id="kategori"
                                                        value={editForm.kategori}
                                                        onChange={(e) => setEditForm(p => ({ ...p, kategori: e.target.value }))}
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="grid gap-2">
                                                    <Label htmlFor="tglMulai">Tanggal Mulai</Label>
                                                    <Input
                                                        id="tglMulai"
                                                        type="date"
                                                        value={editForm.tanggalMulai}
                                                        onChange={(e) => setEditForm(p => ({ ...p, tanggalMulai: e.target.value }))}
                                                    />
                                                </div>
                                                <div className="grid gap-2">
                                                    <Label htmlFor="tglSelesai">Tanggal Selesai</Label>
                                                    <Input
                                                        id="tglSelesai"
                                                        type="date"
                                                        value={editForm.tanggalSelesai}
                                                        onChange={(e) => setEditForm(p => ({ ...p, tanggalSelesai: e.target.value }))}
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid gap-2">
                                                <Label htmlFor="deskripsi">Deskripsi</Label>
                                                <Textarea
                                                    id="deskripsi"
                                                    value={editForm.deskripsi}
                                                    onChange={(e) => setEditForm(p => ({ ...p, deskripsi: e.target.value }))}
                                                    rows={4}
                                                    className="resize-none"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setEditing(false)}>Batal</Button>
                                        <Button onClick={handleSave} disabled={saveLoading} className="bg-indigo-600 hover:bg-indigo-700">
                                            {saveLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Simpan Perubahan
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>
                </div>

                {/* Stats Bar */}
                <div className="bg-black/10 backdrop-blur-sm border-t border-white/10 px-6 md:px-8 py-4 flex flex-wrap gap-8 text-sm">
                    <div className="flex items-center gap-2">
                        <MailPlus className="h-4 w-4 text-emerald-300" />
                        <span className="text-white/70">Surat Masuk:</span>
                        <span className="font-semibold text-white">{dosir.suratMasuk?.length || 0}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <MailMinus className="h-4 w-4 text-blue-300" />
                        <span className="text-white/70">Surat Keluar:</span>
                        <span className="font-semibold text-white">{dosir.suratKeluar?.length || 0}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-amber-300" />
                        <span className="text-white/70">Terakhir Update:</span>
                        <span className="font-semibold text-white">
                            {formatDistanceToNow(parseISO(dosir.updatedAt), { addSuffix: true, locale: idLocale })}
                        </span>
                    </div>
                </div>
            </div>

            {/* ─── Main Content ──────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Left Column: Timeline & Lists */}
                <div className="lg:col-span-2 space-y-6">
                    <Tabs defaultValue="timeline" className="w-full">
                        <TabsList className="w-full justify-start bg-muted p-1 rounded-xl mb-6">
                            <TabsTrigger value="timeline" className="flex-1 sm:flex-none rounded-lg data-[state=active]:bg-card data-[state=active]:text-indigo-600 data-[state=active]:shadow-sm">
                                <Clock className="mr-2 h-4 w-4" />
                                Kronologi
                            </TabsTrigger>
                            <TabsTrigger value="masuk" className="flex-1 sm:flex-none rounded-lg data-[state=active]:bg-card data-[state=active]:text-emerald-600 data-[state=active]:shadow-sm">
                                <MailPlus className="mr-2 h-4 w-4" />
                                Surat Masuk
                                <Badge variant="secondary" className="ml-2 bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 h-5 px-1.5">{dosir.suratMasuk?.length || 0}</Badge>
                            </TabsTrigger>
                            <TabsTrigger value="keluar" className="flex-1 sm:flex-none rounded-lg data-[state=active]:bg-card data-[state=active]:text-blue-600 data-[state=active]:shadow-sm">
                                <MailMinus className="mr-2 h-4 w-4" />
                                Surat Keluar
                                <Badge variant="secondary" className="ml-2 bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 h-5 px-1.5">{dosir.suratKeluar?.length || 0}</Badge>
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="timeline" className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-300">
                            {sortedTimeline.length > 0 ? (
                                <div className="ml-2">
                                    {sortedTimeline.map((item, index) => (
                                        <TimelineItem
                                            key={`${item.type}-${item.id}`}
                                            item={item}
                                            isLast={index === sortedTimeline.length - 1}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <EmptyState
                                    icon={Clock}
                                    title="Belum Ada Kronologi"
                                    description="Dosir ini belum memiliki surat masuk atau surat keluar yang terlampir."
                                    action={
                                        <Button variant="outline" className="mt-4" onClick={() => navigate('/surat/masuk')}>
                                            <Plus className="mr-2 h-4 w-4" />
                                            Tambah Surat
                                        </Button>
                                    }
                                />
                            )}
                        </TabsContent>

                        {/* Similar lists for separate tabs if needed, for brevity keeping timeline as main view */}
                        <TabsContent value="masuk">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                                        <MailPlus className="h-5 w-5" />
                                        Daftar Surat Masuk
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {dosir.suratMasuk?.length > 0 ? (
                                        dosir.suratMasuk.map(sm => (
                                            <div key={sm.id} className="flex items-start justify-between p-4 bg-muted/50 rounded-xl border border-border hover:border-emerald-200 transition-colors">
                                                <div>
                                                    <p className="font-semibold text-foreground">{sm.perihal}</p>
                                                    <p className="text-sm text-muted-foreground mt-1">
                                                        No: {sm.nomorSurat} • Dari: {sm.dari}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground mt-2">
                                                        {format(parseISO(sm.createdAt), 'dd MMM yyyy')}
                                                    </p>
                                                </div>
                                                <div className="flex gap-2">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-emerald-600" onClick={() => navigate(`/surat/masuk/${sm.id}`)}>
                                                        <ExternalLink className="h-4 w-4" />
                                                    </Button>
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-red-600 dark:hover:text-red-400" onClick={() => handleRemoveSurat('masuk', sm.id)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-muted-foreground text-center py-8">Tidak ada surat masuk</p>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="keluar">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-blue-700 dark:text-blue-300 flex items-center gap-2">
                                        <MailMinus className="h-5 w-5" />
                                        Daftar Surat Keluar
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {dosir.suratKeluar?.length > 0 ? (
                                        dosir.suratKeluar.map(sk => (
                                            <div key={sk.id} className="flex items-start justify-between p-4 bg-muted/50 rounded-xl border border-border hover:border-blue-200 transition-colors">
                                                <div>
                                                    <p className="font-semibold text-foreground">{sk.perihal}</p>
                                                    <p className="text-sm text-muted-foreground mt-1">
                                                        No: {sk.nomorSurat} • Kepada: {sk.kepada}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground mt-2">
                                                        {format(parseISO(sk.createdAt), 'dd MMM yyyy')}
                                                    </p>
                                                </div>
                                                <div className="flex gap-2">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-blue-600" onClick={() => navigate(`/surat/keluar/${sk.id}`)}>
                                                        <ExternalLink className="h-4 w-4" />
                                                    </Button>
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-red-600 dark:hover:text-red-400" onClick={() => handleRemoveSurat('keluar', sk.id)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-muted-foreground text-center py-8">Tidak ada surat keluar</p>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>

                {/* Right Column: Information & Metadata */}
                <div className="space-y-6">
                    <Card className="shadow-lg border-indigo-100 overflow-hidden">
                        <div className="h-1 bg-gradient-to-r from-violet-500 to-fuchsia-500" />
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <Info className="h-5 w-5 text-indigo-600" />
                                Informasi Dosir
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-0">
                            <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</p>
                                <Badge variant="outline" className={`${statusConf.color} border px-3 py-1`}>
                                    {statusConf.label}
                                </Badge>
                            </div>

                            <Separator />

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tanggal Mulai</p>
                                    <p className="text-sm font-medium">
                                        {dosir.tanggalMulai ? format(parseISO(dosir.tanggalMulai), 'dd MMM yyyy', { locale: idLocale }) : '-'}
                                    </p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tanggal Selesai</p>
                                    <p className="text-sm font-medium">
                                        {dosir.tanggalSelesai ? format(parseISO(dosir.tanggalSelesai), 'dd MMM yyyy', { locale: idLocale }) : '-'}
                                    </p>
                                </div>
                            </div>

                            <Separator />

                            <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ID Dosir</p>
                                <div className="bg-muted rounded px-2 py-1.5 font-mono text-xs text-muted-foreground truncate select-all">
                                    {dosir.id}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-gradient-to-br from-slate-50 to-white border-dashed">
                        <CardHeader>
                            <CardTitle className="text-base">Statistik Cepat</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 gap-3 pt-0">
                            <div className="bg-card p-3 rounded-xl border shadow-sm text-center">
                                <p className="text-2xl font-bold text-foreground">{timeline.length}</p>
                                <p className="text-xs text-muted-foreground">Total Aktivitas</p>
                            </div>
                            <div className="bg-card p-3 rounded-xl border shadow-sm text-center">
                                <p className="text-2xl font-bold text-foreground">
                                    {dosir.suratMasuk?.length + dosir.suratKeluar?.length}
                                </p>
                                <p className="text-xs text-muted-foreground">Total Surat</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
