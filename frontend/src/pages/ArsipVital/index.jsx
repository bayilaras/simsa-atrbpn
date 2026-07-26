import { useState, useEffect, useCallback, useRef } from 'react'
import { format } from 'date-fns'
import { useAuth } from '@/context/AuthContext'
import { arsipVitalService } from '@/services/arsip-vital.service'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import {
    ShieldAlert, Plus, AlertTriangle,
    Shield, ShieldCheck, ShieldX, Printer, FileText, CheckCircle2
} from 'lucide-react'
import { KATEGORI_CONFIG, KEKRITISAN_CONFIG, STATUS_PROTEKSI_CONFIG } from './constants'
import ArsipVitalTable from './ArsipVitalTable'
import ArsipVitalForm from './ArsipVitalForm'
import ArsipVitalDetail from './ArsipVitalDetail'

const SEARCH_DEBOUNCE_MS = 300

// Built per call so the dates follow the browser's local day, not UTC, and never go stale.
const makeInitialForm = () => {
    const today = new Date()
    const nextReview = new Date(today)
    nextReview.setFullYear(nextReview.getFullYear() + 1)

    return {
        arsipId: '',
        kategoriVital: '',
        tingkatKekritisan: '',
        alasanPenetapan: '',
        metodeProteksi: '',
        lokasiBackup: '',
        mediaBackup: '',
        jadwalBackup: '',
        penanggungJawab: '',
        tanggalPenetapan: format(today, 'yyyy-MM-dd'),
        tanggalReviewSelanjutnya: format(nextReview, 'yyyy-MM-dd'),
        statusProteksi: 'belum_diproteksi'
    }
}

