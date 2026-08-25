import { useState, useEffect, useCallback } from 'react'
import {
    HardDrive, CheckCircle, RefreshCw, Plus, FileCheck, BarChart3
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { arsipElektronikService } from '@/services/arsip-elektronik.service'
import { STATUS_CONFIG, TABS, INITIAL_FORM, formatFileSize } from './constants'
import ArsipElektronikTable from './ArsipElektronikTable'
import ArsipElektronikForm from './ArsipElektronikForm'
import ArsipElektronikDetail from './ArsipElektronikDetail'

export default function ArsipElektronik() {
    const [activeTab, setActiveTab] = useState('daftar')
    const [data, setData] = useState([])
    const [stats, setStats] = useState(null)
    const [pendingData, setPendingData] = useState([])
    const [loading, setLoading] = useState(false)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [total, setTotal] = useState(0)
    const [filterFormat, setFilterFormat] = useState('all')
    const [filterStatus, setFilterStatus] = useState('all')
    const [filterMedia, setFilterMedia] = useState('all')
    const [selectedItem, setSelectedItem] = useState(null)
    const [verifyDialogOpen, setVerifyDialogOpen] = useState(false)
    const [verifyNote, setVerifyNote] = useState('')
    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const { toast } = useToast()

    const [newForm, setNewForm] = useState(INITIAL_FORM)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const filters = { page, limit: 20 }
            if (filterFormat !== 'all') filters.formatFile = filterFormat
            if (filterStatus !== 'all') filters.statusVerifikasi = filterStatus
            if (filterMedia !== 'all') filters.mediaAsal = filterMedia

            const result = await arsipElektronikService.getAll(filters)
            setData(result.data || [])
            setTotalPages(result.totalPages || 1)
            setTotal(result.total || 0)
        } catch (err) { console.error('Error fetching data:', err) }
        setLoading(false)
    }, [page, filterFormat, filterStatus, filterMedia])

    const fetchStats = useCallback(async () => {
        try {
            const result = await arsipElektronikService.getStats()
            setStats(result)
        } catch (err) { console.error('Error fetching stats:', err) }
    }, [])

    const fetchPending = useCallback(async () => {
        try {
            const result = await arsipElektronikService.getPending(1, 50)
            setPendingData(result.data || [])
        } catch (err) { console.error('Error fetching pending:', err) }
    }, [])

    useEffect(() => {
        const timer = window.setTimeout(() => {
            if (activeTab === 'daftar') fetchData()
            if (activeTab === 'statistik') fetchStats()
            if (activeTab === 'verifikasi') fetchPending()
        }, 0)
        return () => window.clearTimeout(timer)
    }, [activeTab, fetchData, fetchStats, fetchPending])

    // Handlers
    const handleVerify = async (status) => {
        if (!selectedItem) return
        try {
            await arsipElektronikService.verify(selectedItem.id, status, verifyNote)
            toast({ title: `Dokumen ${status === 'verified' ? 'diverifikasi' : 'ditolak'}` })
            setVerifyDialogOpen(false); setVerifyNote(''); setSelectedItem(null)
            fetchPending(); fetchData()
        } catch (err) { toast({ title: 'Gagal', description: err.message, variant: 'destructive' }) }
    }

    const handleCreate = async () => {
        try {
            if (!newForm.arsipId || !newForm.fileAttachmentId) {
                toast({ title: 'Pilih arsip dan lampiran terkendali terlebih dahulu', variant: 'destructive' }); return
            }
            const cleanForm = Object.fromEntries(
                Object.entries(newForm).filter(([, value]) => value !== '' && value !== null)
            )
            await arsipElektronikService.create({
                ...cleanForm,
                resolusiDPI: cleanForm.resolusiDPI ? Number(cleanForm.resolusiDPI) : undefined,
                colorDepth: cleanForm.colorDepth ? Number(cleanForm.colorDepth) : undefined,
                jumlahHalaman: cleanForm.jumlahHalaman ? Number(cleanForm.jumlahHalaman) : undefined,
            })
            toast({ title: 'Bitstream dan metadata elektronik berhasil diregistrasi' })
            setAddDialogOpen(false); setNewForm(INITIAL_FORM); fetchData()
        } catch (err) { toast({ title: 'Gagal', description: err.message, variant: 'destructive' }) }
    }

    const handleDelete = async (id) => {
        if (!confirm('Hapus metadata elektronik ini?')) return
        try {
            await arsipElektronikService.delete(id)
            toast({ title: 'Berhasil dihapus' }); fetchData()
        } catch (err) { toast({ title: 'Gagal', description: err.message, variant: 'destructive' }) }
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <HardDrive className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                        Arsip Elektronik
                    </h1>
                    <p className="text-muted-foreground">Pengelolaan metadata arsip digital, verifikasi, dan konversi</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setAddDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" /> Tambah Metadata
                    </Button>
                    <Button variant="outline" onClick={() => { fetchData(); fetchStats(); fetchPending(); }}>
                        <RefreshCw className="mr-2 h-4 w-4" /> Refresh
                    </Button>
                </div>
            </div>

            {/* Custom Tabs */}
            <div className="flex gap-1 overflow-x-auto border-b">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === tab.id
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <tab.icon className="h-4 w-4" />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab: Daftar → extracted component */}
            {activeTab === 'daftar' && (
                <ArsipElektronikTable
                    data={data} loading={loading} page={page} totalPages={totalPages} total={total}
                    filterFormat={filterFormat} filterStatus={filterStatus} filterMedia={filterMedia}
                    onFilterFormatChange={v => { setFilterFormat(v); setPage(1) }}
                    onFilterStatusChange={v => { setFilterStatus(v); setPage(1) }}
                    onFilterMediaChange={v => { setFilterMedia(v); setPage(1) }}
                    onPageChange={setPage}
                    onOpenVerify={item => { setSelectedItem(item); setVerifyDialogOpen(true) }}
                    onDelete={handleDelete}
                />
            )}

            {/* Tab: Verifikasi */}
            {activeTab === 'verifikasi' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <FileCheck className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                            Antrian Verifikasi
                            <Badge variant="outline">{pendingData.length} pending</Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {pendingData.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground">
                                <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-400" />
                                <p className="text-lg font-medium">Semua dokumen sudah diverifikasi</p>
                                <p className="text-sm">Tidak ada dokumen yang menunggu verifikasi</p>
                            </div>
                        ) : (
                            <Table responsive>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>No.</TableHead>
                                        <TableHead>Format</TableHead>
                                        <TableHead>Ukuran</TableHead>
                                        <TableHead>Media Asal → Tujuan</TableHead>
                                        <TableHead>Hash</TableHead>
                                        <TableHead>Tanggal</TableHead>
                                        <TableHead>Aksi</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {pendingData.map((item, index) => (
                                        <TableRow key={item.id}>
                                            <TableCell data-label="No.">{index + 1}</TableCell>
                                            <TableCell data-label="Format"><Badge variant="outline">{item.formatFile}</Badge></TableCell>
                                            <TableCell data-label="Ukuran" className="text-xs">{formatFileSize(item.ukuranFile)}</TableCell>
                                            <TableCell data-label="Media Asal → Tujuan" className="text-xs">{item.mediaAsal} → {item.mediaTujuan}</TableCell>
                                            <TableCell data-label="Hash" className="font-mono text-xs max-w-[100px] truncate">
                                                {item.hashSHA256 ? item.hashSHA256.substring(0, 12) + '...' : '-'}
                                            </TableCell>
                                            <TableCell data-label="Tanggal" className="text-xs">
                                                {item.tanggalDigitalisasi || new Date(item.createdAt).toLocaleDateString('id-ID')}
                                            </TableCell>
                                            <TableCell data-label="Aksi">
                                                <div className="flex gap-1">
                                                    <Button size="sm" variant="default"
                                                        onClick={() => { setSelectedItem(item); setVerifyDialogOpen(true); }}>
                                                        <CheckCircle className="mr-1 h-3.5 w-3.5" /> Verifikasi
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Tab: Statistik */}
            {activeTab === 'statistik' && stats && (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <Card>
                        <CardHeader><CardTitle className="text-base">Total Arsip Elektronik</CardTitle></CardHeader>
                        <CardContent><p className="text-4xl font-bold text-primary">{stats.total}</p></CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle className="text-base">Berdasarkan Format</CardTitle></CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                {(stats.byFormat || []).map(item => (
                                    <div key={item.formatFile} className="flex flex-wrap items-center justify-between gap-3">
                                        <Badge variant="outline">{item.formatFile}</Badge>
                                        <span className="text-sm font-medium">{item.count}</span>
                                    </div>
                                ))}
                                {(!stats.byFormat || stats.byFormat.length === 0) && (
                                    <p className="text-sm text-muted-foreground">Belum ada data</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle className="text-base">Status Verifikasi</CardTitle></CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                {(stats.byStatus || []).map(item => {
                                    const cfg = STATUS_CONFIG[item.statusVerifikasi] || STATUS_CONFIG.pending
                                    return (
                                        <div key={item.statusVerifikasi} className="flex flex-wrap items-center justify-between gap-3">
                                            <Badge variant={cfg.variant} className="gap-1">
                                                <cfg.icon className="h-3 w-3" /> {cfg.label}
                                            </Badge>
                                            <span className="text-sm font-medium">{item.count}</span>
                                        </div>
                                    )
                                })}
                                {(!stats.byStatus || stats.byStatus.length === 0) && (
                                    <p className="text-sm text-muted-foreground">Belum ada data</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle className="text-base">Berdasarkan Media Asal</CardTitle></CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                {(stats.byMedia || []).map(item => (
                                    <div key={item.mediaAsal} className="flex flex-wrap items-center justify-between gap-3">
                                        <span className="text-sm capitalize">{item.mediaAsal}</span>
                                        <span className="text-sm font-medium">{item.count}</span>
                                    </div>
                                ))}
                                {(!stats.byMedia || stats.byMedia.length === 0) && (
                                    <p className="text-sm text-muted-foreground">Belum ada data</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Add Dialog → extracted component */}
            <ArsipElektronikForm
                open={addDialogOpen} onOpenChange={setAddDialogOpen}
                form={newForm} setForm={setNewForm} onSubmit={handleCreate}
            />

            {/* Verify Dialog → extracted component */}
            <ArsipElektronikDetail
                open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}
                selectedItem={selectedItem} verifyNote={verifyNote}
                setVerifyNote={setVerifyNote} onVerify={handleVerify}
            />
        </div>
    )
}
