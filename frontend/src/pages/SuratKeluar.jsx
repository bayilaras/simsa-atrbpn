import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { Send, Plus, Search, Eye, Edit, Archive, Filter, ChevronDown, ChevronUp, X, MailOpen, FolderArchive, RefreshCw, Trash2, FileText, AlertCircle, Inbox, MoreHorizontal, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ExportButton } from '@/components/ExportButton';
import ImportFromGDrive from '@/components/ImportFromGDrive';
import { ArchiveDialog } from '@/components/ArchiveDialog';
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
import suratKeluarService from '@/services/surat-keluar.service';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';

// Generate year options
const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 10 }, (_, i) => currentYear - i);

export default function SuratKeluar() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { user, canWrite } = useAuth();
    const isAdmin = canWrite();

    // Data state
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
    const [stats, setStats] = useState({ total: 0, diarsipkan: 0 });

    // Filter states
    const [searchTerm, setSearchTerm] = useState('');
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const [tahun, setTahun] = useState('all');
    const [naskahDinas, setNaskahDinas] = useState('all');
    const [tanggalDari, setTanggalDari] = useState(null);
    const [tanggalSampai, setTanggalSampai] = useState(null);

    // Dialog states
    const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [selectedSurat, setSelectedSurat] = useState(null);

    // Fetch data from API
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const params = {
                page: pagination.page,
                limit: pagination.limit,
                search: searchTerm || undefined,
                unitKerjaId: user?.unitKerjaId || undefined,
                tahun: tahun !== 'all' ? tahun : undefined,
                jenisSurat: naskahDinas !== 'all' ? naskahDinas : undefined,
                tanggalDari: tanggalDari ? format(tanggalDari, 'yyyy-MM-dd') : undefined,
                tanggalSampai: tanggalSampai ? format(tanggalSampai, 'yyyy-MM-dd') : undefined,
            };

            const response = await suratKeluarService.getAll(params);
            if (response.success) {
                setData(response.data || []);
                setPagination(prev => ({
                    ...prev,
                    total: response.pagination?.total || 0,
                    totalPages: response.pagination?.totalPages || 1,
                }));
            }
        } catch (error) {
            console.error('Error fetching surat keluar:', error);
            toast({
                title: 'Error',
                description: 'Gagal memuat data surat keluar',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    }, [pagination.page, pagination.limit, searchTerm, user?.unitKerjaId, tahun, naskahDinas, tanggalDari, tanggalSampai, toast]);

    // Fetch stats from API
    const fetchStats = useCallback(async () => {
        try {
            const result = await suratKeluarService.getStats({ unitKerjaId: user?.unitKerjaId });
            if (result) {
                setStats(result);
            }
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    }, [user?.unitKerjaId]);

    useEffect(() => {
        fetchData();
        fetchStats();
    }, [fetchData, fetchStats]);

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            setPagination(prev => ({ ...prev, page: 1 }));
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const hasActiveFilters = tahun !== 'all' || naskahDinas !== 'all' ||
        tanggalDari || tanggalSampai || searchTerm;

    const clearAllFilters = () => {
        setSearchTerm('');
        setTahun('all');
        setNaskahDinas('all');
        setTanggalDari(null);
        setTanggalSampai(null);
        setPagination(prev => ({ ...prev, page: 1 }));
    };

    // Action handlers
    const handleViewDetail = (surat) => navigate(`/surat/keluar/${surat.id}`);
    const handleEdit = (surat) => navigate(`/surat/keluar/edit/${surat.id}`);

    const handleOpenArchiveDialog = (surat) => {
        setSelectedSurat({
            id: surat.id,
            nomorSurat: surat.nomorSurat,
            perihal: surat.perihal,
            tanggalSurat: surat.tanggalSurat,
        });
        setArchiveDialogOpen(true);
    };

    const handleOpenDeleteDialog = (surat) => {
        setSelectedSurat(surat);
        setDeleteDialogOpen(true);
    };

    const handleArchive = async (metadata) => {
        try {
            await suratKeluarService.archive(selectedSurat.id, metadata);
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
            await suratKeluarService.delete(selectedSurat.id);
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
            {/* Page Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <div className="p-2 bg-emerald-100 rounded-lg">
                            <Send className="h-6 w-6 text-emerald-600" />
                        </div>
                        Surat Keluar
                    </h1>
                    <p className="text-muted-foreground">
                        Kelola dan pantau surat keluar unit kerja Anda
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={fetchData} disabled={loading} size="sm" className="h-9">
                        <RefreshCw className={`h-3.5 w-3.5 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>

                    {isAdmin && (
                        <ImportFromGDrive
                            type="surat-keluar"
                            onImportComplete={fetchData}
                        />
                    )}

                    <ExportButton
                        type="surat-keluar"
                        filters={{
                            tahun: tahun !== 'all' ? tahun : undefined,
                            naskahDinas: naskahDinas !== 'all' ? naskahDinas : undefined,
                            tanggalDari: tanggalDari?.toISOString().split('T')[0],
                            tanggalSampai: tanggalSampai?.toISOString().split('T')[0],
                        }}
                    />

                    {isAdmin && (
                        <Link to="/surat/keluar/tambah">
                            <Button size="sm" className="h-9 shadow-sm hover:shadow-md transition-shadow">
                                <Plus className="mr-2 h-3.5 w-3.5" />
                                Surat Baru
                            </Button>
                        </Link>
                    )}
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="shadow-sm border-l-4 border-l-emerald-500 card-hover">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total Surat</p>
                            <p className="text-2xl font-bold">{stats.total}</p>
                        </div>
                        <div className="p-2.5 bg-emerald-100 rounded-full text-emerald-600">
                            <Send className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-orange-500 card-hover">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Draft / Belum Final</p>
                            <p className="text-2xl font-bold text-orange-600">{stats.total - stats.diarsipkan}</p>
                        </div>
                        <div className="p-2.5 bg-orange-100 rounded-full text-orange-600">
                            <AlertCircle className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-blue-500 card-hover">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Diarsipkan</p>
                            <p className="text-2xl font-bold text-blue-600">{stats.diarsipkan}</p>
                        </div>
                        <div className="p-2.5 bg-blue-100 rounded-full text-blue-600">
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
                                    placeholder="Cari nomor surat, perihal, atau tujuan..."
                                    className="pl-9 bg-background/50 border-input/60 focus:bg-background transition-colors"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen} className="flex-none">
                                <CollapsibleTrigger asChild>
                                    <Button variant="outline" className={`gap-2 w-full md:w-auto ${isAdvancedOpen ? 'bg-muted' : ''}`}>
                                        <Filter className="h-4 w-4" />
                                        <span className="hidden sm:inline">Filter</span>
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
                                <Button variant="ghost" size="icon" onClick={clearAllFilters} className="text-muted-foreground hover:text-destructive shrink-0" title="Reset Filters">
                                    <X className="h-4 w-4" />
                                </Button>
                            )}
                        </div>

                        {/* Advanced Filters Panel */}
                        <Collapsible open={isAdvancedOpen}>
                            <CollapsibleContent className="pt-2">
                                <div className="bg-muted/30 p-4 rounded-lg border border-border/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                    {/* Tahun */}
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold text-muted-foreground uppercase">Tahun</label>
                                        <Select value={tahun} onValueChange={setTahun}>
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

                                    {/* Naskah Dinas */}
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold text-muted-foreground uppercase">Naskah Dinas</label>
                                        <SearchableSelect
                                            options={[
                                                { value: 'all', label: 'Semua Naskah' },
                                                'Keputusan', 'Surat Tugas', 'Surat Perintah', 'Nota Dinas', 'Memorandum',
                                                'Surat Dinas', 'Surat Undangan', 'Surat Perjanjian/MoU', 'Surat Kuasa',
                                                'Berita Acara', 'Surat Keterangan', 'Surat Pengantar', 'Pemberitahuan',
                                                'Pengumuman', 'Laporan', 'Telaahan Staf', 'Piagam', 'Umum',
                                                'Naskah Dinas Arahan', 'Naskah Dinas Korespondensi', 'Naskah Dinas Khusus',
                                                'Peraturan', 'Pedoman', 'Petunjuk Pelaksanaan', 'Instruksi',
                                                'Surat Edaran', 'Pengaduan'
                                            ]}
                                            value={naskahDinas}
                                            onValueChange={setNaskahDinas}
                                            placeholder="Pilih Naskah"
                                            searchPlaceholder=" Cari..."
                                            className="h-9"
                                        />
                                    </div>

                                    {/* Filter Tanggal */}
                                    <div className="space-y-1.5 sm:col-span-2">
                                        <label className="text-xs font-semibold text-muted-foreground uppercase">Rentang Tanggal</label>
                                        <div className="flex items-center gap-2">
                                            <DatePicker
                                                date={tanggalDari}
                                                onDateChange={setTanggalDari}
                                                placeholder="Dari tanggal"
                                                className="h-9 bg-background flex-1"
                                            />
                                            <span className="text-muted-foreground">-</span>
                                            <DatePicker
                                                date={tanggalSampai}
                                                onDateChange={setTanggalSampai}
                                                placeholder="Sampai tanggal"
                                                className="h-9 bg-background flex-1"
                                            />
                                        </div>
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
                            <Table>
                                <TableHeader className="bg-muted/30">
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="w-[50px] text-center">No.</TableHead>
                                        <TableHead className="w-[120px]">Tanggal</TableHead>
                                        <TableHead className="w-[160px]">Nomor Surat</TableHead>
                                        <TableHead>Perihal & Tujuan</TableHead>
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
                                                    <p className="font-medium">Tidak ada surat keluar ditemukan</p>
                                                    <p className="text-sm opacity-70">
                                                        {searchTerm || hasActiveFilters ? 'Coba sesuaikan filter pencarian Anda' : 'Belum ada data surat di sistem'}
                                                    </p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        data.map((row, index) => (
                                            <TableRow key={row.id} className="group hover:bg-muted/30 transition-colors">
                                                <TableCell className="text-center font-medium text-muted-foreground text-xs">
                                                    {(pagination.page - 1) * pagination.limit + index + 1}
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{formatDate(row.tanggalSurat)}</span>
                                                        {row.tanggalKirim && (
                                                            <span className="text-xs text-muted-foreground">{formatDate(row.tanggalKirim)} (Kirim)</span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className="font-mono text-xs bg-background">
                                                        {row.nomorSurat}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1 max-w-[400px]">
                                                        <span className="font-semibold line-clamp-1 group-hover:text-primary transition-colors">{row.perihal}</span>
                                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                            <span className="max-w-[150px] truncate" title={row.kepada}>Kepada: {row.kepada}</span>
                                                            {row.jenisSurat && <span className="px-1.5 py-0.5 rounded-full bg-muted/50 border border-border/50 text-[10px]">{row.jenisSurat}</span>}
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {row.filePath && (
                                                            <Badge variant="secondary" className="gap-1 bg-blue-50 text-blue-700 border-blue-200">
                                                                <FileText className="h-3 w-3" />
                                                                File
                                                            </Badge>
                                                        )}
                                                        {row.balasanDariId && (
                                                            <Badge variant="outline" className="gap-1 border-orange-200 text-orange-700 bg-orange-50">
                                                                <MailOpen className="h-3 w-3" />
                                                                Balasan
                                                            </Badge>
                                                        )}
                                                        {row.isArchived ? (
                                                            <Badge variant="outline" className="border-green-500 text-green-600 bg-green-50">
                                                                <FolderArchive className="h-3 w-3 mr-1" />
                                                                Arsip
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="text-muted-foreground">Aktif</Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted">
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
                                                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                                                disabled={pagination.page <= 1}
                                                className="h-8 w-8 p-0 lg:w-auto lg:px-4 lg:gap-2"
                                            >
                                                <span className="hidden lg:inline">Previous</span>
                                                <span className="lg:hidden">{'<'}</span>
                                            </Button>
                                        </PaginationItem>
                                        <div className="flex items-center gap-1 mx-2 text-sm font-medium">
                                            Page {pagination.page} of {pagination.totalPages}
                                        </div>
                                        <PaginationItem>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                                                disabled={pagination.page >= pagination.totalPages}
                                                className="h-8 w-8 p-0 lg:w-auto lg:px-4 lg:gap-2"
                                            >
                                                <span className="hidden lg:inline">Next</span>
                                                <span className="lg:hidden">{'>'}</span>
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
                suratType="keluar"
                suratData={selectedSurat}
                onArchive={handleArchive}
            />

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Hapus Surat Keluar?</AlertDialogTitle>
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
