import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { reportService } from '@/services/report.service';
import { PageHeader } from '@/components/PageHeader';
import { FileSpreadsheet, FileText, Download, BarChart3, Mail, Send, Archive, BookOpen, TrendingUp, FileImage, Film, FileAudio, Loader2 } from 'lucide-react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    LineChart,
    Line,
} from 'recharts';

export default function Laporan() {
    const { user } = useAuth();
    const { toast } = useToast();
    const unitKerjaId = user?.unitKerjaId || 'ditjen';

    const [activeTab, setActiveTab] = useState('summary');
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);

    // Filters
    const [year, setYear] = useState(new Date().getFullYear());
    const [tanggalDari, setTanggalDari] = useState('');
    const [tanggalSampai, setTanggalSampai] = useState('');
    const [arsipType, setArsipType] = useState('all');
    const [mediaType, setMediaType] = useState('all');
    const [lendingStatus, setLendingStatus] = useState('all');

    // Data states
    const [summaryData, setSummaryData] = useState(null);
    const [suratMasukData, setSuratMasukData] = useState(null);
    const [suratKeluarData, setSuratKeluarData] = useState(null);
    const [arsipData, setArsipData] = useState(null);
    const [lendingData, setLendingData] = useState(null);

    // Years for dropdown
    const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

    // Load data based on active tab
    useEffect(() => {
        loadData();
    }, [activeTab, year, unitKerjaId, arsipType, mediaType, lendingStatus]);

    const loadData = async () => {
        setLoading(true);
        try {
            switch (activeTab) {
                case 'summary':
                    const summary = await reportService.getSummaryReport(unitKerjaId, year);
                    setSummaryData(summary);
                    break;
                case 'surat-masuk':
                    const masuk = await reportService.getSuratMasukReport({
                        unitKerjaId,
                        year,
                        tanggalDari: tanggalDari || undefined,
                        tanggalSampai: tanggalSampai || undefined,
                    });
                    setSuratMasukData(masuk);
                    break;
                case 'surat-keluar':
                    const keluar = await reportService.getSuratKeluarReport({
                        unitKerjaId,
                        year,
                        tanggalDari: tanggalDari || undefined,
                        tanggalSampai: tanggalSampai || undefined,
                    });
                    setSuratKeluarData(keluar);
                    break;
                case 'arsip':
                    const arsip = await reportService.getArsipReport({
                        unitKerjaId,
                        year,
                        type: arsipType,
                        mediaType,
                    });
                    setArsipData(arsip);
                    break;
                case 'peminjaman':
                    const lending = await reportService.getLendingReport({
                        status: lendingStatus,
                        tanggalDari: tanggalDari || undefined,
                        tanggalSampai: tanggalSampai || undefined,
                    });
                    setLendingData(lending);
                    break;
            }
        } catch (error) {
            console.error('Error loading report:', error);
            toast({
                title: 'Error',
                description: 'Gagal memuat data laporan',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleExport = async (type, format) => {
        setExporting(true);
        try {
            await reportService.exportReport(type, format, {
                unitKerjaId,
                year,
                tanggalDari,
                tanggalSampai,
                arsipType,
                mediaType,
            });
            toast({
                title: 'Berhasil',
                description: `Laporan berhasil diexport ke ${format.toUpperCase()}`,
            });
        } catch (error) {
            console.error('Export error:', error);
            toast({
                title: 'Error',
                description: 'Gagal mengexport laporan',
                variant: 'destructive',
            });
        } finally {
            setExporting(false);
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    };

    const getStatusBadge = (status) => {
        const variants = {
            belum_dibalas: 'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-800 dark:text-yellow-300',
            sudah_dibalas: 'bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300',
            borrowed: 'bg-orange-100 dark:bg-orange-500/15 text-orange-800 dark:text-orange-300',
            returned: 'bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300',
            overdue: 'bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300',
        };
        const statusLabels = {
            belum_dibalas: 'Belum Diproses',
            sudah_dibalas: 'Sudah Dibalas',
            borrowed: 'Dipinjam',
            returned: 'Dikembalikan',
            overdue: 'Terlambat',
        };
        return (
            <Badge className={variants[status] || 'bg-muted text-foreground'}>
                {statusLabels[status] || status?.replace('_', ' ')}
            </Badge>
        );
    };

    return (
        <div className="space-y-6">
            <PageHeader
                icon={BarChart3}
                title="Laporan & Statistik"
                description="Analisis kinerja dan statistik pengelolaan surat dan arsip"
            />

            {/* Filters */}
            <Card className="border-border/60 shadow-sm hover:shadow-md transition-all duration-200">
                <CardContent className="pt-6">
                    <div className="flex flex-wrap gap-4 items-end">
                        <div className="space-y-2">
                            <Label className="text-foreground font-medium">Tahun</Label>
                            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                                <SelectTrigger className="w-full sm:w-[120px] bg-card border-border focus:ring-ring/20">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {years.map((y) => (
                                        <SelectItem key={y} value={String(y)}>
                                            {y}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-foreground font-medium">Dari Tanggal</Label>
                            <Input
                                type="date"
                                value={tanggalDari}
                                onChange={(e) => setTanggalDari(e.target.value)}
                                className="w-[160px] bg-card border-border focus:ring-ring/20"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-foreground font-medium">Sampai Tanggal</Label>
                            <Input
                                type="date"
                                value={tanggalSampai}
                                onChange={(e) => setTanggalSampai(e.target.value)}
                                className="w-[160px] bg-card border-border focus:ring-ring/20"
                            />
                        </div>
                        <Button
                            onClick={loadData}
                            disabled={loading}
                            className="bg-primary hover:bg-primary text-white shadow-sm transition-all"
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Tampilkan Data'}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                <TabsList className="bg-card/50 backdrop-blur-sm border border-border/60 p-1 h-auto rounded-xl shadow-sm grid w-full grid-cols-2 md:grid-cols-5 gap-1">
                    <TabsTrigger value="summary" className="data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-lg py-2.5 transition-all duration-200">
                        <BarChart3 className="h-4 w-4 mr-2" />
                        <span className="hidden sm:inline">Ringkasan</span>
                    </TabsTrigger>
                    <TabsTrigger value="surat-masuk" className="data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-lg py-2.5 transition-all duration-200">
                        <Mail className="h-4 w-4 mr-2" />
                        <span className="hidden sm:inline">Surat Masuk</span>
                    </TabsTrigger>
                    <TabsTrigger value="surat-keluar" className="data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-lg py-2.5 transition-all duration-200">
                        <Send className="h-4 w-4 mr-2" />
                        <span className="hidden sm:inline">Surat Keluar</span>
                    </TabsTrigger>
                    <TabsTrigger value="arsip" className="data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-lg py-2.5 transition-all duration-200">
                        <Archive className="h-4 w-4 mr-2" />
                        <span className="hidden sm:inline">Arsip</span>
                    </TabsTrigger>
                    <TabsTrigger value="peminjaman" className="data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-lg py-2.5 transition-all duration-200">
                        <BookOpen className="h-4 w-4 mr-2" />
                        <span className="hidden sm:inline">Peminjaman</span>
                    </TabsTrigger>
                </TabsList>

                {/* Summary Tab */}
                <TabsContent value="summary" className="space-y-6">
                    {loading ? (
                        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                            {[...Array(4)].map((_, i) => (
                                <Skeleton key={i} className="h-32 rounded-xl" />
                            ))}
                        </div>
                    ) : summaryData ? (
                        <>
                            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                                <Card className="border-border/60 shadow-sm hover:shadow-md transition-all duration-200 group">
                                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                        <CardTitle className="text-sm font-medium text-muted-foreground">Surat Masuk</CardTitle>
                                        <div className="p-2 bg-blue-50 dark:bg-blue-500/15 rounded-lg group-hover:bg-blue-100 dark:group-hover:bg-blue-500/15 transition-colors">
                                            <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-foreground">{summaryData.suratMasuk?.total || 0}</div>
                                        <p className="text-xs text-muted-foreground mt-1 font-medium">
                                            <span className="text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/15 px-1.5 py-0.5 rounded-md">
                                                {summaryData.suratMasuk?.belumDibalas || 0} belum diproses
                                            </span>
                                        </p>
                                    </CardContent>
                                </Card>
                                <Card className="border-border/60 shadow-sm hover:shadow-md transition-all duration-200 group">
                                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                        <CardTitle className="text-sm font-medium text-muted-foreground">Surat Keluar</CardTitle>
                                        <div className="p-2 bg-emerald-50 dark:bg-emerald-500/15 rounded-lg group-hover:bg-emerald-100 dark:group-hover:bg-emerald-500/15 transition-colors">
                                            <Send className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-foreground">{summaryData.suratKeluar?.total || 0}</div>
                                        <p className="text-xs text-muted-foreground mt-1 font-medium">
                                            <span className="text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/15 px-1.5 py-0.5 rounded-md">
                                                {summaryData.suratKeluar?.diarsipkan || 0} diarsipkan
                                            </span>
                                        </p>
                                    </CardContent>
                                </Card>
                                <Card className="border-border/60 shadow-sm hover:shadow-md transition-all duration-200 group">
                                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                        <CardTitle className="text-sm font-medium text-muted-foreground">Arsip</CardTitle>
                                        <div className="p-2 bg-purple-50 dark:bg-purple-500/15 rounded-lg group-hover:bg-purple-100 dark:group-hover:bg-purple-500/15 transition-colors">
                                            <Archive className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-foreground">{summaryData.arsip?.total || 0}</div>
                                        <p className="text-xs text-muted-foreground mt-1 font-medium">
                                            <span className="text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/15 px-1.5 py-0.5 rounded-md">
                                                {summaryData.arsip?.permanen || 0} permanen
                                            </span>
                                        </p>
                                    </CardContent>
                                </Card>
                                <Card className="border-border/60 shadow-sm hover:shadow-md transition-all duration-200 group">
                                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                        <CardTitle className="text-sm font-medium text-muted-foreground">Peminjaman</CardTitle>
                                        <div className="p-2 bg-orange-50 dark:bg-orange-500/15 rounded-lg group-hover:bg-orange-100 dark:group-hover:bg-orange-500/15 transition-colors">
                                            <BookOpen className="h-4 w-4 text-orange-600" />
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-foreground">{summaryData.peminjaman?.total || 0}</div>
                                        <p className="text-xs text-muted-foreground mt-1 font-medium">
                                            <span className="text-orange-600 bg-orange-50 dark:bg-orange-500/15 px-1.5 py-0.5 rounded-md">
                                                {summaryData.peminjaman?.borrowed || 0} aktif dipinjam
                                            </span>
                                        </p>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Monthly Trend Chart */}
                            <Card className="border-border/60 shadow-sm hover:shadow-md transition-all duration-200">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2 text-lg text-foreground">
                                        <div className="p-2 bg-blue-100/50 rounded-lg">
                                            <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                        </div>
                                        Tren Bulanan {year}
                                    </CardTitle>
                                    <CardDescription>Perbandingan intensitas surat masuk dan keluar per bulan</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-[300px] w-full mt-4">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={summaryData.monthlyTrend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                                <XAxis
                                                    dataKey="month"
                                                    axisLine={false}
                                                    tickLine={false}
                                                    tick={{ fill: '#64748b', fontSize: 12 }}
                                                    dy={10}
                                                />
                                                <YAxis
                                                    axisLine={false}
                                                    tickLine={false}
                                                    tick={{ fill: '#64748b', fontSize: 12 }}
                                                />
                                                <Tooltip
                                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                    cursor={{ fill: '#f1f5f9' }}
                                                />
                                                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                                <Bar dataKey="masuk" fill="#3b82f6" name="Surat Masuk" radius={[4, 4, 0, 0]} maxBarSize={50} />
                                                <Bar dataKey="keluar" fill="#10b981" name="Surat Keluar" radius={[4, 4, 0, 0]} maxBarSize={50} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </CardContent>
                            </Card>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-border rounded-xl bg-muted/50">
                            <BarChart3 className="h-12 w-12 text-slate-300 mb-3" />
                            <h3 className="text-lg font-medium text-foreground">Tidak ada data</h3>
                            <p className="text-muted-foreground max-w-sm mt-1">Belum ada data statistik yang tersedia untuk periode yang dipilih.</p>
                        </div>
                    )}
                </TabsContent>

                {/* Surat Masuk Tab */}
                <TabsContent value="surat-masuk" className="space-y-4">
                    <div className="flex justify-between items-center bg-card p-4 rounded-xl shadow-sm border border-border/60">
                        <div className="flex items-center gap-2">
                            <div className="h-8 w-1 bg-blue-500 rounded-full"></div>
                            <div className="text-sm font-medium text-foreground">
                                Total: <span className="font-bold text-foreground">{suratMasukData?.pagination?.total || 0}</span> surat
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleExport('surat-masuk', 'excel')}
                                disabled={exporting}
                                className="border-border hover:bg-emerald-50 dark:hover:bg-emerald-500/15 hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-200 transition-colors"
                            >
                                <FileSpreadsheet className="h-4 w-4 mr-2" />
                                Excel
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleExport('surat-masuk', 'pdf')}
                                disabled={exporting}
                                className="border-border hover:bg-rose-50 dark:hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-200 transition-colors"
                            >
                                <FileText className="h-4 w-4 mr-2" />
                                PDF
                            </Button>
                        </div>
                    </div>
                    <Card className="border-border/60 shadow-sm overflow-hidden">
                        <Table responsive>
                            <TableHeader className="bg-muted/50">
                                <TableRow className="hover:bg-muted/50">
                                    <TableHead className="w-[60px] text-foreground font-semibold">No</TableHead>
                                    <TableHead className="text-foreground font-semibold">Nomor Surat</TableHead>
                                    <TableHead className="text-foreground font-semibold">Tanggal</TableHead>
                                    <TableHead className="text-foreground font-semibold">Dari</TableHead>
                                    <TableHead className="text-foreground font-semibold">Perihal</TableHead>
                                    <TableHead className="text-foreground font-semibold">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    [...Array(5)].map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell colSpan={6}>
                                                <Skeleton className="h-8 w-full rounded-md" />
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : suratMasukData?.data?.length ? (
                                    suratMasukData.data.map((item, index) => (
                                        <TableRow key={item.id} className="hover:bg-muted/80 transition-colors">
                                            <TableCell data-label="No" className="font-medium text-muted-foreground">{index + 1}</TableCell>
                                            <TableCell data-label="Nomor Surat" className="font-medium">{item.nomorSurat || '-'}</TableCell>
                                            <TableCell data-label="Tanggal">{formatDate(item.tanggalSurat)}</TableCell>
                                            <TableCell data-label="Dari">{item.dari || '-'}</TableCell>
                                            <TableCell data-label="Perihal" className="max-w-xs truncate text-muted-foreground" title={item.perihal}>{item.perihal || '-'}</TableCell>
                                            <TableCell data-label="Status">{getStatusBadge(item.status)}</TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-32 text-center">
                                            <div className="flex flex-col items-center justify-center text-muted-foreground">
                                                <Mail className="h-8 w-8 mb-2 opacity-50" />
                                                <p>Tidak ada data surat masuk</p>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </Card>
                </TabsContent>

                {/* Surat Keluar Tab */}
                <TabsContent value="surat-keluar" className="space-y-4">
                    <div className="flex justify-between items-center bg-card p-4 rounded-xl shadow-sm border border-border/60">
                        <div className="flex items-center gap-2">
                            <div className="h-8 w-1 bg-emerald-500 rounded-full"></div>
                            <div className="text-sm font-medium text-foreground">
                                Total: <span className="font-bold text-foreground">{suratKeluarData?.pagination?.total || 0}</span> surat
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleExport('surat-keluar', 'excel')}
                                disabled={exporting}
                                className="border-border hover:bg-emerald-50 dark:hover:bg-emerald-500/15 hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-200 transition-colors"
                            >
                                <FileSpreadsheet className="h-4 w-4 mr-2" />
                                Excel
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleExport('surat-keluar', 'pdf')}
                                disabled={exporting}
                                className="border-border hover:bg-rose-50 dark:hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-200 transition-colors"
                            >
                                <FileText className="h-4 w-4 mr-2" />
                                PDF
                            </Button>
                        </div>
                    </div>
                    <Card className="border-border/60 shadow-sm overflow-hidden">
                        <Table responsive>
                            <TableHeader className="bg-muted/50">
                                <TableRow className="hover:bg-muted/50">
                                    <TableHead className="w-[60px] text-foreground font-semibold">No</TableHead>
                                    <TableHead className="text-foreground font-semibold">Nomor Surat</TableHead>
                                    <TableHead className="text-foreground font-semibold">Tanggal</TableHead>
                                    <TableHead className="text-foreground font-semibold">Kepada</TableHead>
                                    <TableHead className="text-foreground font-semibold">Perihal</TableHead>
                                    <TableHead className="text-foreground font-semibold">Jenis</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    [...Array(5)].map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell colSpan={6}>
                                                <Skeleton className="h-8 w-full rounded-md" />
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : suratKeluarData?.data?.length ? (
                                    suratKeluarData.data.map((item, index) => (
                                        <TableRow key={item.id} className="hover:bg-muted/80 transition-colors">
                                            <TableCell data-label="No" className="font-medium text-muted-foreground">{index + 1}</TableCell>
                                            <TableCell data-label="Nomor Surat" className="font-medium">{item.nomorSurat || '-'}</TableCell>
                                            <TableCell data-label="Tanggal">{formatDate(item.tanggalSurat)}</TableCell>
                                            <TableCell data-label="Kepada">{item.kepada || '-'}</TableCell>
                                            <TableCell data-label="Perihal" className="max-w-xs truncate text-muted-foreground" title={item.perihal}>{item.perihal || '-'}</TableCell>
                                            <TableCell data-label="Jenis">
                                                <Badge variant="outline" className="font-normal">{item.naskahDinas || '-'}</Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-32 text-center">
                                            <div className="flex flex-col items-center justify-center text-muted-foreground">
                                                <Send className="h-8 w-8 mb-2 opacity-50" />
                                                <p>Tidak ada data surat keluar</p>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </Card>
                </TabsContent>

                {/* Arsip Tab */}
                <TabsContent value="arsip" className="space-y-4">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-4 rounded-xl shadow-sm border border-border/60">
                        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center w-full md:w-auto">
                            <div className="flex items-center gap-2">
                                <div className="h-8 w-1 bg-purple-500 rounded-full"></div>
                                <div className="text-sm font-medium text-foreground whitespace-nowrap">
                                    Total: <span className="font-bold text-foreground">{arsipData?.pagination?.total || 0}</span> arsip
                                </div>
                            </div>
                            <div className="flex gap-2 w-full sm:w-auto">
                                <Select value={arsipType} onValueChange={setArsipType}>
                                    <SelectTrigger className="w-full sm:w-[150px] bg-muted/50 border-border">
                                        <SelectValue placeholder="Filter" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Semua</SelectItem>
                                        <SelectItem value="expiring">Akan Kadaluarsa</SelectItem>
                                        <SelectItem value="permanent">Permanen</SelectItem>
                                        <SelectItem value="destroyed">Musnah</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Select value={mediaType} onValueChange={setMediaType}>
                                    <SelectTrigger className="w-full sm:w-[150px] bg-muted/50 border-border">
                                        <SelectValue placeholder="Media" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Semua Media</SelectItem>
                                        <SelectItem value="kertas">Kertas</SelectItem>
                                        <SelectItem value="foto">Foto</SelectItem>
                                        <SelectItem value="video">Video</SelectItem>
                                        <SelectItem value="audio">Audio</SelectItem>
                                        <SelectItem value="elektronik">Elektronik</SelectItem>
                                        <SelectItem value="lainnya">Lainnya</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="flex gap-2 w-full md:w-auto">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleExport('arsip', 'excel')}
                                disabled={exporting}
                                className="flex-1 md:flex-none border-border hover:bg-emerald-50 dark:hover:bg-emerald-500/15 hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-200 transition-colors"
                            >
                                <FileSpreadsheet className="h-4 w-4 mr-2" />
                                Excel
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleExport('arsip', 'pdf')}
                                disabled={exporting}
                                className="flex-1 md:flex-none border-border hover:bg-rose-50 dark:hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-200 transition-colors"
                            >
                                <FileText className="h-4 w-4 mr-2" />
                                PDF
                            </Button>
                        </div>
                    </div>

                    {arsipData?.stats?.byMediaType && (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-4">
                            {arsipData.stats.byMediaType.map((stat, index) => (
                                <Card key={index} className="border-border/60 shadow-sm hover:shadow-md transition-all duration-200">
                                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                        <CardTitle className="text-sm font-medium capitalize text-muted-foreground">
                                            {stat.mediaType || 'Kertas'}
                                        </CardTitle>
                                        <div className="p-1.5 bg-muted rounded-md">
                                            {stat.mediaType === 'foto' ? <FileImage className="h-4 w-4 text-muted-foreground" /> :
                                                stat.mediaType === 'video' ? <Film className="h-4 w-4 text-muted-foreground" /> :
                                                    stat.mediaType === 'audio' ? <FileAudio className="h-4 w-4 text-muted-foreground" /> :
                                                        <FileText className="h-4 w-4 text-muted-foreground" />}
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold text-foreground">{stat.count}</div>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Arsip {stat.mediaType || 'Kertas'}
                                        </p>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}

                    <Card className="border-border/60 shadow-sm overflow-hidden">
                        <Table responsive>
                            <TableHeader className="bg-muted/50">
                                <TableRow className="hover:bg-muted/50">
                                    <TableHead className="w-[60px] text-foreground font-semibold">No</TableHead>
                                    <TableHead className="text-foreground font-semibold">Kode Klasifikasi</TableHead>
                                    <TableHead className="text-foreground font-semibold">Jenis</TableHead>
                                    <TableHead className="text-foreground font-semibold">Media</TableHead>
                                    <TableHead className="text-foreground font-semibold">Nomor Berkas</TableHead>
                                    <TableHead className="text-foreground font-semibold">Uraian</TableHead>
                                    <TableHead className="text-foreground font-semibold">Kadaluarsa</TableHead>
                                    <TableHead className="text-foreground font-semibold">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    [...Array(5)].map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell colSpan={8}>
                                                <Skeleton className="h-8 w-full rounded-md" />
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : arsipData?.data?.length ? (
                                    arsipData.data.map((item, index) => (
                                        <TableRow key={item.id} className="hover:bg-muted/80 transition-colors">
                                            <TableCell data-label="No" className="font-medium text-muted-foreground">{index + 1}</TableCell>
                                            <TableCell data-label="Kode Klasifikasi" className="font-medium bg-muted/50 px-2 py-1 rounded inline-block text-xs mt-2">{item.kodeKlasifikasi || '-'}</TableCell>
                                            <TableCell data-label="Jenis">
                                                <Badge variant={item.jenisArsip === 'masuk' ? 'default' : 'secondary'} className="font-normal">
                                                    {item.jenisArsip}
                                                </Badge>
                                            </TableCell>
                                            <TableCell data-label="Media">
                                                <div className="flex items-center gap-1.5 text-muted-foreground text-sm capitalize">
                                                    {item.mediaType === 'foto' ? <FileImage className="h-3 w-3" /> :
                                                        item.mediaType === 'video' ? <Film className="h-3 w-3" /> :
                                                            item.mediaType === 'audio' ? <FileAudio className="h-3 w-3" /> :
                                                                <FileText className="h-3 w-3" />}
                                                    {item.mediaType || 'kertas'}
                                                </div>
                                            </TableCell>
                                            <TableCell data-label="Nomor Berkas">{item.nomorBerkas || '-'}</TableCell>
                                            <TableCell data-label="Uraian" className="max-w-xs truncate text-muted-foreground" title={item.uraianBerkas || '-'}>{item.uraianBerkas || '-'}</TableCell>
                                            <TableCell data-label="Kadaluarsa">{formatDate(item.tanggalKadaluarsa)}</TableCell>
                                            <TableCell data-label="Status">
                                                <Badge variant="outline" className="font-normal border-border text-muted-foreground">{item.hasilAkhir || item.retensiInaktif || '-'}</Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={8} className="h-32 text-center">
                                            <div className="flex flex-col items-center justify-center text-muted-foreground">
                                                <Archive className="h-8 w-8 mb-2 opacity-50" />
                                                <p>Tidak ada data arsip</p>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </Card>
                </TabsContent>

                {/* Peminjaman Tab */}
                <TabsContent value="peminjaman" className="space-y-4">
                    <div className="flex justify-between items-center bg-card p-4 rounded-xl shadow-sm border border-border/60">
                        <div className="flex items-center gap-2">
                            <div className="h-8 w-1 bg-orange-500 rounded-full"></div>
                            <div className="text-sm font-medium text-foreground">
                                Total: <span className="font-bold text-foreground">{lendingData?.pagination?.total || 0}</span> peminjaman
                            </div>
                        </div>
                        <div className="flex gap-4 items-center">
                            <Select value={lendingStatus} onValueChange={setLendingStatus}>
                                <SelectTrigger className="w-full sm:w-[150px] bg-muted/50 border-border">
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Semua</SelectItem>
                                    <SelectItem value="borrowed">Dipinjam</SelectItem>
                                    <SelectItem value="returned">Dikembalikan</SelectItem>
                                    <SelectItem value="overdue">Terlambat</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <Card className="border-border/60 shadow-sm overflow-hidden">
                        <Table responsive>
                            <TableHeader className="bg-muted/50">
                                <TableRow className="hover:bg-muted/50">
                                    <TableHead className="w-[60px] text-foreground font-semibold">No</TableHead>
                                    <TableHead className="text-foreground font-semibold">Peminjam</TableHead>
                                    <TableHead className="text-foreground font-semibold">Unit</TableHead>
                                    <TableHead className="text-foreground font-semibold">Tgl Pinjam</TableHead>
                                    <TableHead className="text-foreground font-semibold">Jatuh Tempo</TableHead>
                                    <TableHead className="text-foreground font-semibold">Tgl Kembali</TableHead>
                                    <TableHead className="text-foreground font-semibold">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    [...Array(5)].map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell colSpan={7}>
                                                <Skeleton className="h-8 w-full rounded-md" />
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : lendingData?.data?.length ? (
                                    lendingData.data.map((item, index) => (
                                        <TableRow key={item.id} className="hover:bg-muted/80 transition-colors">
                                            <TableCell data-label="No" className="font-medium text-muted-foreground">{index + 1}</TableCell>
                                            <TableCell data-label="Peminjam" className="font-medium">{item.borrowerName}</TableCell>
                                            <TableCell data-label="Unit">{item.departmentUnit || '-'}</TableCell>
                                            <TableCell data-label="Tgl Pinjam">{formatDate(item.borrowDate)}</TableCell>
                                            <TableCell data-label="Jatuh Tempo">{formatDate(item.dueDate)}</TableCell>
                                            <TableCell data-label="Tgl Kembali">{formatDate(item.returnDate)}</TableCell>
                                            <TableCell data-label="Status">{getStatusBadge(item.status)}</TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-32 text-center">
                                            <div className="flex flex-col items-center justify-center text-muted-foreground">
                                                <BookOpen className="h-8 w-8 mb-2 opacity-50" />
                                                <p>Tidak ada data peminjaman</p>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
