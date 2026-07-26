import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
    Archive, ArrowLeft, ExternalLink, Calendar, MapPin,
    Clock, Shield, User, FileText, Hash, Layers, Info, Tag,
    Printer, ChevronRight, Eye, BookOpen, FolderOpen, Trash2
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { arsipService } from '@/services/arsip.service'
import { format, formatDistanceToNow, differenceInDays } from 'date-fns'
import { id as localeId } from 'date-fns/locale'

// ─── Helpers ────────────────────────────────────────────────
function formatDate(dateStr) {
    if (!dateStr) return '-'
    try {
        return format(new Date(dateStr), 'd MMMM yyyy', { locale: localeId })
    } catch {
        return dateStr
    }
}

function formatRelative(dateStr) {
    if (!dateStr) return ''
    try {
        return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: localeId })
    } catch {
        return ''
    }
}

// ─── Sub-Components ─────────────────────────────────────────

function EnhancedInfoField({ icon: Icon, label, value, badge, variant = 'secondary', className = '' }) {
    return (
        <div className={`group relative p-4 rounded-xl border border-border transition-all duration-200 hover:shadow-md hover:border-emerald-200 hover:bg-emerald-50/30 ${className}`}>
            <div className="flex items-center gap-2 mb-2">
                {Icon && (
                    <div className="p-1.5 rounded-lg bg-muted group-hover:bg-emerald-100 dark:group-hover:bg-emerald-500/15 transition-colors">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-emerald-600 transition-colors" />
                    </div>
                )}
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
            </div>
            {badge && value ? (
                <Badge variant={variant} className="mt-0.5">{value}</Badge>
            ) : (
                <p className={`text-sm font-semibold break-words ${!value ? 'text-muted-foreground italic font-normal' : 'text-foreground'}`}>
                    {value || '—'}
                </p>
            )}
        </div>
    )
}

function QuickStatBox({ icon: Icon, label, value, color = 'white' }) {
    return (
        <div className="bg-card/10 backdrop-blur-sm rounded-xl p-3 hover:bg-card/15 transition-colors">
            <Icon className="h-4 w-4 text-white/50 mb-1" />
            <p className="text-xs text-white/50">{label}</p>
            <p className="text-sm font-semibold text-white">{value || '—'}</p>
        </div>
    )
}