export default function ArsipVital() {
    const { user } = useAuth()
    const { toast } = useToast()
    const unitKerjaId = user?.unitKerjaId

    // State
    const [activeTab, setActiveTab] = useState('daftar')
    const [data, setData] = useState([])
    const [loading, setLoading] = useState(false)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [stats, setStats] = useState(null)
    const [dueReview, setDueReview] = useState([])

    // Filters
    const [search, setSearch] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [filterKategori, setFilterKategori] = useState('')
    const [filterStatus, setFilterStatus] = useState('')

    // Dialogs
    const [showCreateDialog, setShowCreateDialog] = useState(false)
    const [showDetailDialog, setShowDetailDialog] = useState(false)
    const [isEditing, setIsEditing] = useState(false)

    // Form
    const [selectedItem, setSelectedItem] = useState(null)
    const [form, setForm] = useState(makeInitialForm)

    // Only the newest list request may write to the table
    const loadSeq = useRef(0)

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [search])

    // Load Data
    const loadData = useCallback(async () => {
        if (!unitKerjaId) return
        const seq = ++loadSeq.current
        setLoading(true)
        try {
            const res = await arsipVitalService.findAll({
                unitKerjaId, page, limit: 10, search: debouncedSearch,
                kategoriVital: filterKategori, statusProteksi: filterStatus
            })
            if (seq !== loadSeq.current) return
            if (res.success) {
                setData(res.data)
                setTotalPages(res.pagination.totalPages)
            }
        } catch (err) {
            if (seq !== loadSeq.current) return
            console.error(err)
            toast({ title: 'Gagal memuat data', description: err.message, variant: 'destructive' })
        } finally {
            if (seq === loadSeq.current) setLoading(false)
        }
    }, [unitKerjaId, page, debouncedSearch, filterKategori, filterStatus])

    const loadStats = useCallback(async () => {
        if (!unitKerjaId) return
        try {
            const resStats = await arsipVitalService.getStats(unitKerjaId)
            setStats(resStats.data)
            const resDue = await arsipVitalService.getDueForReview(unitKerjaId)
            // getDueForReview already unwraps the { success, data } envelope; never store undefined
            // here because the tab badge and table read dueReview.length during render.
            setDueReview(Array.isArray(resDue) ? resDue : resDue?.data ?? [])
        } catch (err) {
            console.error(err)
        }
    }, [unitKerjaId])

    useEffect(() => { loadData(); loadStats() }, [loadData, loadStats])

    // Handlers
    const resetForm = () => setForm(makeInitialForm())

    const handleCreate = async () => {
        if (!form.arsipId || !form.kategoriVital || !form.tingkatKekritisan) {
            toast({ title: 'Validasi Gagal', description: 'Mohon lengkapi arsip, kategori, dan tingkat kekritisan', variant: 'destructive' })
            return
        }
        try {
            await arsipVitalService.create({ ...form, unitKerjaId })
            toast({ title: 'Berhasil', description: 'Arsip vital berhasil ditetapkan' })
            setShowCreateDialog(false)
            loadData(); loadStats()
        } catch (err) {
            toast({ title: 'Gagal', description: err.message, variant: 'destructive' })
        }
    }

    const handleUpdate = async () => {
        try {
            await arsipVitalService.update(selectedItem.id, form)
            toast({ title: 'Berhasil', description: 'Data berhasil diperbarui' })
            setShowDetailDialog(false); setIsEditing(false); loadData()
        } catch (err) {
            toast({ title: 'Gagal', description: err.message, variant: 'destructive' })
        }
    }

    const handleDelete = async (id) => {
        if (!confirm('Apakah Anda yakin ingin menghapus penetapan arsip vital ini?')) return
        try {
            await arsipVitalService.delete(id)
            toast({ title: 'Berhasil', description: 'Penetapan dihapus' })
            loadData(); loadStats()
        } catch (err) {
            toast({ title: 'Gagal', description: err.message, variant: 'destructive' })
        }
    }

    const openDetail = (item) => {
        setSelectedItem(item)
        setForm({
            arsipId: item.arsipId, kategoriVital: item.kategoriVital,
            tingkatKekritisan: item.tingkatKekritisan, alasanPenetapan: item.alasanPenetapan,
            metodeProteksi: item.metodeProteksi, lokasiBackup: item.lokasiBackup,
            mediaBackup: item.mediaBackup, jadwalBackup: item.jadwalBackup,
            penanggungJawab: item.penanggungJawab,
            tanggalPenetapan: item.tanggalPenetapan?.split('T')[0],
            tanggalReviewSelanjutnya: item.tanggalReviewSelanjutnya?.split('T')[0],
            statusProteksi: item.statusProteksi
        })
        setIsEditing(false)
        setShowDetailDialog(true)
    }

    const handlePrint = async () => {
        try {
            const blob = await arsipVitalService.printDaftar()
            const url = window.URL.createObjectURL(new Blob([blob]))
            const link = document.createElement('a')
            link.href = url
            link.setAttribute('download', `daftar-arsip-vital-${unitKerjaId}.pdf`)
            document.body.appendChild(link)
            link.click()
            link.parentNode.removeChild(link)
        } catch (err) {
            toast({ title: 'Error', description: 'Gagal mencetak daftar arsip vital', variant: 'destructive' })
        }
    }

    const getStatValue = (arr, key) => {
        if (!arr) return 0
        const item = arr.find(x => x.status === key || x.kategori === key || x.kekritisan === key)
        return item ? parseInt(item.count) : 0
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-100 rounded-lg">
                        <ShieldAlert className="h-6 w-6 text-red-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Arsip Vital</h1>
                        <p className="text-sm text-muted-foreground">
                            Pengelolaan arsip yang esensial bagi kelangsungan organisasi (Permen ATR/BPN 2/2026)
                        </p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={handlePrint} className="gap-2">
                        <Printer className="h-4 w-4" /> Cetak Daftar
                    </Button>
                    <Button onClick={() => { resetForm(); setShowCreateDialog(true) }} className="gap-2 bg-red-600 hover:bg-red-700">
                        <Plus className="h-4 w-4" /> Tetapkan Arsip Vital
                    </Button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Total Arsip Vital</p>
                            <p className="text-3xl font-bold mt-2">{stats?.total || 0}</p>
                        </div>
                        <div className="p-3 bg-blue-100 rounded-full"><Shield className="h-6 w-6 text-blue-600" /></div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Terlindungi</p>
                            <p className="text-3xl font-bold mt-2 text-emerald-600">{getStatValue(stats?.byStatus, 'terlindungi')}</p>
                        </div>
                        <div className="p-3 bg-emerald-100 rounded-full"><ShieldCheck className="h-6 w-6 text-emerald-600" /></div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Perlu Review</p>
                            <p className="text-3xl font-bold mt-2 text-amber-600">{getStatValue(stats?.byStatus, 'perlu_review')}</p>
                        </div>
                        <div className="p-3 bg-amber-100 rounded-full"><AlertTriangle className="h-6 w-6 text-amber-600" /></div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Belum Diproteksi</p>
                            <p className="text-3xl font-bold mt-2 text-red-600">{getStatValue(stats?.byStatus, 'belum_diproteksi')}</p>
                        </div>
                        <div className="p-3 bg-red-100 rounded-full"><ShieldX className="h-6 w-6 text-red-600" /></div>
                    </CardContent>
                </Card>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList className="bg-muted/50 p-1">
                    <TabsTrigger value="daftar" className="gap-2">
                        <FileText className="h-4 w-4" /> Daftar Arsip Vital
                    </TabsTrigger>
                    <TabsTrigger value="monitoring" className="gap-2">
                        <AlertTriangle className="h-4 w-4" /> Monitoring Proteksi
                        {dueReview.length > 0 && (
                            <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px]">
                                {dueReview.length}
                            </Badge>
                        )}
                    </TabsTrigger>
                </TabsList>

                {/* Daftar Tab → extracted component */}
                <TabsContent value="daftar">
                    <ArsipVitalTable
                        data={data} loading={loading} page={page} totalPages={totalPages}
                        search={search} filterKategori={filterKategori} filterStatus={filterStatus}
                        onSearchChange={v => { setSearch(v); setPage(1) }}
                        onFilterKategoriChange={v => { setFilterKategori(v); setPage(1) }}
                        onFilterStatusChange={v => { setFilterStatus(v); setPage(1) }}
                        onPageChange={setPage}
                        onRefresh={() => { loadData(); loadStats() }}
                        onOpenDetail={openDetail}
                        onDelete={handleDelete}
                    />
                </TabsContent>

                {/* Monitoring Tab */}
                <TabsContent value="monitoring" className="space-y-4">
                    <Card className="border-l-4 border-l-amber-500">
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2 text-amber-700">
                                <AlertTriangle className="h-5 w-5" />
                                Perlu Review / Tindakan ({dueReview.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {dueReview.length === 0 ? (
                                <div className="text-center py-8">
                                    <div className="p-3 bg-emerald-100 rounded-full w-fit mx-auto mb-3">
                                        <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                                    </div>
                                    <p className="font-medium text-emerald-700">Semua Terkendali!</p>
                                    <p className="text-muted-foreground text-sm">Tidak ada arsip vital yang memerlukan review saat ini.</p>
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Nomor Berkas</TableHead>
                                            <TableHead>Uraian</TableHead>
                                            <TableHead>Kekritisan</TableHead>
                                            <TableHead>Tgl. Review</TableHead>
                                            <TableHead>Penanggung Jawab</TableHead>
                                            <TableHead>Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {dueReview.map(item => {
                                            const kek = KEKRITISAN_CONFIG[item.tingkatKekritisan] || {}
                                            const sp = STATUS_PROTEKSI_CONFIG[item.statusProteksi] || {}
                                            return (
                                                <TableRow key={item.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetail(item)}>
                                                    <TableCell className="font-medium">{item.nomorBerkas || '-'}</TableCell>
                                                    <TableCell>{item.uraianBerkas || '-'}</TableCell>
                                                    <TableCell><Badge variant="outline" className={kek.color}>{kek.label}</Badge></TableCell>
                                                    <TableCell className="text-red-600 font-medium">{item.tanggalReviewSelanjutnya ? new Date(item.tanggalReviewSelanjutnya).toLocaleDateString('id-ID') : '-'}</TableCell>
                                                    <TableCell>{item.penanggungJawab || '-'}</TableCell>
                                                    <TableCell><Badge variant="outline" className={sp.color}>{sp.label}</Badge></TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>

                    {/* Stats Breakdown */}
                    {stats?.byKategori?.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <Card>
                                <CardHeader><CardTitle className="text-base">Breakdown Per Kategori</CardTitle></CardHeader>
                                <CardContent className="space-y-4">
                                    {Object.entries(KATEGORI_CONFIG).map(([k, v]) => {
                                        const count = getStatValue(stats?.byKategori, k)
                                        if (count === 0) return null
                                        return (
                                            <div key={k} className="flex justify-between items-center p-2 rounded-md hover:bg-muted/50 border">
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-3 h-3 rounded-full ${v.color.split(' ')[0].replace('text-', 'bg-')}`}></div>
                                                    <span className="text-sm font-medium">{v.label}</span>
                                                </div>
                                                <Badge variant="secondary">{count}</Badge>
                                            </div>
                                        )
                                    })}
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle className="text-base">Breakdown Kekritisan</CardTitle></CardHeader>
                                <CardContent className="space-y-4">
                                    {Object.entries(KEKRITISAN_CONFIG).map(([k, v]) => {
                                        const count = getStatValue(stats?.byKekritisan, k)
                                        return (
                                            <div key={k} className="flex justify-between items-center p-2 rounded-md hover:bg-muted/50 border">
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-3 h-3 rounded-full ${v.color.split(' ')[0].replace('text-', 'bg-')}`}></div>
                                                    <span className="text-sm font-medium">{v.label}</span>
                                                </div>
                                                <Badge variant="secondary">{count}</Badge>
                                            </div>
                                        )
                                    })}
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* Create Dialog → extracted component */}
            <ArsipVitalForm
                open={showCreateDialog}
                onOpenChange={setShowCreateDialog}
                form={form}
                setForm={setForm}
                onSubmit={handleCreate}
                unitKerjaId={unitKerjaId}
            />

            {/* Detail/Edit Dialog → extracted component */}
            <ArsipVitalDetail
                open={showDetailDialog}
                onOpenChange={setShowDetailDialog}
                selectedItem={selectedItem}
                isEditing={isEditing}
                setIsEditing={setIsEditing}
                form={form}
                setForm={setForm}
                onUpdate={handleUpdate}
            />
        </div>
    )
}
