import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
import { arsipTerjagaService } from '@/services/arsip-terjaga.service'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import {
    Lock, Plus, FileCheck, FileClock, FileWarning, FileText, Send, Printer, Globe
} from 'lucide-react'
import { KATEGORI_CONFIG, STATUS_PELAPORAN_CONFIG, STATUS_KEPATUHAN_CONFIG } from './constants'
import ArsipTerjagaTable from './ArsipTerjagaTable'
import ArsipTerjagaForm from './ArsipTerjagaForm'
import ArsipTerjagaDetail from './ArsipTerjagaDetail'
import { useRequiredUnitKerjaScope } from '@/hooks/use-required-unit-kerja-scope'
import { RequiredUnitKerjaScope } from '@/components/RequiredUnitKerjaScope'

const INITIAL_FORM = {
    arsipId: '',
    kategoriTerjaga: '',
    dasarHukum: '',
    uraianIsi: '',
    tanggalPenetapan: new Date().toISOString().split('T')[0],
    tanggalReviewSelanjutnya: '',
    periodePelaporanHari: 365,
    catatan: ''
}

export default function ArsipTerjaga() {
    const { user } = useAuth()
    const { toast } = useToast()
    const unitScope = useRequiredUnitKerjaScope(user)
    const unitKerjaId = unitScope.unitKerjaId

    // State
    const [activeTab, setActiveTab] = useState('daftar')
    const [data, setData] = useState([])
    const [loading, setLoading] = useState(false)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [stats, setStats] = useState(null)
    const [dueReporting, setDueReporting] = useState([])

    // Filters
    const [search, setSearch] = useState('')
    const [filterKategori, setFilterKategori] = useState('')
    const [filterPelaporan, setFilterPelaporan] = useState('')

    // Dialogs
    const [showCreateDialog, setShowCreateDialog] = useState(false)
    const [showDetailDialog, setShowDetailDialog] = useState(false)
    const [showReportDialog, setShowReportDialog] = useState(false)
    const [isEditing, setIsEditing] = useState(false)

    // Forms
    const [selectedItem, setSelectedItem] = useState(null)
    const [form, setForm] = useState(INITIAL_FORM)
    const [reportForm, setReportForm] = useState({
        nomorLaporan: '',
        tanggalPelaporan: new Date().toISOString().split('T')[0]
    })

    // Load Data
    const loadData = useCallback(async () => {
        if (!unitKerjaId) return
        setLoading(true)
        try {
            const res = await arsipTerjagaService.findAll({
                unitKerjaId, page, limit: 10, search,
                kategoriTerjaga: filterKategori, statusPelaporan: filterPelaporan
            })
            if (res.success) { setData(res.data); setTotalPages(res.pagination.totalPages) }
        } catch (err) {
            console.error(err)
            toast({ title: 'Gagal memuat data', description: err.message, variant: 'destructive' })
        } finally { setLoading(false) }
    }, [unitKerjaId, page, search, filterKategori, filterPelaporan, toast])

    const loadStats = useCallback(async () => {
        if (!unitKerjaId) return
        try {
            const resStats = await arsipTerjagaService.getStats(unitKerjaId)
            setStats(resStats.data)
            const resDue = await arsipTerjagaService.getDueForReporting(unitKerjaId)
            setDueReporting(resDue.data)
        } catch (err) { console.error(err) }
    }, [unitKerjaId])

    useEffect(() => { loadData(); loadStats() }, [loadData, loadStats])

    // Handlers
    const resetForm = () => setForm({ ...INITIAL_FORM, tanggalReviewSelanjutnya: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0] })

    const handleCreate = async () => {
        if (!form.arsipId || !form.kategoriTerjaga) {
            toast({ title: 'Validasi Gagal', description: 'Mohon lengkapi arsip dan kategori', variant: 'destructive' })
            return
        }
        try {
            await arsipTerjagaService.create({ ...form, unitKerjaId })
            toast({ title: 'Berhasil', description: 'Arsip terjaga berhasil ditetapkan' })
            setShowCreateDialog(false); loadData(); loadStats()
        } catch (err) { toast({ title: 'Gagal', description: err.message, variant: 'destructive' }) }
    }

    const handleUpdate = async () => {
        try {
            await arsipTerjagaService.update(selectedItem.id, form)
            toast({ title: 'Berhasil', description: 'Data berhasil diperbarui' })
            setShowDetailDialog(false); setIsEditing(false); loadData()
        } catch (err) { toast({ title: 'Gagal', description: err.message, variant: 'destructive' }) }
    }

    const handleDelete = async (id) => {
        if (!confirm('Apakah Anda yakin ingin menghapus penetapan arsip terjaga ini?')) return
        try {
            await arsipTerjagaService.delete(id)
            toast({ title: 'Berhasil', description: 'Penetapan dihapus' })
            loadData(); loadStats()
        } catch (err) { toast({ title: 'Gagal', description: err.message, variant: 'destructive' }) }
    }

    const handleReport = async () => {
        if (!reportForm.nomorLaporan) {
            toast({ title: 'Validasi', description: 'Nomor laporan wajib diisi', variant: 'destructive' })
            return
        }
        try {
            await arsipTerjagaService.markAsReported(selectedItem.id, reportForm.nomorLaporan, reportForm.tanggalPelaporan)
            toast({ title: 'Berhasil', description: 'Status berhasil diubah menjadi dilaporkan' })
            setShowReportDialog(false); loadData(); loadStats()
        } catch (err) { toast({ title: 'Gagal', description: err.message, variant: 'destructive' }) }
    }

    const openDetail = (item) => {
        setSelectedItem(item)
        setForm({
            arsipId: item.arsipId, kategoriTerjaga: item.kategoriTerjaga,
            dasarHukum: item.dasarHukum, uraianIsi: item.uraianIsi,
            tanggalPenetapan: item.tanggalPenetapan?.split('T')[0],
            tanggalReviewSelanjutnya: item.tanggalReviewSelanjutnya?.split('T')[0],
            periodePelaporanHari: item.periodePelaporanHari, catatan: item.catatan
        })
        setIsEditing(false); setShowDetailDialog(true)
    }

    const openReport = (item) => {
        setSelectedItem(item)
        setReportForm({ nomorLaporan: '', tanggalPelaporan: new Date().toISOString().split('T')[0] })
        setShowReportDialog(true)
    }

    const handlePrint = async () => {
        try {
            if (!unitKerjaId) {
                toast({ title: 'Unit kerja wajib dipilih', variant: 'destructive' })
                return
            }
            const blob = await arsipTerjagaService.printDaftar(unitKerjaId)
            const url = window.URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.setAttribute('download', `daftar-arsip-terjaga-${unitKerjaId}.pdf`)
            document.body.appendChild(link); link.click(); link.parentNode.removeChild(link)
            window.URL.revokeObjectURL(url)
        } catch { toast({ title: 'Error', description: 'Gagal mencetak daftar arsip terjaga', variant: 'destructive' }) }
    }

    const getStatValue = (arr, key) => {
        if (!arr) return 0
        const item = arr.find(x => x.status === key || x.kategori === key)
        return item ? parseInt(item.count) : 0
    }

    return (
        <div className="space-y-6">
            <RequiredUnitKerjaScope scope={unitScope} disabled={loading} />
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 dark:bg-purple-500/15 rounded-lg"><Lock className="h-6 w-6 text-purple-600 dark:text-purple-400" /></div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Arsip Terjaga</h1>
                        <p className="text-sm text-muted-foreground">
                            Pengelolaan arsip negara yang wajib dilaporkan ke ANRI (Permen ATR/BPN 2/2026)
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={handlePrint} disabled={!unitKerjaId} className="gap-2">
                        <Printer className="h-4 w-4" /> Cetak Daftar
                    </Button>
                    <Button disabled={!unitKerjaId} onClick={() => { resetForm(); setShowCreateDialog(true) }} className="gap-2 bg-purple-600 hover:bg-purple-700">
                        <Plus className="h-4 w-4" /> Tetapkan Arsip Terjaga
                    </Button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Total Arsip Terjaga</p>
                            <p className="text-3xl font-bold mt-2">{stats?.total || 0}</p>
                        </div>
                        <div className="p-3 bg-purple-100 dark:bg-purple-500/15 rounded-full"><FileText className="h-6 w-6 text-purple-600 dark:text-purple-400" /></div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Sudah Dilaporkan</p>
                            <p className="text-3xl font-bold mt-2 text-emerald-600">
                                {(getStatValue(stats?.byPelaporan, 'dilaporkan') + getStatValue(stats?.byPelaporan, 'terverifikasi'))}
                            </p>
                        </div>
                        <div className="p-3 bg-emerald-100 dark:bg-emerald-500/15 rounded-full"><FileCheck className="h-6 w-6 text-emerald-600" /></div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Belum Dilaporkan</p>
                            <p className="text-3xl font-bold mt-2 text-red-600">{getStatValue(stats?.byPelaporan, 'belum_dilaporkan')}</p>
                        </div>
                        <div className="p-3 bg-red-100 dark:bg-red-500/15 rounded-full"><FileWarning className="h-6 w-6 text-red-600" /></div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Jadwal Lapor</p>
                            <div className="flex items-center gap-2 mt-2">
                                <span className="text-3xl font-bold">{dueReporting.length}</span>
                                <span className="text-xs text-muted-foreground">perlu segera</span>
                            </div>
                        </div>
                        <div className="p-3 bg-amber-100 dark:bg-amber-500/15 rounded-full"><FileClock className="h-6 w-6 text-amber-600 dark:text-amber-400" /></div>
                    </CardContent>
                </Card>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList className="bg-muted/50 p-1">
                    <TabsTrigger value="daftar" className="gap-2">
                        <Globe className="h-4 w-4" /> Daftar Arsip Terjaga
                    </TabsTrigger>
                    <TabsTrigger value="pelaporan" className="gap-2">
                        <Send className="h-4 w-4" /> Pelaporan ANRI
                        {dueReporting.length > 0 && (
                            <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px]">
                                {dueReporting.length}
                            </Badge>
                        )}
                    </TabsTrigger>
                </TabsList>

                {/* Daftar Tab → extracted component */}
                <TabsContent value="daftar">
                    <ArsipTerjagaTable
                        data={data} loading={loading} page={page} totalPages={totalPages}
                        search={search} filterKategori={filterKategori} filterPelaporan={filterPelaporan}
                        onSearchChange={v => { setSearch(v); setPage(1) }}
                        onFilterKategoriChange={v => { setFilterKategori(v); setPage(1) }}
                        onFilterPelaporanChange={v => { setFilterPelaporan(v); setPage(1) }}
                        onPageChange={setPage}
                        onRefresh={() => { loadData(); loadStats() }}
                        onOpenDetail={openDetail}
                        onOpenReport={openReport}
                        onDelete={handleDelete}
                    />
                </TabsContent>

                {/* Pelaporan ANRI Tab */}
                <TabsContent value="pelaporan" className="space-y-4">
                    <Card className="border-l-4 border-l-red-500">
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2 text-red-700 dark:text-red-300">
                                <FileWarning className="h-5 w-5" />
                                Arsip Terjaga Belum Dilaporkan ({dueReporting.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {dueReporting.length === 0 ? (
                                <div className="text-center py-8">
                                    <div className="p-3 bg-emerald-100 dark:bg-emerald-500/15 rounded-full w-fit mx-auto mb-3">
                                        <FileCheck className="h-6 w-6 text-emerald-600" />
                                    </div>
                                    <p className="font-medium text-emerald-700 dark:text-emerald-300">Semua Terkendali!</p>
                                    <p className="text-muted-foreground text-sm">Semua arsip terjaga sudah dilaporkan ke ANRI sesuai jadwal.</p>
                                </div>
                            ) : (
                                <Table responsive>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Nomor Berkas</TableHead>
                                            <TableHead>Uraian</TableHead>
                                            <TableHead>Kategori</TableHead>
                                            <TableHead>Tgl. Penetapan</TableHead>
                                            <TableHead>Status Kepatuhan</TableHead>
                                            <TableHead className="w-[120px]">Aksi</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {dueReporting.map(item => {
                                            const kat = KATEGORI_CONFIG[item.kategoriTerjaga] || {}
                                            const sk = STATUS_KEPATUHAN_CONFIG[item.statusKepatuhan] || {}
                                            return (
                                                <TableRow key={item.id}>
                                                    <TableCell data-label="Nomor Berkas" className="font-medium">{item.nomorBerkas || '-'}</TableCell>
                                                    <TableCell data-label="Uraian">{item.uraianBerkas || '-'}</TableCell>
                                                    <TableCell data-label="Kategori"><Badge variant="outline" className={kat.color}>{kat.label}</Badge></TableCell>
                                                    <TableCell data-label="Tgl. Penetapan">{item.tanggalPenetapan ? new Date(item.tanggalPenetapan).toLocaleDateString('id-ID') : '-'}</TableCell>
                                                    <TableCell data-label="Status Kepatuhan"><Badge variant="outline" className={sk.color}>{sk.label}</Badge></TableCell>
                                                    <TableCell data-label="Aksi">
                                                        <Button size="sm" onClick={() => openReport(item)} className="w-full gap-2">
                                                            <Send className="h-3.5 w-3.5" /> Laporkan
                                                        </Button>
                                                    </TableCell>
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
                                <CardHeader><CardTitle className="text-base">Breakdown Kepatuhan</CardTitle></CardHeader>
                                <CardContent className="space-y-4">
                                    {Object.entries(STATUS_PELAPORAN_CONFIG).map(([k, v]) => {
                                        const count = getStatValue(stats?.byPelaporan, k)
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
            <ArsipTerjagaForm
                open={showCreateDialog} onOpenChange={setShowCreateDialog}
                form={form} setForm={setForm} onSubmit={handleCreate} unitKerjaId={unitKerjaId}
            />

            {/* Detail/Edit Dialog → extracted component */}
            <ArsipTerjagaDetail
                open={showDetailDialog} onOpenChange={setShowDetailDialog}
                selectedItem={selectedItem} isEditing={isEditing} setIsEditing={setIsEditing}
                form={form} setForm={setForm} onUpdate={handleUpdate} onOpenReport={openReport}
            />

            {/* Report to ANRI Dialog (kept inline - small) */}
            <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Lapor ke ANRI</DialogTitle>
                        <DialogDescription>
                            Pastikan Anda telah melaporkan arsip ini ke ANRI dan mendapatkan nomor tanda terima.
                        </DialogDescription>
                    </DialogHeader>
                    {selectedItem && (
                        <div className="space-y-4">
                            <div className="p-3 bg-muted rounded-md text-sm">
                                <span className="font-semibold">{selectedItem.nomorBerkas}</span> - {selectedItem.uraianBerkas}
                            </div>
                            <div className="space-y-2">
                                <Label>Nomor Laporan/Tanda Terima ANRI *</Label>
                                <Input
                                    value={reportForm.nomorLaporan}
                                    onChange={e => setReportForm(f => ({ ...f, nomorLaporan: e.target.value }))}
                                    placeholder="Contoh: LAP-ANRI/2026/001"
                                    autoFocus
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Tanggal Pelaporan *</Label>
                                <Input type="date"
                                    value={reportForm.tanggalPelaporan}
                                    onChange={e => setReportForm(f => ({ ...f, tanggalPelaporan: e.target.value }))}
                                />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowReportDialog(false)}>Batal</Button>
                        <Button onClick={handleReport} className="bg-primary hover:bg-primary">
                            <Send className="h-4 w-4 mr-2" /> Konfirmasi Pelaporan
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
