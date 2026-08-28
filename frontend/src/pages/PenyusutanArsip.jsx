import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
import { penyusutanService } from '@/services/penyusutan.service'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import {
    FileText, Download, Plus, Trash2, CheckCircle, ChevronRight,
    ArrowRightLeft, Flame, Send, RefreshCw, Printer, Eye, X, Repeat,
    Archive, History, FileCheck, AlertCircle, ChevronDown
} from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Link } from 'react-router-dom'

const STATUS_CONFIG = {
    draft: { label: 'Draft', color: 'bg-muted text-foreground border-border', icon: FileText },
    proposed: { label: 'Diusulkan', color: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200', icon: Send },
    reviewed: { label: 'Ditinjau', color: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200', icon: Eye },
    approved: { label: 'Disetujui', color: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200', icon: CheckCircle },
    executed: { label: 'Dilaksanakan', color: 'bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-200', icon: FileCheck },
}

const JENIS_CONFIG = {
    pemindahan: { label: 'Pemindahan', icon: ArrowRightLeft, desc: 'Transfer arsip dari Unit Pengolah ke Unit Kearsipan', color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-500/15', border: 'border-blue-200' },
    pemusnahan: { label: 'Pemusnahan', icon: Flame, desc: 'Pemusnahan arsip yang telah melewati masa retensi (JRA: Musnah)', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-500/15', border: 'border-red-200' },
    alih_media: { label: 'Alih Media', icon: Repeat, desc: 'Alih media arsip dari bentuk fisik ke digital atau sebaliknya', color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-100 dark:bg-indigo-500/15', border: 'border-indigo-200' },
    penyerahan: { label: 'Penyerahan (Riwayat)', icon: Archive, desc: 'Riwayat batch penyerahan lama tersedia dalam mode baca dan cetak', color: 'text-amber-600', bg: 'bg-amber-100 dark:bg-amber-500/15', border: 'border-amber-200' },
}

const NEXT_ACTION_LABEL = {
    draft: 'Usulkan',
    proposed: 'Tinjau',
    reviewed: 'Setujui',
    approved: 'Laksanakan',
}

export default function PenyusutanArsip() {
    const { user } = useAuth()
    const { toast } = useToast()
    const unitKerjaId = user?.unitKerjaId || ''

    const [activeTab, setActiveTab] = useState('pemindahan')
    const [batches, setBatches] = useState([])
    const [candidates, setCandidates] = useState([])
    const [selectedBatch, setSelectedBatch] = useState(null)
    const [loading, setLoading] = useState(false)
    const [showCreate, setShowCreate] = useState(false)
    const [selectedCandidates, setSelectedCandidates] = useState([])
    const [createKeterangan, setCreateKeterangan] = useState('')

    // Load batches for active tab
    const loadBatches = useCallback(async () => {
        if (!unitKerjaId) return
        setLoading(true)
        try {
            const result = await penyusutanService.findAll({
                unitKerjaId,
                jenisPenyusutan: activeTab,
            })
            setBatches(result.data || [])
        } catch (err) {
            console.error('Error loading batches:', err)
        } finally {
            setLoading(false)
        }
    }, [unitKerjaId, activeTab])

    // Load candidates
    const loadCandidates = useCallback(async () => {
        if (!unitKerjaId) return
        if (activeTab === 'penyerahan') {
            setCandidates([])
            return
        }
        try {
            const result = await penyusutanService.getCandidates(unitKerjaId, activeTab)
            setCandidates(result.data || [])
        } catch (err) {
            console.error('Error loading candidates:', err)
            setCandidates([])
        }
    }, [unitKerjaId, activeTab])

    useEffect(() => {
        loadBatches()
        loadCandidates()
        setSelectedBatch(null)
        setShowCreate(false)
        setSelectedCandidates([])
    }, [activeTab, loadBatches, loadCandidates])

    // Load batch detail
    const loadBatchDetail = async (id) => {
        try {
            const result = await penyusutanService.findById(id)
            setSelectedBatch(result.data)
        } catch (err) {
            toast({ title: 'Error', description: err.response?.data?.error || 'Gagal memuat detail batch', variant: 'destructive' })
        }
    }

    // Create batch
    const handleCreate = async () => {
        if (activeTab === 'penyerahan') return
        if (selectedCandidates.length === 0) {
            toast({ title: 'Peringatan', description: 'Pilih minimal 1 arsip', variant: 'destructive' })
            return
        }
        try {
            await penyusutanService.create({
                unitKerjaId,
                jenisPenyusutan: activeTab,
                keterangan: createKeterangan,
                arsipIds: selectedCandidates,
            })
            toast({ title: 'Berhasil', description: 'Usulan penyusutan berhasil dibuat' })
            setShowCreate(false)
            setSelectedCandidates([])
            setCreateKeterangan('')
            loadBatches()
            loadCandidates()
        } catch (err) {
            toast({ title: 'Error', description: err.response?.data?.error || 'Gagal membuat usulan', variant: 'destructive' })
        }
    }

    // Advance status
    const handleAdvanceStatus = async (id) => {
        try {
            await penyusutanService.updateStatus(id)
            toast({ title: 'Berhasil', description: 'Status berhasil dimajukan' })
            loadBatches()
            if (selectedBatch?.id === id) loadBatchDetail(id)
        } catch (err) {
            toast({ title: 'Error', description: err.response?.data?.error || 'Gagal mengubah status', variant: 'destructive' })
        }
    }

    // Delete batch
    const handleDelete = async (id) => {
        if (!confirm('Yakin hapus usulan ini?')) return
        try {
            await penyusutanService.deleteBatch(id)
            toast({ title: 'Berhasil', description: 'Usulan berhasil dihapus' })
            setSelectedBatch(null)
            loadBatches()
            loadCandidates()
        } catch (err) {
            toast({ title: 'Error', description: err.response?.data?.error || 'Gagal menghapus', variant: 'destructive' })
        }
    }

    // Print
    const handlePrint = (type, batchId) => {
        let url = ''
        if (type === 'daftar-arsip-aktif' || type === 'daftar-arsip-inaktif') {
            url = penyusutanService.getPrintUrl(type, { unitKerjaId })
        } else {
            url = penyusutanService.getBatchPrintUrl(batchId, type)
        }
        if (url) window.open(url, '_blank')
    }

    const toggleCandidate = (id) => {
        setSelectedCandidates(prev =>
            prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
        )
    }

    const selectAllCandidates = () => {
        if (selectedCandidates.length === candidates.length) {
            setSelectedCandidates([])
        } else {
            setSelectedCandidates(candidates.map(c => c.id))
        }
    }

    const JenisConf = JENIS_CONFIG[activeTab]
    const legacyTransferReadOnly = activeTab === 'penyerahan'

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <div className="p-2 bg-rose-100 dark:bg-rose-500/15 rounded-lg">
                            <History className="h-6 w-6 text-rose-600 dark:text-rose-400" />
                        </div>
                        Penyusutan Arsip
                    </h1>
                    <p className="text-muted-foreground">
                        Kelola daur hidup arsip: Pemindahan, Pemusnahan, dan Penyerahan
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => handlePrint('daftar-arsip-aktif')}>
                        <Printer className="mr-1.5 h-4 w-4" /> Daftar Arsip Aktif
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handlePrint('daftar-arsip-inaktif')}>
                        <Printer className="mr-1.5 h-4 w-4" /> Daftar Arsip Inaktif
                    </Button>
                </div>
            </div>

            {/* Navigation Tabs */}
            <Card className="border-border/60 shadow-sm">
                <div className="p-1">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <TabsList className="w-full justify-start h-12 bg-transparent p-0 gap-2 overflow-x-auto">
                            {Object.entries(JENIS_CONFIG).map(([key, conf]) => (
                                <TabsTrigger
                                    key={key}
                                    value={key}
                                    className={`data-[state=active]:bg-primary/5 data-[state=active]:text-primary data-[state=active]:shadow-none h-10 px-4 rounded-md border border-transparent data-[state=active]:border-primary/20 transition-all`}
                                >
                                    <conf.icon className="h-4 w-4 mr-2" />
                                    {conf.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                </div>
                <div className={`px-6 py-3 border-t text-sm flex items-center gap-2 ${JenisConf.bg} ${JenisConf.color} bg-opacity-30`}>
                    <AlertCircle className="h-4 w-4" />
                    {JenisConf.desc}
                </div>
            </Card>

            {legacyTransferReadOnly && (
                <Card className="border-amber-300 bg-amber-50/60 dark:bg-amber-500/10">
                    <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-start gap-3">
                            <Archive className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
                            <div>
                                <p className="font-semibold text-amber-950 dark:text-amber-100">Penyerahan lama hanya untuk riwayat</p>
                                <p className="text-sm text-amber-900/80 dark:text-amber-100/80">
                                    Batch lama tetap dapat dibaca dan dicetak, tetapi tidak dapat dibuat, diubah, atau dilanjutkan. Gunakan manifest penyerahan permanen dengan pemeriksaan bukti dan maker-checker.
                                </p>
                            </div>
                        </div>
                        <Button asChild className="shrink-0">
                            <Link to="/retention-governance">Buka Tata Kelola Retensi</Link>
                        </Button>
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-250px)] min-h-[600px]">
                {/* Left column: Batches list */}
                <Card className="lg:col-span-4 h-full flex flex-col border-border/60 shadow-sm overflow-hidden">
                    <CardHeader className="pb-3 border-b bg-muted/30">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <CardTitle className="text-base font-semibold">Riwayat Usulan</CardTitle>
                            <div className="flex gap-1">
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { loadBatches(); loadCandidates(); }}>
                                    <RefreshCw className="h-4 w-4" />
                                </Button>
                                {!legacyTransferReadOnly && (
                                    <Button size="icon" className="h-8 w-8" onClick={() => setShowCreate(true)}>
                                        <Plus className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0 flex-1 overflow-hidden relative">
                        {loading ? (
                            <div className="p-4 space-y-3">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="flex gap-3">
                                        <Skeleton className="h-12 w-12 rounded-md" />
                                        <div className="space-y-2 flex-1">
                                            <Skeleton className="h-4 w-3/4" />
                                            <Skeleton className="h-3 w-1/2" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : batches.length === 0 ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                                <div className="p-4 bg-muted/50 rounded-full mb-4">
                                    <FileText className="h-8 w-8 text-muted-foreground/50" />
                                </div>
                                <h3 className="font-medium mb-1">{legacyTransferReadOnly ? 'Belum ada riwayat penyerahan' : 'Belum ada usulan'}</h3>
                                <p className="text-sm text-muted-foreground mb-4">{legacyTransferReadOnly ? 'Manifest baru dikelola melalui Tata Kelola Retensi.' : 'Mulai dengan membuat usulan baru'}</p>
                                {!legacyTransferReadOnly && (
                                    <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
                                        <Plus className="mr-1.5 h-3.5 w-3.5" /> Buat Usulan
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <ScrollArea className="h-full">
                                <div className="divide-y">
                                    {batches.map(batch => {
                                        const st = STATUS_CONFIG[batch.status] || STATUS_CONFIG.draft
                                        const StatusIcon = st.icon
                                        return (
                                            <div
                                                key={batch.id}
                                                className={`p-4 cursor-pointer transition-all hover:bg-muted/50 ${selectedBatch?.id === batch.id ? 'bg-primary/5 border-l-4 border-l-primary pl-[13px]' : 'border-l-4 border-l-transparent'}`}
                                                onClick={() => loadBatchDetail(batch.id)}
                                            >
                                                <div className="flex justify-between items-start mb-2">
                                                    <span className="font-medium text-sm truncate pr-2">
                                                        {batch.nomorBA || `Batch #${batch.id.substring(0, 8)}`}
                                                    </span>
                                                    <Badge variant="outline" className={`${st.color} text-[10px] h-5 px-1.5`}>
                                                        {st.label}
                                                    </Badge>
                                                </div>
                                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                    <div className="flex items-center gap-2">
                                                        <FileText className="h-3.5 w-3.5" />
                                                        {batch.totalBerkas} berkas
                                                    </div>
                                                    <span>
                                                        {batch.createdAt ? new Date(batch.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '-'}
                                                    </span>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </ScrollArea>
                        )}
                    </CardContent>
                </Card>

                {/* Right column: Main Content Area */}
                <div className="lg:col-span-8 h-full flex flex-col gap-6 overflow-hidden">
                    {showCreate && !legacyTransferReadOnly ? (
                        <Card className="h-full flex flex-col border-emerald-200 bg-emerald-50/10 shadow-sm overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">
                            <CardHeader className="pb-3 border-b bg-emerald-50/50">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 bg-emerald-100 dark:bg-emerald-500/15 rounded-md text-emerald-700 dark:text-emerald-300">
                                            <Plus className="h-4 w-4" />
                                        </div>
                                        <CardTitle className="text-base text-emerald-950">Buat Usulan {JenisConf.label} Baru</CardTitle>
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                                <CardDescription>Pilih arsip yang memenuhi syarat untuk di-{activeTab}kan</CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1 overflow-hidden p-0 flex flex-col">
                                {candidates.length === 0 ? (
                                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                                        <AlertCircle className="h-10 w-10 text-muted-foreground/40 mb-3" />
                                        <p className="font-medium text-muted-foreground">Tidak ada arsip yang memenuhi syarat</p>
                                        <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
                                            Pastikan retensi arsip sudah habis dan sesuai dengan kriteria {activeTab}.
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="p-4 border-b bg-background/50 flex items-center justify-between sticky top-0 z-10">
                                            <span className="text-sm font-medium">{selectedCandidates.length} arsip dipilih</span>
                                            <Button variant="outline" size="sm" onClick={selectAllCandidates} className="h-8 text-xs">
                                                {selectedCandidates.length === candidates.length ? 'Hapus Semua' : 'Pilih Semua'}
                                            </Button>
                                        </div>
                                        <ScrollArea className="flex-1 p-4">
                                            <div className="space-y-2">
                                                {candidates.map(c => (
                                                    <label
                                                        key={c.id}
                                                        className={`flex items-start gap-3 p-3 rounded-md border transition-all cursor-pointer ${selectedCandidates.includes(c.id) ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 shadow-sm' : 'hover:bg-muted/50 border-border'}`}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedCandidates.includes(c.id)}
                                                            onChange={() => toggleCandidate(c.id)}
                                                            className="mt-1 rounded border-border text-emerald-600 focus:ring-emerald-500"
                                                        />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex justify-between gap-2">
                                                                <p className="text-sm font-medium text-foreground truncate">{c.uraianBerkas || c.uraianItem || 'Tanpa uraian'}</p>
                                                                <Badge variant="secondary" className="text-[10px] h-5">{c.hasilAkhir || '-'}</Badge>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground mt-1 font-mono">
                                                                {c.kodeKlasifikasi || '-'} • {c.nomorBerkas || '-'}
                                                            </p>
                                                        </div>
                                                    </label>
                                                ))}
                                            </div>
                                        </ScrollArea>
                                        <div className="p-4 border-t bg-background">
                                            <label className="text-sm font-medium mb-1.5 block">Keterangan (opsional)</label>
                                            <Textarea
                                                className="resize-none text-sm mb-4"
                                                rows={2}
                                                value={createKeterangan}
                                                onChange={e => setCreateKeterangan(e.target.value)}
                                                placeholder="Tambahkan catatan untuk usulan ini..."
                                            />
                                            <div className="flex gap-2 justify-end">
                                                <Button variant="outline" onClick={() => setShowCreate(false)}>Batal</Button>
                                                <Button onClick={handleCreate} disabled={selectedCandidates.length === 0} className="bg-emerald-600 hover:bg-emerald-700">
                                                    <Plus className="mr-1.5 h-4 w-4" />
                                                    Buat Usulan ({selectedCandidates.length})
                                                </Button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    ) : selectedBatch ? (
                        <Card className="h-full flex flex-col border-border/60 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <CardHeader className="pb-4 border-b bg-muted/20">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <Badge variant="outline" className={`${STATUS_CONFIG[selectedBatch.status]?.color} mb-2`}>
                                            {STATUS_CONFIG[selectedBatch.status]?.label}
                                        </Badge>
                                        <CardTitle className="text-xl">{selectedBatch.nomorBA || 'Tanpa Nomor BA'}</CardTitle>
                                        <CardDescription className="flex items-center gap-2">
                                            <History className="h-3.5 w-3.5" />
                                            Diusulkan pada {selectedBatch.tanggalUsul || '-'}
                                        </CardDescription>
                                    </div>
                                    <Button variant="outline" size="sm" onClick={() => setSelectedBatch(null)}>
                                        <X className="h-4 w-4 mr-1" /> Tutup
                                    </Button>
                                </div>
                            </CardHeader>

                            <CardContent className="flex-1 overflow-y-auto p-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                    <div className="space-y-4">
                                        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Informasi Batch</h4>
                                        <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
                                            <span className="text-muted-foreground">Total Berkas:</span>
                                            <span className="font-medium">{selectedBatch.totalBerkas} item</span>

                                            <span className="text-muted-foreground">Tgl Persetujuan:</span>
                                            <span>{selectedBatch.tanggalPersetujuan || '-'}</span>

                                            <span className="text-muted-foreground">Keterangan:</span>
                                            <span className="italic text-muted-foreground">{selectedBatch.keterangan || '-'}</span>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Tindakan Cepat</h4>
                                        <div className="flex flex-wrap gap-2">
                                            {activeTab === 'pemindahan' && selectedBatch.status !== 'draft' && (
                                                <Button variant="outline" size="sm" onClick={() => handlePrint('usul-pindah', selectedBatch.id)} className="h-8 text-xs">
                                                    <Download className="mr-1.5 h-3 w-3" /> Daftar Usul
                                                </Button>
                                            )}
                                            {activeTab === 'pemusnahan' && selectedBatch.status !== 'draft' && (
                                                <Button variant="outline" size="sm" onClick={() => handlePrint('usul-musnah', selectedBatch.id)} className="h-8 text-xs">
                                                    <Download className="mr-1.5 h-3 w-3" /> Daftar Musnah
                                                </Button>
                                            )}
                                            {activeTab === 'penyerahan' && (
                                                <>
                                                    <Button variant="outline" size="sm" onClick={() => handlePrint('usul-serah', selectedBatch.id)} className="h-8 text-xs">
                                                        <Download className="mr-1.5 h-3 w-3" /> Daftar Usul Lama
                                                    </Button>
                                                    <Button variant="outline" size="sm" onClick={() => handlePrint('berita-acara-penyerahan', selectedBatch.id)} className="h-8 text-xs">
                                                        <Printer className="mr-1.5 h-3 w-3" /> Berita Acara Lama
                                                    </Button>
                                                </>
                                            )}
                                            {activeTab !== 'penyerahan' && (
                                                <Button variant="outline" size="sm" onClick={() => handlePrint('berita-acara', selectedBatch.id)} className="h-8 text-xs" disabled={selectedBatch.status === 'draft'}>
                                                    <Printer className="mr-1.5 h-3 w-3" /> Berita Acara
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <Separator className="my-6" />

                                <div className="space-y-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <h4 className="font-semibold flex items-center gap-2">
                                            <FileText className="h-4 w-4 text-primary" />
                                            Daftar Arsip
                                            <Badge variant="secondary" className="ml-2">{selectedBatch.items?.length || 0}</Badge>
                                        </h4>
                                    </div>

                                    <div className="border rounded-md divide-y bg-background">
                                        {selectedBatch.items && selectedBatch.items.length > 0 ? (
                                            selectedBatch.items.map((item, i) => (
                                                <div key={item.id} className="p-3 flex items-start gap-4 hover:bg-muted/30">
                                                    <span className="text-muted-foreground text-xs font-mono w-6 pt-0.5">{i + 1}.</span>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-foreground truncate">{item.arsip?.uraianBerkas || item.arsip?.uraianItem || '-'}</p>
                                                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                                            <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{item.arsip?.kodeKlasifikasi || '-'}</span>
                                                            <span>No: {item.arsip?.nomorBerkas || '-'}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="p-8 text-center text-muted-foreground">Tidak ada detail item</div>
                                        )}
                                    </div>
                                </div>
                            </CardContent>

                            <CardFooter className="border-t bg-muted/10 p-4 flex justify-between gap-4">
                                {!legacyTransferReadOnly && selectedBatch.status === 'draft' && (
                                    <Button variant="destructive" size="sm" onClick={() => handleDelete(selectedBatch.id)}>
                                        <Trash2 className="mr-1.5 h-4 w-4" /> Hapus Draft
                                    </Button>
                                )}

                                <div className="flex gap-2 ml-auto">
                                    {!legacyTransferReadOnly && NEXT_ACTION_LABEL[selectedBatch.status] && (
                                        <Button onClick={() => handleAdvanceStatus(selectedBatch.id)} className="bg-primary hover:bg-primary/90">
                                            <CheckCircle className="mr-1.5 h-4 w-4" />
                                            {NEXT_ACTION_LABEL[selectedBatch.status]}
                                        </Button>
                                    )}
                                </div>
                            </CardFooter>
                        </Card>
                    ) : (
                        <Card className="h-full border-border/60 shadow-sm border-dashed flex flex-col items-center justify-center text-center p-8 bg-muted/10">
                            <div className="p-6 bg-background rounded-full shadow-sm mb-4">
                                <Eye className="h-10 w-10 text-primary/30" />
                            </div>
                            <h3 className="text-lg font-semibold text-foreground">Detail Usulan</h3>
                            <p className="text-muted-foreground max-w-xs mt-2">{legacyTransferReadOnly ? 'Pilih riwayat penyerahan untuk membaca detail dan mencetak dokumen lama.' : 'Pilih salah satu usulan dari daftar di sebelah kiri untuk melihat detail arsip dan melakukan tindakan.'}</p>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    )
}