function StatusIndicator({ label, active, activeLabel, inactiveLabel, activeColor = 'emerald', icon: Icon }) {
    const isActive = active
    return (
        <div className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${isActive
            ? `bg-${activeColor}-50 border border-${activeColor}-100`
            : 'bg-muted/50 border border-border'
            }`}>
            <div className={`p-2 rounded-full ${isActive
                ? `bg-${activeColor}-100`
                : 'bg-muted'
                }`}>
                <Icon className={`h-4 w-4 ${isActive
                    ? `text-${activeColor}-600`
                    : 'text-muted-foreground'
                    }`} />
            </div>
            <div>
                <p className={`font-medium text-sm ${isActive
                    ? `text-${activeColor}-700`
                    : 'text-muted-foreground'
                    }`}>
                    {isActive ? activeLabel : inactiveLabel}
                </p>
                <p className="text-xs text-muted-foreground">{label}</p>
            </div>
        </div>
    )
}

function TimelineEvent({ icon: Icon, label, date, color = 'emerald', isLast = false }) {
    return (
        <div className="relative flex gap-3 pb-6 last:pb-0">
            {!isLast && (
                <div className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-muted" />
            )}
            <div className={`relative z-10 p-1.5 rounded-full bg-${color}-100 ring-4 ring-white shrink-0`}>
                <Icon className={`h-3 w-3 text-${color}-600`} />
            </div>
            <div className="min-w-0 pt-0.5">
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{formatDate(date)}</p>
                {date && (
                    <p className="text-xs text-muted-foreground/70">{formatRelative(date)}</p>
                )}
            </div>
        </div>
    )
}

function ArsipDetailSkeleton() {
    return (
        <div className="space-y-6 animate-pulse">
            {/* Hero skeleton */}
            <div className="h-52 rounded-2xl bg-gradient-to-br from-slate-200 to-slate-100" />
            {/* Layout skeleton */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                    {/* Tab bar skeleton */}
                    <div className="flex flex-wrap gap-2">
                        {[1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="h-10 w-28 rounded-lg bg-muted" />
                        ))}
                    </div>
                    {/* Content skeleton */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                            <div key={i} className="h-24 rounded-xl bg-muted" />
                        ))}
                    </div>
                </div>
                <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-32 rounded-xl bg-muted" />
                    ))}
                </div>
            </div>
        </div>
    )
}

// ─── Main Component ─────────────────────────────────────────

export default function ArsipDetail() {
    const { id } = useParams()
    const navigate = useNavigate()
    const [arsip, setArsip] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    useEffect(() => {
        async function fetchData() {
            try {
                setLoading(true)
                const res = await arsipService.getById(id)
                setArsip(res.data || res)
            } catch (err) {
                setError(err.message || 'Gagal memuat data arsip')
            } finally {
                setLoading(false)
            }
        }
        if (id) fetchData()
    }, [id])

    // ─── Loading State ─────────────────
    if (loading) return <ArsipDetailSkeleton />

    // ─── Error State ────────────────────
    if (error || !arsip) {
        return (
            <div className="space-y-6">
                <Button variant="ghost" onClick={() => navigate(-1)}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Kembali
                </Button>
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-16">
                        <div className="bg-muted/50 p-4 rounded-full mb-4">
                            <Archive className="h-12 w-12 text-muted-foreground" />
                        </div>
                        <h2 className="text-xl font-semibold mb-2">Arsip Tidak Ditemukan</h2>
                        <p className="text-muted-foreground text-center max-w-sm">
                            {error || 'Data arsip dengan ID tersebut tidak tersedia atau sudah dihapus.'}
                        </p>
                        <Button className="mt-6" onClick={() => navigate('/arsip')}>
                            Kembali ke Daftar Arsip
                        </Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    // ─── Derived data ───────────────────
    const suratType = arsip.jenisArsip === 'masuk' ? 'masuk' : 'keluar'
    const suratUrl = arsip.sourceSuratId ? `/surat/${suratType}/${arsip.sourceSuratId}` : null
    const itemCount = arsip.items?.length || (arsip.nomorItem ? 1 : 0)
    const jenisLabel = arsip.jenisArsip === 'masuk' ? 'Surat Masuk' : 'Surat Keluar'

    const statusColor = (() => {
        if (arsip.disposalStatus === 'active') return 'default'
        if (arsip.disposalStatus?.includes('proposed')) return 'outline'
        if (arsip.disposalStatus === 'executed') return 'destructive'
        return 'secondary'
    })()

    // Retensi progress calculation
    const retensiAktifYears = parseInt(arsip.retensiAktif) || 0
    const retensiInaktifYears = parseInt(arsip.retensiInaktif) || 0
    const totalRetensi = retensiAktifYears + retensiInaktifYears
    const daysSinceArchived = arsip.createdAt ? differenceInDays(new Date(), new Date(arsip.createdAt)) : 0
    const yearsSinceArchived = daysSinceArchived / 365
    const progressAktif = retensiAktifYears > 0 ? Math.min((yearsSinceArchived / retensiAktifYears) * 100, 100) : 0

    const daysUntilExpiry = arsip.tanggalKadaluarsa ? differenceInDays(new Date(arsip.tanggalKadaluarsa), new Date()) : null

    // Lokasi string
    const lokasiStr = [arsip.lokasiFc, arsip.lokasiLaci, arsip.lokasiFolder].filter(Boolean).join(' / ') || '-'

    // Timeline events
    const timelineEvents = [
        arsip.disposalStatus === 'executed' && {
            icon: Trash2, label: 'Disposal Dilakukan', date: arsip.updatedAt, color: 'red'
        },
        { icon: Archive, label: 'Diarsipkan', date: arsip.createdAt, color: 'emerald' },
        arsip.tanggalSuratOriginal && {
            icon: FileText, label: `Surat ${jenisLabel} Dibuat`, date: arsip.tanggalSuratOriginal, color: 'blue'
        },
    ].filter(Boolean)

    // ─── Render ─────────────────────────
    return (
        <div className="space-y-6">
            {/* ═══════════════════════════════════ HERO HEADER ═══════════════════════════════════ */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-emerald-900 to-teal-800 p-6 md:p-8 text-white shadow-xl">
                {/* Background decorative elements */}
                <div className="absolute inset-0 opacity-10">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-card rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2" />
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-card rounded-full blur-3xl transform -translate-x-1/2 translate-y-1/2" />
                </div>

                <div className="relative space-y-5">
                    {/* Top row: back + actions */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-white/80 hover:text-white hover:bg-card/10"
                            onClick={() => navigate(-1)}
                        >
                            <ArrowLeft className="mr-2 h-4 w-4" /> Kembali
                        </Button>
                        <div className="flex flex-wrap gap-2">
                            {suratUrl && (
                                <Link to={suratUrl}>
                                    <Button variant="secondary" size="sm" className="bg-card/20 hover:bg-card/30 text-white border-0 backdrop-blur-sm">
                                        <ExternalLink className="mr-2 h-4 w-4" /> Lihat Surat Asli
                                    </Button>
                                </Link>
                            )}
                        </div>
                    </div>

                    {/* Title area */}
                    <div className="flex items-center gap-4">
                        <div className="bg-card/20 p-3 rounded-xl backdrop-blur-sm shrink-0 hidden sm:flex">
                            <Archive className="h-8 w-8" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <h1 className="text-xl md:text-2xl font-bold">Detail Arsip</h1>
                            </div>
                            <p className="font-mono text-white/90 text-sm md:text-base">{arsip.nomorBerkas || '-'}</p>
                            <div className="flex gap-2 mt-2 flex-wrap">
                                <Badge className="bg-emerald-500/20 text-emerald-200 border-emerald-400/30 border">
                                    {jenisLabel}
                                </Badge>
                                <Badge className={`border ${arsip.disposalStatus === 'active'
                                    ? 'bg-blue-500/20 text-blue-200 border-blue-400/30'
                                    : arsip.disposalStatus === 'executed'
                                        ? 'bg-red-500/20 text-red-200 border-red-400/30'
                                        : 'bg-card/10 text-white/70 border-white/20'
                                    }`}>
                                    {arsip.disposalStatus || 'Active'}
                                </Badge>
                                {arsip.klasifikasiKeamanan && (
                                    <Badge className="bg-amber-500/20 text-amber-200 border-amber-400/30 border">
                                        <Shield className="mr-1 h-3 w-3" /> {arsip.klasifikasiKeamanan}
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Quick Stats Strip */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <QuickStatBox icon={Layers} label="Item Arsip" value={`${itemCount} Item`} />
                        <QuickStatBox icon={Clock} label="Retensi" value={totalRetensi > 0 ? `${totalRetensi} Tahun` : '-'} />
                        <QuickStatBox icon={MapPin} label="Lokasi" value={lokasiStr} />
                        <QuickStatBox icon={Shield} label="Keamanan" value={arsip.klasifikasiKeamanan || 'Biasa'} />
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════ MAIN LAYOUT ═══════════════════════════════════ */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* ── Main Content (2/3) ─────────── */}
                <div className="lg:col-span-2">
                    <Tabs defaultValue="identifikasi" className="w-full">
                        <TabsList className="w-full justify-start bg-muted/50 h-auto p-1 rounded-xl flex-wrap">
                            <TabsTrigger value="identifikasi" className="gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-lg px-3 py-2 text-xs sm:text-sm">
                                <FileText className="h-4 w-4" /> Identifikasi
                            </TabsTrigger>
                            <TabsTrigger value="items" className="gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-lg px-3 py-2 text-xs sm:text-sm">
                                <Layers className="h-4 w-4" /> Item Arsip
                                <Badge variant="secondary" className="ml-1 text-xs h-5 px-1.5">{itemCount}</Badge>
                            </TabsTrigger>
                            <TabsTrigger value="retensi" className="gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-lg px-3 py-2 text-xs sm:text-sm">
                                <Clock className="h-4 w-4" /> Retensi & Lokasi
                            </TabsTrigger>
                            <TabsTrigger value="keamanan" className="gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-lg px-3 py-2 text-xs sm:text-sm">
                                <Shield className="h-4 w-4" /> Keamanan
                            </TabsTrigger>
                            <TabsTrigger value="surat" className="gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-lg px-3 py-2 text-xs sm:text-sm">
                                <BookOpen className="h-4 w-4" /> Surat Asli
                            </TabsTrigger>
                        </TabsList>

                        {/* ── Tab: Identifikasi ────────── */}
                        <TabsContent value="identifikasi" className="mt-4">
                            <Card>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-500/15">
                                            <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                        </div>
                                        Identifikasi Berkas
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                        <EnhancedInfoField icon={Hash} label="Nomor Berkas" value={arsip.nomorBerkas} />
                                        <EnhancedInfoField icon={Tag} label="Kode Klasifikasi" value={arsip.kodeKlasifikasi} />
                                        <EnhancedInfoField icon={Layers} label="Jenis Arsip" value={jenisLabel} badge variant="secondary" />
                                        <EnhancedInfoField icon={Calendar} label="Tahun" value={arsip.tahun?.toString()} />
                                        <EnhancedInfoField icon={FileText} label="Uraian Berkas" value={arsip.uraianBerkas} className="sm:col-span-2" />
                                        <EnhancedInfoField icon={Calendar} label="Tanggal Arsip" value={formatDate(arsip.tanggalArsip)} />
                                        <EnhancedInfoField icon={Clock} label="Kurun Waktu" value={arsip.kurunWaktu} />
                                        <EnhancedInfoField icon={Info} label="Unit Pengolah" value={arsip.unitPengolah} className="sm:col-span-2 lg:col-span-4" />
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* ── Tab: Item Arsip ───────────── */}
                        <TabsContent value="items" className="mt-4">
                            <Card className="overflow-hidden">
                                <CardHeader className="bg-gradient-to-r from-indigo-50 to-sky-50 border-b pb-3">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-500/15">
                                                <Layers className="h-4 w-4 text-indigo-600" />
                                            </div>
                                            Daftar Item Arsip
                                            <Badge className="bg-indigo-100 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-0">{itemCount} Item</Badge>
                                        </CardTitle>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="bg-muted/80">
                                                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b w-14">No</th>
                                                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b">Uraian Informasi</th>
                                                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b w-32">Tk. Perkembangan</th>
                                                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b w-28">Tanggal</th>
                                                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b w-16">Jml</th>
                                                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b w-24">Media</th>
                                                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b w-40">Lokasi</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {arsip.items && arsip.items.length > 0 ? (
                                                    arsip.items.map((item, idx) => (
                                                        <tr key={item.id || idx} className="hover:bg-muted/80 transition-colors group">
                                                            <td className="px-4 py-3">
                                                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-muted text-xs font-semibold text-muted-foreground group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/15 group-hover:text-indigo-700 dark:group-hover:text-indigo-300 transition-colors">
                                                                    {item.nomorItem || idx + 1}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 text-foreground font-medium">{item.uraianItem || '-'}</td>
                                                            <td className="px-4 py-3">
                                                                <Badge variant="outline" className="text-xs">{item.tingkatPerkembangan || '-'}</Badge>
                                                            </td>
                                                            <td className="px-4 py-3 text-muted-foreground">{formatDate(item.tanggalItem)}</td>
                                                            <td className="px-4 py-3 text-center">
                                                                <span className="font-semibold text-foreground">{item.jumlah || 1}</span>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <Badge variant="secondary" className="text-xs">{item.mediaType || 'kertas'}</Badge>
                                                            </td>
                                                            <td className="px-4 py-3 text-muted-foreground text-xs">
                                                                {[item.lokasiFc, item.lokasiLaci, item.lokasiFolder].filter(Boolean).join(' / ') || '-'}
                                                            </td>
                                                        </tr>
                                                    ))
                                                ) : arsip.nomorItem ? (
                                                    <tr className="hover:bg-muted/80 transition-colors group">
                                                        <td className="px-4 py-3">
                                                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                                                                {arsip.nomorItem}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-foreground font-medium">{arsip.uraianItem || '-'}</td>
                                                        <td className="px-4 py-3">
                                                            <Badge variant="outline" className="text-xs">{arsip.tingkatPerkembangan || '-'}</Badge>
                                                        </td>
                                                        <td className="px-4 py-3 text-muted-foreground">{formatDate(arsip.tanggalArsip)}</td>
                                                        <td className="px-4 py-3 text-center font-semibold text-foreground">{arsip.jumlah || 1}</td>
                                                        <td className="px-4 py-3">
                                                            <Badge variant="secondary" className="text-xs">{arsip.mediaType || 'kertas'}</Badge>
                                                        </td>
                                                        <td className="px-4 py-3 text-muted-foreground text-xs">
                                                            {[arsip.lokasiFc, arsip.lokasiLaci, arsip.lokasiFolder].filter(Boolean).join(' / ') || '-'}
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    <tr>
                                                        <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground italic">
                                                            Tidak ada item arsip
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                    {itemCount > 0 && (
                                        <div className="px-4 py-2.5 bg-muted/50 border-t text-xs text-muted-foreground text-center">
                                            Menampilkan {itemCount} item
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* ── Tab: Retensi & Lokasi ──────── */}
                        <TabsContent value="retensi" className="mt-4 space-y-4">
                            {/* Lokasi Penyimpanan */}
                            <Card>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <div className="p-1.5 rounded-lg bg-green-100 dark:bg-green-500/15">
                                            <MapPin className="h-4 w-4 text-green-600 dark:text-green-400" />
                                        </div>
                                        Lokasi Penyimpanan
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        <EnhancedInfoField icon={FolderOpen} label="Filing Cabinet (FC)" value={arsip.lokasiFc} />
                                        <EnhancedInfoField icon={FolderOpen} label="Laci" value={arsip.lokasiLaci} />
                                        <EnhancedInfoField icon={FolderOpen} label="Folder" value={arsip.lokasiFolder} />
                                    </div>
                                </CardContent>
                            </Card>

                            {/* JRA */}
                            <Card>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <div className="p-1.5 rounded-lg bg-orange-100 dark:bg-orange-500/15">
                                            <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                                        </div>
                                        Jadwal Retensi Arsip (JRA)
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <EnhancedInfoField icon={Tag} label="Kode JRA" value={arsip.jraKode} />
                                        <EnhancedInfoField icon={FileText} label="Uraian JRA" value={arsip.jraUraian} />
                                        <EnhancedInfoField icon={Clock} label="Retensi Aktif" value={arsip.retensiAktif} />
                                        <EnhancedInfoField icon={Clock} label="Retensi Inaktif" value={arsip.retensiInaktif} />
                                        <EnhancedInfoField icon={Info} label="Hasil Akhir" value={arsip.hasilAkhir} badge variant={arsip.hasilAkhir === 'Permanen' ? 'default' : 'destructive'} />
                                        <EnhancedInfoField icon={Calendar} label="Tanggal Kadaluarsa" value={formatDate(arsip.tanggalKadaluarsa)} />
                                        <EnhancedInfoField icon={Info} label="Status Disposal" value={arsip.disposalStatus} badge variant={statusColor} className="sm:col-span-2" />
                                    </div>

                                    {/* Progress Visual */}
                                    {retensiAktifYears > 0 && (
                                        <>
                                            <Separator className="my-4" />
                                            <div className="space-y-3">
                                                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                                                    <Clock className="h-4 w-4 text-orange-500" /> Progress Retensi Aktif
                                                </h4>
                                                <div>
                                                    <div className="flex justify-between text-xs mb-1.5 text-muted-foreground">
                                                        <span>{Math.min(yearsSinceArchived, retensiAktifYears).toFixed(1)} dari {retensiAktifYears} tahun</span>
                                                        <span className="font-semibold text-foreground">{Math.round(progressAktif)}%</span>
                                                    </div>
                                                    <Progress value={progressAktif} className="h-2.5" />
                                                </div>
                                                {daysUntilExpiry !== null && (
                                                    <div className={`flex items-center gap-2 text-sm p-3 rounded-lg ${daysUntilExpiry <= 30
                                                        ? 'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border border-red-100'
                                                        : daysUntilExpiry <= 365
                                                            ? 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-100'
                                                            : 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-100'
                                                        }`}>
                                                        <Calendar className="h-4 w-4 shrink-0" />
                                                        <span>
                                                            {daysUntilExpiry > 0
                                                                ? `Kadaluarsa dalam ${daysUntilExpiry} hari (${formatDate(arsip.tanggalKadaluarsa)})`
                                                                : `Sudah kadaluarsa sejak ${formatDate(arsip.tanggalKadaluarsa)}`
                                                            }
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* ── Tab: Keamanan ──────────────── */}
                        <TabsContent value="keamanan" className="mt-4">
                            <Card>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <div className="p-1.5 rounded-lg bg-red-100 dark:bg-red-500/15">
                                            <Shield className="h-4 w-4 text-red-600" />
                                        </div>
                                        Keamanan & Penanggung Jawab
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <EnhancedInfoField icon={Shield} label="Klasifikasi Keamanan" value={arsip.klasifikasiKeamanan} badge variant="outline" />
                                        <EnhancedInfoField icon={User} label="Person In Charge (PIC)" value={arsip.personInCharge} />
                                        <EnhancedInfoField icon={FileText} label="Keterangan" value={arsip.keterangan} className="sm:col-span-2" />
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* ── Tab: Surat Asli ────────────── */}
                        <TabsContent value="surat" className="mt-4">
                            <Card>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <div className="p-1.5 rounded-lg bg-teal-100 dark:bg-teal-500/15">
                                            <BookOpen className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                                        </div>
                                        Informasi Surat Asli
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <EnhancedInfoField icon={Hash} label="Nomor Surat" value={arsip.nomorSuratOriginal} />
                                        <EnhancedInfoField icon={Calendar} label="Tanggal Surat" value={formatDate(arsip.tanggalSuratOriginal)} />
                                        <EnhancedInfoField icon={FileText} label="Perihal" value={arsip.perihalOriginal} className="sm:col-span-2" />
                                    </div>
                                    {suratUrl && (
                                        <>
                                            <Separator className="my-4" />
                                            <Link to={suratUrl}>
                                                <Button variant="outline" className="gap-2 w-full sm:w-auto">
                                                    <ExternalLink className="h-4 w-4" />
                                                    Buka {jenisLabel} Asli
                                                    <ChevronRight className="h-4 w-4 ml-auto" />
                                                </Button>
                                            </Link>
                                        </>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>

                {/* ── Sidebar (1/3) ──────────────── */}
                <div className="space-y-4">
                    {/* Status Card */}
                    <Card className="shadow-sm overflow-hidden">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-semibold">Status Arsip</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 pt-0">
                            <StatusIndicator
                                label="Status disposal"
                                active={arsip.disposalStatus === 'active'}
                                activeLabel="Aktif"
                                inactiveLabel={arsip.disposalStatus || 'Tidak diketahui'}
                                activeColor="emerald"
                                icon={Archive}
                            />
                            <StatusIndicator
                                label="Status peminjaman"
                                active={arsip.lendingStatus === 'available'}
                                activeLabel="Tersedia"
                                inactiveLabel="Dipinjam"
                                activeColor="blue"
                                icon={Eye}
                            />
                        </CardContent>
                    </Card>

                    {/* Quick Actions */}
                    <Card className="shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-semibold">Aksi Cepat</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 pt-0">
                            {suratUrl && (
                                <Link to={suratUrl} className="block">
                                    <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                                        <ExternalLink className="h-4 w-4" /> Lihat Surat Asli
                                    </Button>
                                </Link>
                            )}
                            <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => window.print()}>
                                <Printer className="h-4 w-4" /> Cetak Detail
                            </Button>
                        </CardContent>
                    </Card>

                    {/* Retensi Progress (Compact) */}
                    {retensiAktifYears > 0 && (
                        <Card className="shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-orange-500" /> Retensi
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0 space-y-3">
                                <div>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-muted-foreground">Aktif</span>
                                        <span className="font-medium">{Math.round(progressAktif)}%</span>
                                    </div>
                                    <Progress value={progressAktif} className="h-2" />
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {Math.min(yearsSinceArchived, retensiAktifYears).toFixed(1)} / {retensiAktifYears} tahun
                                    </p>
                                </div>
                                <Separator />
                                <div className="flex items-center gap-2 text-xs">
                                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-muted-foreground">
                                        Kadaluarsa: <strong className="text-foreground">{formatDate(arsip.tanggalKadaluarsa)}</strong>
                                    </span>
                                </div>
                                {arsip.hasilAkhir && (
                                    <div className="flex items-center gap-2 text-xs">
                                        <Info className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span className="text-muted-foreground">
                                            Hasil akhir: <Badge variant={arsip.hasilAkhir === 'Permanen' ? 'default' : 'destructive'} className="text-xs h-5 ml-1">
                                                {arsip.hasilAkhir}
                                            </Badge>
                                        </span>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Timeline */}
                    <Card className="shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-semibold">Riwayat</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-0">
                            <div className="space-y-0">
                                {timelineEvents.map((event, idx) => (
                                    <TimelineEvent
                                        key={idx}
                                        icon={event.icon}
                                        label={event.label}
                                        date={event.date}
                                        color={event.color}
                                        isLast={idx === timelineEvents.length - 1}
                                    />
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Metadata */}
                    <Card className="shadow-sm">
                        <CardContent className="py-4">
                            <div className="space-y-2 text-xs text-muted-foreground">
                                <div className="flex justify-between">
                                    <span>ID</span>
                                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{arsip.id}</code>
                                </div>
                                <Separator />
                                <div className="flex justify-between">
                                    <span>Dibuat</span>
                                    <span>{formatDate(arsip.createdAt)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Diperbarui</span>
                                    <span>{formatDate(arsip.updatedAt)}</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
