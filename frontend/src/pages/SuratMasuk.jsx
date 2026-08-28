import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { MailOpen, Plus, Search, Eye, Edit, Archive, Filter, ChevronDown, ChevronUp, X, Reply, FolderArchive, ArrowUpDown, Send, RefreshCw, Trash2, FileText, AlertCircle, Inbox, Calendar, MoreHorizontal, CheckCircle2, Building2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ExportButton } from '@/components/ExportButton';
import ImportFromGDrive from '@/components/ImportFromGDrive';
import { ArchiveDialog } from '@/components/ArchiveDialog';
import { DistributeDialog } from '@/components/DistributeDialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
    Pagination,
    PaginationContent,
    PaginationItem,
} from "@/components/ui/pagination";
import { TableSkeleton } from '@/components/skeletons';
import suratMasukService from '@/services/surat-masuk.service';
import settingsService from '@/services/settings.service';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { PageHeader } from '@/components/PageHeader'

// Generate year options
const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 10 }, (_, i) => currentYear - i);

export default function SuratMasuk() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { user, canWrite } = useAuth();
    const isAdmin = canWrite();
    const isSuperAdmin = user?.role === 'super_admin';

    // Data state
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
    const [stats, setStats] = useState({ total: 0, belumDibalas: 0, sudahDibalas: 0, diarsipkan: 0 });

    // Unit kerja filter for super admin
    const [unitKerjaList, setUnitKerjaList] = useState([]);
    const [selectedUnitKerja, setSelectedUnitKerja] = useState(isSuperAdmin ? 'all' : (user?.unitKerjaId || undefined));

    // Filter states
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const [tahun, setTahun] = useState('all');
    const [jenisSurat, setJenisSurat] = useState('all');
    const [status, setStatus] = useState('all');
    const [sifatSurat, setSifatSurat] = useState('all');
    const [disposisiKe, setDisposisiKe] = useState('all');
    const [tanggalDari, setTanggalDari] = useState(null);
    const [tanggalSampai, setTanggalSampai] = useState(null);

    // Dialog states
    const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
    const [distributeDialogOpen, setDistributeDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [selectedSurat, setSelectedSurat] = useState(null);

    // Load unit kerja list for super admin
    useEffect(() => {
        if (isSuperAdmin) {
            settingsService.getAllUnitKerja().then(result => {
                setUnitKerjaList(result.data || result || []);
            }).catch(err => console.error('Failed to load unit kerja list:', err));
        }
    }, [isSuperAdmin]);

    // Resolve effective unitKerjaId
    const resolvedUnitKerjaId = isSuperAdmin
        ? (selectedUnitKerja === 'all' ? undefined : selectedUnitKerja)
        : (user?.unitKerjaId || undefined);

    // Guards against out-of-order responses overwriting newer results
    const fetchSeqRef = useRef(0);

    // Fetch data from API
    const fetchData = useCallback(async () => {
        const seq = ++fetchSeqRef.current;
        setLoading(true);
        try {
            const params = {
                page: pagination.page,
                limit: pagination.limit,
                search: debouncedSearchTerm || undefined,
                unitKerjaId: resolvedUnitKerjaId,
                tahun: tahun !== 'all' ? tahun : undefined,
                jenisSurat: jenisSurat !== 'all' ? jenisSurat : undefined,
                status: status !== 'all' ? status : undefined,
                sifatSurat: sifatSurat !== 'all' ? sifatSurat : undefined,
                disposisi: disposisiKe !== 'all' ? disposisiKe : undefined,
                tanggalDari: tanggalDari ? format(tanggalDari, 'yyyy-MM-dd') : undefined,
                tanggalSampai: tanggalSampai ? format(tanggalSampai, 'yyyy-MM-dd') : undefined,
            };

            const response = await suratMasukService.getAll(params);
            if (seq !== fetchSeqRef.current) return;
            if (response.success) {
                setData(response.data || []);
                setPagination(prev => ({
                    ...prev,
                    total: response.pagination?.total || 0,
                    totalPages: response.pagination?.totalPages || 1,
                }));
            }
        } catch (error) {
            if (seq !== fetchSeqRef.current) return;
            console.error('Error fetching surat masuk:', error);
            toast({
                title: 'Error',
                description: 'Gagal memuat data surat masuk',
                variant: 'destructive',
            });
        } finally {
            if (seq === fetchSeqRef.current) setLoading(false);
        }
    }, [pagination.page, pagination.limit, debouncedSearchTerm, resolvedUnitKerjaId, tahun, jenisSurat, status, sifatSurat, disposisiKe, tanggalDari, tanggalSampai, toast]);

    // Fetch stats from API
    const fetchStats = useCallback(async () => {
        try {
            const result = await suratMasukService.getStats({ unitKerjaId: resolvedUnitKerjaId });
            if (result) {
                setStats(result);
            }
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    }, [resolvedUnitKerjaId]);

    useEffect(() => {
        fetchData();
        fetchStats();
    }, [fetchData, fetchStats]);

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
            setPagination(prev => ({ ...prev, page: 1 }));
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const hasActiveFilters = tahun !== 'all' || jenisSurat !== 'all' || status !== 'all' ||
        sifatSurat !== 'all' || disposisiKe !== 'all' || tanggalDari || tanggalSampai || searchTerm;

    // Applying a filter must restart from the first page
    const applyFilter = (setter) => (value) => {
        setter(value);
        setPagination(prev => ({ ...prev, page: 1 }));
    };

    const clearAllFilters = () => {
        setSearchTerm('');
        setTahun('all');
        setJenisSurat('all');
        setStatus('all');
        setSifatSurat('all');
        setDisposisiKe('all');
        setTanggalDari(null);
        setTanggalSampai(null);
        setPagination(prev => ({ ...prev, page: 1 }));
    };

    // Action handlers
    const handleViewDetail = (surat) => navigate(`/surat/masuk/${surat.id}`);
    const handleEdit = (surat) => navigate(`/surat/masuk/edit/${surat.id}`);

    const handleOpenArchiveDialog = (surat) => {
        setSelectedSurat({
            id: surat.id,
            nomorSurat: surat.nomorSurat,
            perihal: surat.perihal,
            tanggalSurat: surat.tanggalSurat,
        });
        setArchiveDialogOpen(true);
    };

    const handleOpenDistributeDialog = (surat) => {
        setSelectedSurat({
            id: surat.id,
            nomorSurat: surat.nomorSurat,
            perihal: surat.perihal,
        });
        setDistributeDialogOpen(true);
    };

    const handleOpenDeleteDialog = (surat) => {
        setSelectedSurat(surat);
        setDeleteDialogOpen(true);
    };

    const handleArchive = async (metadata) => {
        try {
            await suratMasukService.archive(selectedSurat.id, metadata);
            toast({
                title: 'Berhasil Diarsipkan',
                description: `Surat ${selectedSurat.nomorSurat} telah diarsipkan`,
            });
            fetchData();
        } catch (error) {
            toast({
                title: 'Error',
                description: error.message || 'Gagal mengarsipkan surat',
                variant: 'destructive',
            });
        }
    };

    const handleDelete = async () => {
        try {
            await suratMasukService.delete(selectedSurat.id);
            toast({
                title: 'Berhasil Dihapus',
                description: `Surat ${selectedSurat.nomorSurat} telah dihapus`,
            });
            setDeleteDialogOpen(false);
            fetchData();
        } catch (error) {
            toast({
                title: 'Error',
                description: error.message || 'Gagal menghapus surat',
                variant: 'destructive',
            });
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        try {
            return format(new Date(dateString), 'dd MMM yyyy', { locale: localeId });
        } catch {
            return dateString;
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <PageHeader
                icon={MailOpen}
                title="Surat Masuk"
                description="Kelola dan pantau surat masuk unit kerja Anda"
                actions={<>
                {/* Unit Kerja Selector for Super Admin */}
                {isSuperAdmin && unitKerjaList.length > 0 && (
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <Select value={selectedUnitKerja} onValueChange={(val) => { setSelectedUnitKerja(val); setPagination(prev => ({ ...prev, page: 1 })); }}>
                            <SelectTrigger className="h-9 w-full sm:w-[220px]">
                                <SelectValue placeholder="Pilih Unit Kerja" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Semua Unit Kerja</SelectItem>
                                {unitKerjaList.map(uk => (
                                    <SelectItem key={uk.id} value={uk.id}>{uk.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" onClick={fetchData} disabled={loading} size="sm" className="h-9">
                        <RefreshCw className={`h-3.5 w-3.5 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>

                    {isAdmin && (
                        <ImportFromGDrive
                            type="surat-masuk"
                            onImportComplete={fetchData}
                        />
                    )}

                    <ExportButton
                        type="surat-masuk"
                        filters={{
                            tahun: tahun !== 'all' ? tahun : undefined,
                            jenisSurat: jenisSurat !== 'all' ? jenisSurat : undefined,
                            status: status !== 'all' ? status : undefined,
                            sifatSurat: sifatSurat !== 'all' ? sifatSurat : undefined,
                            disposisi: disposisiKe !== 'all' ? disposisiKe : undefined,
                            tanggalDari: tanggalDari ? format(tanggalDari, 'yyyy-MM-dd') : undefined,
                            tanggalSampai: tanggalSampai ? format(tanggalSampai, 'yyyy-MM-dd') : undefined,
                        }}
                    />

                    {isAdmin && (
                        <Button asChild size="sm" className="h-9">
                            <Link to="/surat/masuk/tambah">
                                <Plus className="mr-2 h-3.5 w-3.5" />
                                Surat Baru
                            </Link>
                        </Button>
                    )}
                </div>
                </>}
            />

            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                <Card className="shadow-sm border-l-4 border-l-primary card-hover">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total Surat</p>
                            <p className="text-2xl font-bold">{stats.total}</p>
                        </div>
                        <div className="p-2.5 bg-primary/10 rounded-full text-primary">
                            <MailOpen className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-orange-500 card-hover">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Perlu Tindakan</p>
                            <p className="text-2xl font-bold text-orange-600">{stats.belumDibalas}</p>
                        </div>
                        <div className="p-2.5 bg-orange-100 dark:bg-orange-500/15 rounded-full text-orange-600">
                            <AlertCircle className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-green-500 card-hover">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Sudah Dibalas</p>
                            <p className="text-2xl font-bold text-green-600">{stats.sudahDibalas}</p>
                        </div>
                        <div className="p-2.5 bg-green-100 dark:bg-green-500/15 rounded-full text-green-600">
                            <CheckCircle2 className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-blue-500 card-hover">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Diarsipkan</p>
                            <p className="text-2xl font-bold text-blue-600">{stats.diarsipkan}</p>
                        </div>
                        <div className="p-2.5 bg-blue-100 dark:bg-blue-500/15 rounded-full text-blue-600">
                            <FolderArchive className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Main Content Area */}
            <Card className="shadow-sm border-border/60">
                <CardHeader className="pb-4">
                    <div className="flex flex-col space-y-4">
                        {/* Search & Filter Controls */}
                        <div className="flex flex-col md:flex-row gap-3">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    placeholder="Cari nomor surat, perihal, atau pengirim..."
                                    className="pl-9 bg-background/50 border-input/60 focus:bg-background transition-colors"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen} className="flex-none">
                                <CollapsibleTrigger asChild>
                                    <Button variant="outline" className={`gap-2 w-full md:w-auto ${isAdvancedOpen ? 'bg-muted' : ''}`}>
                                        <Filter className="h-4 w-4" />
                                        <span className="sr-only sm:not-sr-only">Filter</span>
                                        {hasActiveFilters && (
                                            <Badge variant="secondary" className="ml-0.5 h-5 w-5 p-0 justify-center bg-primary/10 text-primary">
                                                !
                                            </Badge>
                                        )}
                                        {isAdvancedOpen ? <ChevronUp className="h-3 w-3 opacity-50" /> : <ChevronDown className="h-3 w-3 opacity-50" />}
                                    </Button>
                                </CollapsibleTrigger>
                            </Collapsible>
                            {hasActiveFilters && (
                                <Button variant="ghost" size="icon" onClick={clearAllFilters} className="text-muted-foreground hover:text-destructive shrink-0" aria-label="Hapus semua filter" title="Hapus semua filter">
                                    <X className="h-4 w-4" />
                                </Button>
                            )}
                        </div>

                        {/* Advanced Filters Panel */}
                        <Collapsible open={isAdvancedOpen}>
                            <CollapsibleContent className="pt-2">
                                <div className="bg-muted/30 p-4 rounded-lg border border-border/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {/* Tahun */}
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold text-muted-foreground uppercase">Tahun</label>
                                        <Select value={tahun} onValueChange={applyFilter(setTahun)}>
                                            <SelectTrigger className="h-9 bg-background">
                                                <SelectValue placeholder="Semua Tahun" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">Semua Tahun</SelectItem>
                                                {yearOptions.map(year => (
                                                    <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* Jenis Surat */}
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold text-muted-foreground uppercase">Jenis Surat</label>
                                        <SearchableSelect
                                            options={[
                                                { value: 'all', label: 'Semua Jenis' },
                                                'Keputusan', 'Surat Tugas', 'Surat Perintah', 'Nota Dinas', 'Memorandum',
                                                'Surat Dinas', 'Surat Undangan', 'Surat Perjanjian/MoU', 'Surat Kuasa',
                                                'Berita Acara', 'Surat Keterangan', 'Surat Pengantar', 'Pemberitahuan',
                                                'Pengumuman', 'Laporan', 'Telaahan Staf', 'Piagam', 'Umum',
                                                'Naskah Dinas Arahan', 'Naskah Dinas Korespondensi', 'Naskah Dinas Khusus',
                                                'Peraturan', 'Pedoman', 'Petunjuk Pelaksanaan', 'Instruksi',
                                                'Surat Edaran', 'Pengaduan'
                                            ]}
                                            value={jenisSurat}
                                            onValueChange={applyFilter(setJenisSurat)}
                                            placeholder="Pilih Jenis"
                                            searchPlaceholder=" Cari..."
                                            className="h-9"
                                        />
                                    </div>

                                    {/* Status */}
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold text-muted-foreground uppercase">Status</label>
                                        <Select value={status} onValueChange={applyFilter(setStatus)}>
                                            <SelectTrigger className="h-9 bg-background">
                                                <SelectValue placeholder="Semua Status" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">Semua Status</SelectItem>
                                                <SelectItem value="belum_dibalas">Belum Diproses</SelectItem>
                                                <SelectItem value="sudah_dibalas">Sudah Dibalas</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* Sifat Surat */}
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold text-muted-foreground uppercase">Sifat Surat</label>
                                        <Select value={sifatSurat} onValueChange={applyFilter(setSifatSurat)}>
                                            <SelectTrigger className="h-9 bg-background">
                                                <SelectValue placeholder="Semua Sifat" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">Semua Sifat</SelectItem>
                                                <SelectItem value="biasa">Biasa</SelectItem>
                                                <SelectItem value="segera">Segera</SelectItem>
                                                <SelectItem value="sangat_segera">Sangat Segera</SelectItem>
                                                <SelectItem value="rahasia">Rahasia</SelectItem>
                                                <SelectItem value="undangan">Undangan</SelectItem>
                                                <SelectItem value="penting">Penting</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* Filter Tanggal */}
                                    <div className="space-y-1.5 sm:col-span-2">
                                        <label className="text-xs font-semibold text-muted-foreground uppercase">Rentang Tanggal</label>
                                        <div className="flex items-center gap-2">
                                            <DatePicker
                                                date={tanggalDari}
                                                onDateChange={applyFilter(setTanggalDari)}
                                                placeholder="Dari tanggal"
                                                className="h-9 bg-background flex-1"
                                            />
                                            <span className="text-muted-foreground">-</span>
                                            <DatePicker
                                                date={tanggalSampai}
                                                onDateChange={applyFilter(setTanggalSampai)}
                                                placeholder="Sampai tanggal"
                                                className="h-9 bg-background flex-1"
                                            />
                                        </div>
                                    </div>

                                    {/* Disposisi Ke */}
                                    <div className="space-y-1.5 sm:col-span-2">
                                        <label className="text-xs font-semibold text-muted-foreground uppercase">Disposisi Ke</label>
                                        <SearchableSelect
                                            options={[
                                                { value: 'all', label: 'Semua Disposisi' },
                                                'Ditjen', 'SekDitjen', 'Dit. BPPT', 'Dit. PTEP',
                                                'Dit. KTPP', 'Kabag Program dan Hukum',
                                                'Kabag Kepegawaian Keuangan dan Umum'
                                            ]}
                                            value={disposisiKe}
                                            onValueChange={applyFilter(setDisposisiKe)}
                                            placeholder="Pilih Disposisi"
                                            searchPlaceholder=" Cari disposisi..."
                                            className="h-9"
                                        />
                                    </div>
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    </div>
                </CardHeader>

                <CardContent className="p-0">
                    <div className="border-t border-border/60">
                        {loading ? (
                            <div className="p-4">
                                <TableSkeleton columns={7} rows={5} />
                            </div>
                        ) : (
                            <Table responsive>
                                <TableHeader className="bg-muted/30">
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="w-[50px] text-center">No.</TableHead>
                                        <TableHead className="w-[120px]">Tanggal</TableHead>
                                        <TableHead className="w-[160px]">Nomor Surat</TableHead>
                                        <TableHead>Perihal & Pengirim</TableHead>
                                        <TableHead className="w-[180px]">Status</TableHead>
                                        <TableHead className="w-[100px] text-right">Aksi</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-16 text-muted-foreground">
                                                <div className="flex flex-col items-center justify-center gap-2">
                                                    <div className="p-3 bg-muted rounded-full">
                                                        <Inbox className="h-8 w-8 opacity-50" />
                                                    </div>
                                                    <p className="font-medium">Tidak ada surat masuk ditemukan</p>
                                                    <p className="text-sm opacity-70">
                                                        {searchTerm || hasActiveFilters ? 'Coba sesuaikan filter pencarian Anda' : 'Belum ada data surat di sistem'}
                                                    </p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        data.map((row, index) => (
                                            <TableRow key={row.id} className="group hover:bg-muted/30 transition-colors">
                                                <TableCell data-label="No." className="text-center font-medium text-muted-foreground text-xs">
                                                    {(pagination.page - 1) * pagination.limit + index + 1}
                                                </TableCell>
                                                <TableCell data-label="Tanggal" className="text-sm">
                                                    <div className="flex flex-col sm:items-start items-end">
                                                        <span className="font-medium">{formatDate(row.tanggalSurat)}</span>
                                                        <span className="text-xs text-muted-foreground">{formatDate(row.tanggalDiterima)} (Trm)</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell data-label="Nomor Surat">
                                                    <Badge variant="outline" className="font-mono text-xs bg-background">
                                                        {row.nomorSurat}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell data-label="Perihal">
                                                    <div className="flex flex-col gap-1 sm:max-w-[400px] items-end sm:items-start">
                                                        <span className="font-semibold sm:line-clamp-1 group-hover:text-primary transition-colors">{row.perihal}</span>
                                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                            <span className="sm:max-w-[150px] sm:truncate" title={row.dari}>Oleh: {row.dari}</span>
                                                            {row.jenisSurat && <span className="px-1.5 py-0.5 rounded-full bg-muted/50 border border-border/50 text-[10px]">{row.jenisSurat}</span>}
                                                            {row.sifatSurat && row.sifatSurat !== 'biasa' && (
                                                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${row.sifatSurat === 'penting' ? 'bg-yellow-50 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-200' :
                                                                    row.sifatSurat === 'rahasia' ? 'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200' :
                                                                        'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200'
                                                                    }`}>
                                                                    {row.sifatSurat.replace('_', ' ')}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell data-label="Status">
                                                    <div className="flex flex-wrap justify-end gap-1.5 sm:justify-start">
                                                        <Badge className={`shadow-none ${row.status === 'sudah_dibalas' ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-300 hover:bg-green-200 border-green-200' : 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 hover:bg-orange-200 border-orange-200'}`}>
                                                            {row.status === 'sudah_dibalas' ? 'Sudah Dibalas' : 'Belum Diproses'}
                                                        </Badge>
                                                        {row.isArchived && (
                                                            <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-500/15">
                                                                <FolderArchive className="h-3 w-3 mr-1" />
                                                                Arsip
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted" aria-label="Buka menu tindakan surat masuk">
                                                                <MoreHorizontal className="h-4 w-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="w-48">
                                                            <DropdownMenuItem onClick={() => handleViewDetail(row)}>
                                                                <Eye className="h-4 w-4 mr-2" /> Detail & File
                                                            </DropdownMenuItem>
                                                            {isAdmin && (
                                                                <>
                                                                    <DropdownMenuItem onClick={() => handleEdit(row)}>
                                                                        <Edit className="h-4 w-4 mr-2" /> Edit Surat
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem onClick={() => handleOpenDistributeDialog(row)}>
                                                                        <Send className="h-4 w-4 mr-2" /> Distribusi
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuSeparator />
                                                                    {!row.isArchived && (
                                                                        <DropdownMenuItem onClick={() => handleOpenArchiveDialog(row)}>
                                                                            <Archive className="h-4 w-4 mr-2" /> Arsipkan
                                                                        </DropdownMenuItem>
                                                                    )}
                                                                    <DropdownMenuItem onClick={() => handleOpenDeleteDialog(row)} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                                                                        <Trash2 className="h-4 w-4 mr-2" /> Hapus Surat
                                                                    </DropdownMenuItem>
                                                                </>
                                                            )}
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        )}
                    </div>

                    {/* Footer Pagination */}
                    {pagination.totalPages > 1 && (
                        <div className="border-t border-border/60 p-4 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
                            <p className="text-sm text-muted-foreground order-2 sm:order-1">
                                Menampilkan <span className="font-medium text-foreground">{data.length}</span> dari <span className="font-medium text-foreground">{pagination.total}</span> surat
                            </p>
                            <div className="order-1 sm:order-2">
                                <Pagination>
                                    <PaginationContent>
                                        <PaginationItem>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                aria-label="Halaman sebelumnya"
                                                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                                                disabled={pagination.page <= 1}
                                                className="h-8 w-8 p-0 lg:w-auto lg:px-4 lg:gap-2"
                                            >
                                                <span className="hidden lg:inline">Sebelumnya</span>
                                                <span aria-hidden="true" className="lg:hidden">{'<'}</span>
                                            </Button>
                                        </PaginationItem>
                                        <div className="flex items-center gap-1 mx-2 text-sm font-medium">
                                            Halaman {pagination.page} dari {pagination.totalPages}
                                        </div>
                                        <PaginationItem>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                aria-label="Halaman berikutnya"
                                                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                                                disabled={pagination.page >= pagination.totalPages}
                                                className="h-8 w-8 p-0 lg:w-auto lg:px-4 lg:gap-2"
                                            >
                                                <span className="hidden lg:inline">Berikutnya</span>
                                                <span aria-hidden="true" className="lg:hidden">{'>'}</span>
                                            </Button>
                                        </PaginationItem>
                                    </PaginationContent>
                                </Pagination>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Archive Dialog */}
            <ArchiveDialog
                open={archiveDialogOpen}
                onOpenChange={setArchiveDialogOpen}
                suratType="masuk"
                suratData={selectedSurat}
                onArchive={handleArchive}
            />

            {/* Distribute Dialog */}
            <DistributeDialog
                open={distributeDialogOpen}
                onOpenChange={setDistributeDialogOpen}
                suratData={selectedSurat}
                sourceUnitId={user?.unitKerjaId || ''}
                onSuccess={() => {
                    setDistributeDialogOpen(false);
                    fetchData();
                }}
            />

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Hapus Surat Masuk?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Apakah Anda yakin ingin menghapus surat <strong>{selectedSurat?.nomorSurat}</strong>?
                            Tindakan ini tidak dapat dibatalkan.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Hapus
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
