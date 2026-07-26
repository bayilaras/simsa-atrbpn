import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, AlertTriangle, FileText, Download, Archive, Clock, CheckCircle2, XCircle, Calendar, Trash2, Eye, Filter, Printer, Scale, History } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import retentionService from '@/services/retention.service'
import { format, parseISO } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

const STATUS_LABELS = {
    kadaluarsa: { label: 'Kadaluarsa', variant: 'destructive', icon: XCircle, className: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200' },
    akan_kadaluarsa: { label: 'Akan Kadaluarsa', variant: 'warning', icon: AlertTriangle, className: 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-200' },
    inaktif: { label: 'Inaktif', variant: 'secondary', icon: Clock, className: 'bg-muted text-foreground border-border' },
    akan_inaktif: { label: 'Akan Inaktif', variant: 'outline', icon: Clock, className: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200' },
    aktif: { label: 'Aktif', variant: 'default', icon: CheckCircle2, className: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200' },
}

const HASIL_AKHIR_OPTIONS = {
    'Musnah': { label: 'Musnah', color: 'bg-red-500', badgeClass: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200' },
    'Permanen': { label: 'Permanen', color: 'bg-blue-500', badgeClass: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200' },
    'Dinilai Kembali': { label: 'Dinilai Kembali', color: 'bg-yellow-500', badgeClass: 'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-200' },
}

export default function RetentionManagement() {
    const { user } = useAuth()
    const unitKerjaId = user?.unitKerjaId || 'ditjen'

    const [summary, setSummary] = useState(null)
    const [candidates, setCandidates] = useState({ data: [], summary: {}, pagination: {} })
    const [loading, setLoading] = useState(true)
    const [candidatesLoading, setCandidatesLoading] = useState(false)

    const [statusFilter, setStatusFilter] = useState('all')
    const [hasilAkhirFilter, setHasilAkhirFilter] = useState('all')
    const [page, setPage] = useState(1)

    const [selectedArchives, setSelectedArchives] = useState([])
    const [reportDialogOpen, setReportDialogOpen] = useState(false)
    const [reportData, setReportData] = useState(null)
    const [generatingReport, setGeneratingReport] = useState(false)

    // Fetch summary
    const fetchSummary = useCallback(async () => {
        try {
            const res = await retentionService.getSummary(unitKerjaId)
            setSummary(res.data)
        } catch (error) {
            console.error('Error fetching summary:', error)
        }
    }, [unitKerjaId])

    // Fetch candidates
    const fetchCandidates = useCallback(async () => {
        try {
            setCandidatesLoading(true)
            const filters = { page, limit: 20 }
            if (statusFilter !== 'all') filters.status = statusFilter
            if (hasilAkhirFilter !== 'all') filters.hasilAkhir = hasilAkhirFilter

            const res = await retentionService.getCandidates(unitKerjaId, filters)
            setCandidates(res)
        } catch (error) {
            console.error('Error fetching candidates:', error)
        } finally {
            setCandidatesLoading(false)
        }
    }, [unitKerjaId, statusFilter, hasilAkhirFilter, page])

    useEffect(() => {
        const init = async () => {
            setLoading(true)
            await Promise.all([fetchSummary(), fetchCandidates()])
            setLoading(false)
        }
        init()
    }, [fetchSummary, fetchCandidates])

    const handleSelectArchive = (id, checked) => {
        if (checked) {
            setSelectedArchives(prev => [...prev, id])
        } else {
            setSelectedArchives(prev => prev.filter(i => i !== id))
        }
    }

    const handleSelectAll = (checked) => {
        if (checked) {
            setSelectedArchives(candidates.data.map(a => a.id))
        } else {
            setSelectedArchives([])
        }
    }

    const handleGenerateReport = async () => {
        try {
            setGeneratingReport(true)
            const res = await retentionService.generateDisposalReport(
                unitKerjaId,
                selectedArchives.length > 0 ? selectedArchives : undefined
            )
            setReportData(res.data)
            setReportDialogOpen(true)
        } catch (error) {
            console.error('Error generating report:', error)
        } finally {
            setGeneratingReport(false)
        }
    }

    const handleDownloadPDF = () => {
        if (!reportData) return

        // Create printable HTML content
        const printContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Berita Acara Pemusnahan Arsip</title>
                <style>
                    body { font-family: 'Times New Roman', serif; padding: 40px; line-height: 1.6; }
                    h1 { text-align: center; font-size: 18px; margin-bottom: 5px; }
                    h2 { text-align: center; font-size: 14px; font-weight: normal; margin-bottom: 30px; }
                    .header { text-align: center; margin-bottom: 30px; }
                    .content { margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 20px; }
                    th, td { border: 1px solid #000; padding: 6px; text-align: left; }
                    th { background: #f0f0f0; }
                    .footer { margin-top: 50px; }
                    .signature { display: flex; justify-content: space-between; margin-top: 60px; }
                    .sign-box { text-align: center; width: 200px; }
                    @media print { body { padding: 20px; } }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>BERITA ACARA PEMUSNAHAN ARSIP</h1>
                    <h2>Nomor: ${reportData.reportNumber}</h2>
                </div>
                <div class="content">
                    <p>Pada hari ini, ${reportData.tanggal}, kami yang bertanda tangan di bawah ini:</p>
                    <p>Unit Kerja: ${reportData.unitKerja}</p>
                    <p>Telah melakukan penilaian dan pengusulan pemusnahan terhadap arsip yang telah melampaui masa retensinya sebagai berikut:</p>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>No</th>
                            <th>Nomor Berkas</th>
                            <th>Kode Klasifikasi</th>
                            <th>Uraian</th>
                            <th>Kurun Waktu</th>
                            <th>Jumlah</th>
                            <th>Retensi Aktif</th>
                            <th>Retensi Inaktif</th>
                            <th>Hasil Akhir</th>
                            <th>Keterangan</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${reportData.daftarArsip.map(a => `
                            <tr>
                                <td>${a.no}</td>
                                <td>${a.nomorBerkas}</td>
                                <td>${a.kodeKlasifikasi}</td>
                                <td>${a.uraian}</td>
                                <td>${a.kurunWaktu}</td>
                                <td>${a.jumlah}</td>
                                <td>${a.retensiAktif}</td>
                                <td>${a.retensiInaktif}</td>
                                <td>${a.hasilAkhir}</td>
                                <td>${a.keterangan}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <p style="margin-top: 20px;"><strong>Total Berkas: ${reportData.totalBerkas}</strong></p>
                <div class="footer">
                    <p>Demikian berita acara ini dibuat untuk dapat digunakan sebagaimana mestinya.</p>
                    <div class="signature">
                        <div class="sign-box">
                            <p>Mengetahui,</p>
                            <p>Kepala Sub Bagian Tata Usaha</p>
                            <br/><br/><br/>
                            <p>____________________</p>
                            <p>NIP.</p>
                        </div>
                        <div class="sign-box">
                            <p>${reportData.tanggal}</p>
                            <p>Arsiparis</p>
                            <br/><br/><br/>
                            <p>____________________</p>
                            <p>NIP.</p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `

        const printWindow = window.open('', '_blank')
        printWindow.document.write(printContent)
        printWindow.document.close()
        printWindow.print()
    }

    const formatDate = (dateStr) => {
        if (!dateStr) return '-'
        try {
            return format(parseISO(dateStr), 'dd MMM yyyy', { locale: idLocale })
        } catch {
            return dateStr
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh] animate-in fade-in zoom-in duration-300">
                <div className="flex flex-col items-center gap-4">
                    <div className="p-4 bg-muted/20 rounded-full">
                        <Loader2 className="h-12 w-12 animate-spin text-primary" />
                    </div>
                    <p className="text-muted-foreground animate-pulse">Memuat data retensi...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <div className="p-2 bg-orange-100 dark:bg-orange-500/15 rounded-lg">
                            <Scale className="h-6 w-6 text-orange-600" />
                        </div>
                        Manajemen Retensi Arsip (JRA)
                    </h1>
                    <p className="text-muted-foreground">
                        Monitoring masa retensi dan pengelolaan penyusutan arsip
                    </p>
                </div>

                {summary && summary.alertLevel !== 'none' && (
                    <div className={`px-4 py-2 rounded-lg border flex items-center gap-3 ${summary.alertLevel === 'high' ? 'bg-red-50 dark:bg-red-500/15 border-red-200' : 'bg-yellow-50 dark:bg-yellow-500/15 border-yellow-200'}`}>
                        <div className={`p-1.5 rounded-full ${summary.alertLevel === 'high' ? 'bg-red-100 dark:bg-red-500/15' : 'bg-yellow-100 dark:bg-yellow-500/15'}`}>
                            <AlertTriangle className={`h-4 w-4 ${summary.alertLevel === 'high' ? 'text-red-600' : 'text-yellow-600'}`} />
                        </div>
                        <div>
                            <p className={`text-sm font-semibold ${summary.alertLevel === 'high' ? 'text-red-700 dark:text-red-300' : 'text-yellow-700 dark:text-yellow-300'}`}>
                                Notifikasi Penyusutan
                            </p>
                            <p className={`text-xs ${summary.alertLevel === 'high' ? 'text-red-600' : 'text-yellow-600'}`}>
                                {summary.message}
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card className="shadow-sm border-l-4 border-l-yellow-400">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Akan Inaktif</CardTitle>
                        <Clock className="h-4 w-4 text-yellow-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-yellow-600">
                            {summary?.summary?.willBeInactive || 0}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Berkas dalam 30 hari ke depan
                        </p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-blue-500">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Sudah Inaktif</CardTitle>
                        <Archive className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-600">
                            {summary?.summary?.alreadyInactive || 0}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Berkas masa inaktif berjalan
                        </p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-orange-500">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Akan Kadaluarsa</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-600">
                            {summary?.summary?.willExpire || 0}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Berkas dalam 30 hari ke depan
                        </p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-red-500 bg-red-50/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Sudah Kadaluarsa</CardTitle>
                        <XCircle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">
                            {summary?.summary?.expired || 0}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Berkas perlu tindak lanjut !!
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Expired Breakdown */}
            {summary?.expiredByHasilAkhir && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {Object.entries(summary.expiredByHasilAkhir).map(([key, count]) => {
                        let conf = { label: key, icon: FileText, color: 'bg-muted text-foreground' };
                        if (key === 'musnah') conf = { label: 'Musnah', icon: Trash2, color: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300' };
                        if (key === 'permanen') conf = { label: 'Permanen', icon: Archive, color: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300' };
                        if (key === 'dinilaiKembali') conf = { label: 'Dinilai Kembali', icon: History, color: 'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-300' };

                        const Icon = conf.icon;

                        return (
                            <div key={key} className="flex items-center gap-3 p-3 rounded-lg border bg-card shadow-sm">
                                <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${conf.color}`}>
                                    <Icon className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-xl font-bold leading-none">{count}</p>
                                    <p className="text-xs text-muted-foreground mt-1 capitalize">{conf.label}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Candidates Table */}
            <Card className="border-border/60 shadow-sm">
                <CardHeader className="pb-4 bg-muted/20">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="text-base font-semibold">Daftar Kandidat Penyusutan</CardTitle>
                            <CardDescription className="text-xs">
                                Arsip yang status retensinya perlu perhatian atau tindakan
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={fetchCandidates}
                                className="h-8"
                            >
                                <Filter className="h-3.5 w-3.5 mr-1" /> Refresh
                            </Button>
                            <Button
                                onClick={handleGenerateReport}
                                disabled={generatingReport}
                                size="sm"
                                className="h-8 bg-indigo-600 hover:bg-indigo-700"
                            >
                                {generatingReport ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                ) : (
                                    <Printer className="h-3.5 w-3.5 mr-1.5" />
                                )}
                                Generate Berita Acara
                            </Button>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 mt-4">
                        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                            <SelectTrigger className="w-[160px] h-8 text-xs bg-background">
                                <SelectValue placeholder="Filter Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Semua Status</SelectItem>
                                <SelectItem value="kadaluarsa">Kadaluarsa</SelectItem>
                                <SelectItem value="akan_kadaluarsa">Akan Kadaluarsa</SelectItem>
                                <SelectItem value="inaktif">Inaktif</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={hasilAkhirFilter} onValueChange={(v) => { setHasilAkhirFilter(v); setPage(1); }}>
                            <SelectTrigger className="w-[160px] h-8 text-xs bg-background">
                                <SelectValue placeholder="Filter Hasil Akhir" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Semua Hasil Akhir</SelectItem>
                                <SelectItem value="Musnah">Musnah</SelectItem>
                                <SelectItem value="Permanen">Permanen</SelectItem>
                                <SelectItem value="Dinilai Kembali">Dinilai Kembali</SelectItem>
                            </SelectContent>
                        </Select>

                        {selectedArchives.length > 0 && (
                            <Badge variant="secondary" className="ml-auto h-7 px-3 bg-primary/10 text-primary border-primary/20">
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                                {selectedArchives.length} arsip dipilih
                            </Badge>
                        )}
                    </div>
                </CardHeader>

                <CardContent className="p-0">
                    {candidatesLoading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : candidates.data.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">
                            <div className="p-4 bg-muted/50 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                                <History className="h-8 w-8 opacity-20" />
                            </div>
                            <h3 className="text-lg font-medium mb-1">Tidak ada arsip</h3>
                            <p className="text-sm opacity-80">Tidak ada arsip yang sesuai filter saat ini</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead className="w-10">
                                        <Checkbox
                                            checked={selectedArchives.length === candidates.data.length && candidates.data.length > 0}
                                            onCheckedChange={handleSelectAll}
                                        />
                                    </TableHead>
                                    <TableHead className="w-[150px]">Nomor Berkas</TableHead>
                                    <TableHead className="w-[100px]">Kode</TableHead>
                                    <TableHead>Uraian</TableHead>
                                    <TableHead className="w-[150px]">Tgl Kadaluarsa</TableHead>
                                    <TableHead className="w-[120px]">Hasil Akhir</TableHead>
                                    <TableHead className="w-[200px]">Keterangan</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {candidates.data.map((arch) => (
                                    <TableRow key={arch.id} className="hover:bg-muted/30">
                                        <TableCell>
                                            <Checkbox
                                                checked={selectedArchives.includes(arch.id)}
                                                onCheckedChange={(checked) => handleSelectArchive(arch.id, checked)}
                                            />
                                        </TableCell>
                                        <TableCell className="font-medium font-mono text-xs">{arch.nomorBerkas || '-'}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="font-mono text-[10px]">{arch.kodeKlasifikasi || '-'}</Badge>
                                        </TableCell>
                                        <TableCell className="max-w-xs truncate text-sm" title={arch.uraianBerkas}>
                                            {arch.uraianBerkas || arch.uraianItem || '-'}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {formatDate(arch.tanggalKadaluarsa)}
                                        </TableCell>
                                        <TableCell>
                                            {arch.hasilAkhir ? (
                                                <Badge
                                                    variant="outline"
                                                    className={`text-[10px] shadow-none ${HASIL_AKHIR_OPTIONS[arch.hasilAkhir]?.badgeClass || 'bg-muted text-foreground'}`}
                                                >
                                                    {arch.hasilAkhir}
                                                </Badge>
                                            ) : (
                                                <span className="text-muted-foreground text-xs">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{arch.keterangan || '-'}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>

                {/* Pagination */}
                {candidates.pagination && candidates.pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/20">
                        <p className="text-xs text-muted-foreground">
                            Halaman <span className="font-medium text-foreground">{candidates.pagination.page}</span> dari <span className="font-medium text-foreground">{candidates.pagination.totalPages}</span> ({candidates.pagination.total} arsip)
                        </p>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page === 1}
                                onClick={() => setPage(p => p - 1)}
                                className="h-8 text-xs"
                            >
                                Sebelumnya
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page >= candidates.pagination.totalPages}
                                onClick={() => setPage(p => p + 1)}
                                className="h-8 text-xs"
                            >
                                Selanjutnya
                            </Button>
                        </div>
                    </div>
                )}
            </Card>

            {/* Report Preview Dialog */}
            <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
                <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
                    <DialogHeader className="p-6 pb-2 border-b bg-muted/20">
                        <DialogTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-primary" />
                            Berita Acara Pemusnahan Arsip
                        </DialogTitle>
                        <DialogDescription>
                            Preview draft berita acara sebelum dicetak
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto p-6 bg-muted/10">
                        {reportData && (
                            <div className="bg-card p-8 shadow-sm border rounded-lg min-h-[600px] max-w-[800px] mx-auto text-sm">
                                {/* Letterhead Simulation */}
                                <div className="text-center mb-8 border-b-2 border-black pb-4">
                                    <h3 className="font-bold text-lg uppercase tracking-wide mb-1">KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL</h3>
                                    <h4 className="font-bold uppercase tracking-wide">BERITA ACARA PEMUSNAHAN ARSIP</h4>
                                    <p className="text-xs mt-2">Nomor: {reportData.reportNumber}</p>
                                </div>

                                <div className="mb-6 space-y-4 leading-relaxed">
                                    <p>Pada hari ini, <strong>{reportData.tanggal}</strong>, kami yang bertanda tangan di bawah ini:</p>
                                    <div className="ml-4">
                                        <p>Unit Kerja: <span className="font-medium">{reportData.unitKerja}</span></p>
                                    </div>
                                    <p>Telah melakukan penilaian dan pengusulan pemusnahan terhadap arsip yang telah melampaui masa retensinya sebagai berikut:</p>
                                </div>

                                <div className="border rounded mb-6">
                                    <Table className="text-xs">
                                        <TableHeader>
                                            <TableRow className="bg-muted/50 hover:bg-muted/50">
                                                <TableHead className="w-10 text-black font-bold border-r">No</TableHead>
                                                <TableHead className="text-black font-bold border-r">Nomor Berkas</TableHead>
                                                <TableHead className="text-black font-bold border-r">Kode</TableHead>
                                                <TableHead className="text-black font-bold border-r">Uraian</TableHead>
                                                <TableHead className="text-black font-bold">Hasil Akhir</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {reportData.daftarArsip.map((a) => (
                                                <TableRow key={a.no} className="border-t hover:bg-transparent">
                                                    <TableCell className="border-r py-2">{a.no}</TableCell>
                                                    <TableCell className="border-r py-2">{a.nomorBerkas}</TableCell>
                                                    <TableCell className="border-r py-2">{a.kodeKlasifikasi}</TableCell>
                                                    <TableCell className="border-r py-2 max-w-xs truncate">{a.uraian}</TableCell>
                                                    <TableCell className="py-2">{a.hasilAkhir}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>

                                <p className="mb-8 font-medium">Total Berkas: {reportData.totalBerkas} berkas</p>

                                <p className="mb-12">Demikian berita acara ini dibuat untuk dapat digunakan sebagaimana mestinya.</p>

                                <div className="flex justify-between mt-12 px-8">
                                    <div className="text-center w-48">
                                        <p className="mb-16">Mengetahui,<br />Kepala Sub Bagian Tata Usaha</p>
                                        <p className="font-bold underline">____________________</p>
                                        <p className="text-xs">NIP.</p>
                                    </div>
                                    <div className="text-center w-48">
                                        <p className="mb-16">{reportData.tanggal}<br />Arsiparis</p>
                                        <p className="font-bold underline">____________________</p>
                                        <p className="text-xs">NIP.</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="p-4 border-t bg-background">
                        <Button variant="outline" onClick={() => setReportDialogOpen(false)}>
                            Batal
                        </Button>
                        <Button onClick={handleDownloadPDF} className="bg-indigo-600 hover:bg-indigo-700">
                            <Download className="h-4 w-4 mr-2" />
                            Cetak PDF
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
