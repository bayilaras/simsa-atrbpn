import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useAppConfig } from '@/context/app-config-context';
import { resolveEffectiveUnitKerjaId } from '@/lib/unit-kerja-scope';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Send, Plus, Search, Eye, Edit, Archive, Filter, ChevronDown, ChevronUp, X, MailOpen, FolderArchive, RefreshCw, Trash2, FileText, AlertCircle, Inbox, MoreHorizontal, CheckCircle2, Building2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ExportButton } from '@/components/ExportButton';
import { canExportReports } from '@/lib/provisioning-access';
import { sifatSuratKeluarLabel } from '@/lib/sifat-surat-keluar';
import { JENIS_NASKAH_DINAS } from '@/lib/jenis-naskah';
import { pesanGalat } from '@/lib/pesan-galat';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DaftarSuratTerhapus } from '@/components/surat/DaftarSuratTerhapus';
import { PILIHAN_URUTAN_SURAT, URUTAN_BAWAAN, parameterUrutan } from '@/lib/urutan-daftar-surat';
import ImportFromGDrive from '@/components/ImportFromGDrive';
import ImportFileDialog from '@/components/ImportFileDialog';
import { ArchiveDialog } from '@/components/ArchiveDialog';
import { Checkbox } from '@/components/ui/checkbox';
import PersetujuanMassal from '@/components/surat/PersetujuanMassal';
import { PILIHAN_SARING_PERSETUJUAN, saringPersetujuanDari, umumkanPersetujuanMenunggu } from '@/lib/persetujuan-menunggu';
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
import settingsService from '@/services/settings.service';
import approvalService from '@/services/approval.service';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';

// Generate year options
const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 10 }, (_, i) => currentYear - i);
const PILIHAN_BARIS_PER_HALAMAN = [10, 25, 50, 100];
const NASKAH_INISIATIF = ['Nota Dinas', 'Surat Edaran', 'Surat Undangan', 'Keputusan', 'Surat Tugas'];
const approvalStatusDisplay = {
    draft: { label: 'Draft', className: 'text-muted-foreground' },
    pending: { label: 'Menunggu Persetujuan', className: 'border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
    approved: { label: 'Disetujui', className: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
    rejected: { label: 'Perlu Perbaikan', className: 'border-red-300 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
};

export default function SuratKeluar() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { user, canWrite } = useAuth();
    const { capabilities } = useAppConfig();
    const isAdmin = canWrite();
    const isSuperAdmin = user?.role === 'super_admin';

    // Data state
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
    const [statsSnapshot, setStatsSnapshot] = useState({ scope: null, status: 'loading', data: null });
    const statsSeqRef = useRef(0);
    const [pendingApprovals, setPendingApprovals] = useState([]);
    const [selectedIds, setSelectedIds] = useState(() => new Set());

    // Penyaring kerja persetujuan tersimpan di alamat halaman agar tautan dari
    // Dashboard dan sidebar langsung membuka daftar yang sudah tersaring.
    const [searchParams, setSearchParams] = useSearchParams();
    const saringPersetujuan = saringPersetujuanDari(searchParams.get('persetujuan'));

    // Unit kerja filter for super admin
    const [unitKerjaList, setUnitKerjaList] = useState([]);
    const [selectedUnitKerja, setSelectedUnitKerja] = useState(isSuperAdmin ? 'all' : (resolveEffectiveUnitKerjaId(user) || undefined));

    // Filter states
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(saringPersetujuan !== 'all');
    const [tahun, setTahun] = useState('all');
    const [naskahDinas, setNaskahDinas] = useState('all');
    const [tanggalDari, setTanggalDari] = useState(null);
    const [tanggalSampai, setTanggalSampai] = useState(null);
    const [urutan, setUrutan] = useState(URUTAN_BAWAAN);

    // Dialog states
    const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [selectedSurat, setSelectedSurat] = useState(null);
    const [alasanHapus, setAlasanHapus] = useState('');
    // Super Admin: 'daftar' atau 'terhapus' (surat yang dihapus dan dapat dipulihkan).
    const [tampilan, setTampilan] = useState('daftar');

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
        : (resolveEffectiveUnitKerjaId(user) || undefined);
    // Pada tampilan semua unit, Super Admin perlu tahu unit pemilik tiap baris.
    const tampilkanKolomUnit = isSuperAdmin && !resolvedUnitKerjaId;
    const statsScope = JSON.stringify([user?.id, user?.role, resolvedUnitKerjaId]);
    const statsLoading = statsSnapshot.scope !== statsScope || statsSnapshot.status === 'loading';
    const stats = !statsLoading && statsSnapshot.status === 'success' ? statsSnapshot.data : null;

    // Guards against out-of-order responses overwriting newer results
    const fetchSeqRef = useRef(0);

    // Fetch data from API
    const fetchData = useCallback(async () => {
        const seq = ++fetchSeqRef.current;
        let changingPage = false;
        setLoading(true);
        setLoadError(false);
        try {
            const params = {
                page: pagination.page,
                limit: pagination.limit,
                search: debouncedSearchTerm || undefined,
                unitKerjaId: resolvedUnitKerjaId,
                tahun: tahun !== 'all' ? tahun : undefined,
                naskahDinas: naskahDinas !== 'all' ? naskahDinas : undefined,
                persetujuan: saringPersetujuan !== 'all' ? saringPersetujuan : undefined,
                tanggalDari: tanggalDari ? format(tanggalDari, 'yyyy-MM-dd') : undefined,
                tanggalSampai: tanggalSampai ? format(tanggalSampai, 'yyyy-MM-dd') : undefined,
                urutan: parameterUrutan(urutan),
            };

            const response = await suratKeluarService.getAll(params);
            if (seq !== fetchSeqRef.current) return;
            if (!response.success) throw new Error('Daftar surat keluar tidak dapat dimuat.');
            if (response.success) {
                const totalPages = Math.max(1, response.pagination?.totalPages || 1);
                if (pagination.page > totalPages) {
                    changingPage = true;
                    setPagination(prev => ({ ...prev, page: totalPages }));
                    return; // The page effect fetches the last remaining page.
                }
                setData(response.data || []);
                // Pilihan hanya berlaku untuk baris yang sedang tampil.
                setSelectedIds(new Set());
                setPagination(prev => ({
                    ...prev,
                    total: response.pagination?.total || 0,
                    totalPages,
                }));
            }
        } catch (error) {
            if (seq !== fetchSeqRef.current) return;
            setLoadError(true);
            console.error('Error fetching surat keluar:', error);
            toast({
                title: 'Gagal',
                description: 'Gagal memuat data surat keluar',
                variant: 'destructive',
            });
        } finally {
            if (seq === fetchSeqRef.current && !changingPage) setLoading(false);
        }
    }, [pagination.page, pagination.limit, debouncedSearchTerm, resolvedUnitKerjaId, tahun, naskahDinas, saringPersetujuan, tanggalDari, tanggalSampai, urutan, toast]);

    // Fetch stats from API
    const fetchStats = useCallback(async () => {
        const seq = ++statsSeqRef.current;
        setStatsSnapshot({ scope: statsScope, status: 'loading', data: null });
        try {
            const result = await suratKeluarService.getStats({ unitKerjaId: resolvedUnitKerjaId });
            if (seq !== statsSeqRef.current) return;
            if (!['total', 'diarsipkan'].every(key => Number.isSafeInteger(result?.[key]) && result[key] >= 0)
                || result.diarsipkan > result.total) {
                throw new Error('Statistik surat keluar tidak lengkap.');
            }
            setStatsSnapshot({ scope: statsScope, status: 'success', data: result });
        } catch (error) {
            if (seq !== statsSeqRef.current) return;
            console.error('Error fetching stats:', error);
            setStatsSnapshot({ scope: statsScope, status: 'error', data: null });
        }
    }, [resolvedUnitKerjaId, statsScope]);

    const fetchPendingApprovals = useCallback(async () => {
        if (!isAdmin) {
            setPendingApprovals([]);
            return;
        }
        try {
            const menunggu = await approvalService.getPending();
            setPendingApprovals(menunggu);
            umumkanPersetujuanMenunggu(Array.isArray(menunggu) ? menunggu.length : 0);
        } catch (error) {
            console.error('Error fetching pending approvals:', error);
            setPendingApprovals([]);
        }
    }, [isAdmin]);

    useEffect(() => {
        fetchData();
        return () => { fetchSeqRef.current += 1; };
    }, [fetchData]);

    useEffect(() => {
        fetchStats();
        return () => { statsSeqRef.current += 1; };
    }, [fetchStats]);

    const refreshAll = () => { fetchData(); fetchStats(); };

    useEffect(() => {
        fetchPendingApprovals();
    }, [fetchPendingApprovals]);

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
            setPagination(prev => ({ ...prev, page: 1 }));
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const hasActiveFilters = tahun !== 'all' || naskahDinas !== 'all' || saringPersetujuan !== 'all' ||
        tanggalDari || tanggalSampai || searchTerm;

    const setSaringPersetujuan = (nilai) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            if (nilai === 'all') next.delete('persetujuan');
            else next.set('persetujuan', nilai);
            return next;
        }, { replace: true });
        setPagination(prev => ({ ...prev, page: 1 }));
    };

    // Jumlah menunggu dihitung dari antrean persetujuan, sedangkan daftar
    // mengikuti kewenangan baca daftar. Bila daftar tersaring memuat lebih
    // sedikit surat, sisanya tetap dapat dibuka dari kartu di atas tabel.
    const tanpaPenyaringLain = !debouncedSearchTerm && tahun === 'all' && naskahDinas === 'all'
        && !tanggalDari && !tanggalSampai && (!isSuperAdmin || selectedUnitKerja === 'all');
    const menungguTakTampil = saringPersetujuan === 'menunggu_saya' && tanpaPenyaringLain && !loading && !loadError
        ? Math.max(0, pendingApprovals.length - pagination.total)
        : 0;
    const menungguUntukKartu = useMemo(() => {
        if (menungguTakTampil === 0 || pagination.totalPages > 1) return pendingApprovals;
        const idTampil = new Set(data.map(row => row.id));
        return [
            ...pendingApprovals.filter(item => !idTampil.has(item.suratId)),
            ...pendingApprovals.filter(item => idTampil.has(item.suratId)),
        ];
    }, [menungguTakTampil, pagination.totalPages, pendingApprovals, data]);
    const idMenungguSaya = useMemo(() => new Set(pendingApprovals.map(item => item.suratId)), [pendingApprovals]);
    const bisaDiajukan = (row) => isAdmin && !row.isArchived
        && ['draft', 'rejected'].includes(row.approvalStatus || 'draft')
        && Boolean(user?.id) && row.createdBy === user.id;
    const bisaDisetujui = (row) => isAdmin && !row.isArchived && row.approvalStatus === 'pending'
        && (row.currentApproverId === user?.id || idMenungguSaya.has(row.id));
    const bisaDipilih = (row) => bisaDiajukan(row) || bisaDisetujui(row);
    const barisBisaDipilih = data.filter(bisaDipilih);
    const barisTerpilih = data.filter(row => selectedIds.has(row.id));
    const semuaTerpilih = barisBisaDipilih.length > 0 && barisBisaDipilih.every(row => selectedIds.has(row.id));
    const togglePilih = (id, pilih) => setSelectedIds(prev => {
        const next = new Set(prev);
        if (pilih) next.add(id); else next.delete(id);
        return next;
    });
    const togglePilihSemua = (pilih) => setSelectedIds(pilih ? new Set(barisBisaDipilih.map(row => row.id)) : new Set());
    const jumlahKolom = (isAdmin ? 7 : 6) + (tampilkanKolomUnit ? 1 : 0);

    // Applying a filter must restart from the first page
    const applyFilter = (setter) => (value) => {
        setter(value);
        setPagination(prev => ({ ...prev, page: 1 }));
    };

    const clearAllFilters = () => {
        setSearchTerm('');
        setTahun('all');
        setNaskahDinas('all');
        setTanggalDari(null);
        setTanggalSampai(null);
        setSaringPersetujuan('all');
    };

    // Action handlers
    const handleViewDetail = (surat) => navigate(`/surat/keluar/${surat.id}`);
    const handleEdit = (surat) => navigate(`/surat/keluar/edit/${surat.id}`);

    const handleOpenArchiveDialog = (surat) => {
        setSelectedSurat(surat);
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
            refreshAll();
        } catch (error) {
            toast({
                title: 'Gagal',
                description: error.message || 'Gagal mengarsipkan surat',
                variant: 'destructive',
            });
            throw error;
        }
    };

    const handleDelete = async () => {
        try {
            await suratKeluarService.delete(selectedSurat.id, { alasan: alasanHapus.trim() });
            toast({
                title: 'Berhasil Dihapus',
                description: `Surat ${selectedSurat.nomorSurat} telah dihapus`,
            });
            setDeleteDialogOpen(false);
            refreshAll();
        } catch (error) {
            toast({
                title: 'Gagal',
                description: pesanGalat(error, 'Gagal menghapus surat'),
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
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-1">
                    <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-500/15 rounded-lg">
                            <Send className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        Surat Keluar
                    </h1>
                    <p className="text-muted-foreground">
                        Kelola dan pantau surat keluar unit kerja Anda
                    </p>
                </div>
                {/* Unit Kerja Selector for Super Admin */}
                {isSuperAdmin && unitKerjaList.length > 0 && (
                    <div className="w-full space-y-1.5 sm:w-auto">
                        <label htmlFor="surat-keluar-unit-kerja" className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                            <Building2 className="h-4 w-4" aria-hidden="true" /> Unit kerja
                        </label>
                        <Select value={selectedUnitKerja} onValueChange={(val) => { setSelectedUnitKerja(val); setPagination(prev => ({ ...prev, page: 1 })); }}>
                            <SelectTrigger id="surat-keluar-unit-kerja" className="h-9 w-full sm:w-[220px]">
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
                    <Button variant="outline" onClick={refreshAll} disabled={loading} size="sm" className="h-9">
                        <RefreshCw className={`h-3.5 w-3.5 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>

                    {isAdmin && (
                        <ImportFromGDrive
                            type="surat-keluar"
                            unitKerjaId={resolvedUnitKerjaId}
                            onImportComplete={refreshAll}
                        />
                    )}

                    {isAdmin && <ImportFileDialog type="surat-keluar" unitKerjaId={resolvedUnitKerjaId} onImportComplete={refreshAll} />}

                    {canExportReports(user?.role) && (
                        <ExportButton
                            type="surat-keluar"
                            filters={{
                                unitKerjaId: resolvedUnitKerjaId,
                                search: debouncedSearchTerm || undefined,
                                tahun: tahun !== 'all' ? tahun : undefined,
                                naskahDinas: naskahDinas !== 'all' ? naskahDinas : undefined,
                                tanggalDari: tanggalDari ? format(tanggalDari, 'yyyy-MM-dd') : undefined,
                                tanggalSampai: tanggalSampai ? format(tanggalSampai, 'yyyy-MM-dd') : undefined,
                                urutan: parameterUrutan(urutan),
                            }}
                        />
                    )}

                    {isAdmin && (
                        <div className="flex" role="group" aria-label="Buat surat keluar">
                            <Button asChild size="sm" className="h-9 rounded-r-none shadow-sm">
                                <Link to="/surat/keluar/inisiatif">
                                    <Plus className="mr-2 h-3.5 w-3.5" />
                                    Buat Surat Inisiatif
                                </Link>
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button size="sm" className="h-9 rounded-l-none border-l border-primary-foreground/20 px-2" aria-label="Pilihan surat keluar lainnya">
                                        <ChevronDown className="h-3.5 w-3.5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-60">
                                    {NASKAH_INISIATIF.map((naskah) => (
                                        <DropdownMenuItem key={naskah} onSelect={() => navigate(`/surat/keluar/inisiatif?naskah=${encodeURIComponent(naskah)}`)}>
                                            {naskah}
                                        </DropdownMenuItem>
                                    ))}
                                    <DropdownMenuItem onSelect={() => navigate('/surat/keluar/inisiatif')}>Lainnya…</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onSelect={() => navigate('/surat/keluar/tambah?pilih=referensi')}>Tindak Lanjut Surat Masuk…</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    )}
                </div>
            </div>

            {pendingApprovals.length > 0 && (
                <Card className="border-amber-300 bg-amber-50/70 dark:bg-amber-500/10">
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <AlertCircle className="h-5 w-5 text-amber-600" />
                            {pendingApprovals.length} surat menunggu keputusan Anda
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                        {menungguTakTampil > 0 && (
                            <p className="w-full text-sm text-muted-foreground">
                                {`${menungguTakTampil} surat yang menunggu tidak tampil di daftar di bawah karena tingkat keamanannya di atas kewenangan Anda. Surat itu baru dapat dibuka dan diputus setelah Anda memperoleh persetujuan akses dari Super Admin.`}
                            </p>
                        )}
                        {menungguUntukKartu.slice(0, 5).map(item => (
                            <Button key={item.requestId} asChild size="sm" variant="outline">
                                <Link to={`/surat/keluar/${item.suratId}`}>
                                    {item.nomorSurat || 'Draft'} — {item.perihal || 'Tanpa perihal'}
                                </Link>
                            </Button>
                        ))}
                        {saringPersetujuan !== 'menunggu_saya' && (
                            <Button size="sm" onClick={() => setSaringPersetujuan('menunggu_saya')}>
                                Tampilkan semua di daftar
                            </Button>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Quick Stats */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card className="shadow-sm border-l-4 border-l-emerald-500 card-hover">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total Surat</p>
                            <p className="text-2xl font-bold">{stats?.total ?? '—'}</p>
                        </div>
                        <div className="p-2.5 bg-emerald-100 dark:bg-emerald-500/15 rounded-full text-emerald-600 dark:text-emerald-400">
                            <Send className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-orange-500 card-hover">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Belum Diarsipkan</p>
                            <p className="text-2xl font-bold text-orange-600">{stats ? stats.total - stats.diarsipkan : '—'}</p>
                        </div>
                        <div className="p-2.5 bg-orange-100 dark:bg-orange-500/15 rounded-full text-orange-600">
                            <AlertCircle className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-blue-500 card-hover">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Diarsipkan</p>
                            <p className="text-2xl font-bold text-blue-600">{stats?.diarsipkan ?? '—'}</p>
                        </div>
                        <div className="p-2.5 bg-blue-100 dark:bg-blue-500/15 rounded-full text-blue-600">
                            <FolderArchive className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {statsLoading ? <p role="status" className="text-sm text-muted-foreground">Memuat statistik…</p> : !stats && (
                <div role="alert" className="rounded-lg border border-destructive/40 p-3">
                    <p className="text-sm">Statistik belum tersedia. Periksa koneksi dan coba lagi.</p>
                    <Button variant="outline" size="sm" className="mt-2" onClick={fetchStats}>Coba lagi statistik</Button>
                </div>
            )}

            {isSuperAdmin && (
                <Tabs value={tampilan} onValueChange={setTampilan}>
                    <TabsList>
                        <TabsTrigger value="daftar">Daftar Surat</TabsTrigger>
                        <TabsTrigger value="terhapus">Surat Terhapus</TabsTrigger>
                    </TabsList>
                </Tabs>
            )}
            {isSuperAdmin && tampilan === 'terhapus' && (
                <DaftarSuratTerhapus jenis="keluar" unitKerjaId={resolvedUnitKerjaId} onDipulihkan={refreshAll} />
            )}

            {/* Main Content Area */}
            <Card className={`shadow-sm border-border/60 ${tampilan === 'terhapus' ? 'hidden' : ''}`}>
                <CardHeader className="pb-4">
                    <div className="flex flex-col space-y-4">
                        {/* Search & Filter Controls */}
                        <div className="flex flex-col md:flex-row gap-3 md:items-end">
                            <div className="min-w-0 flex-1 space-y-1.5">
                                <label htmlFor="surat-keluar-search" className="text-sm font-medium">Cari surat keluar</label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        id="surat-keluar-search"
                                        placeholder="Cari nomor surat, perihal, atau tujuan..."
                                        className="pl-9 bg-background/50 border-input/60 focus:bg-background transition-colors"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="w-full space-y-1.5 md:w-[220px]">
                                <label htmlFor="surat-keluar-urutan" className="text-sm font-medium">Urutkan</label>
                                <Select value={urutan} onValueChange={applyFilter(setUrutan)}>
                                    <SelectTrigger id="surat-keluar-urutan" className="h-9 bg-background">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PILIHAN_URUTAN_SURAT.map(pilihan => (
                                            <SelectItem key={pilihan.value} value={pilihan.value}>{pilihan.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
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
                                <div className="bg-muted/30 p-4 rounded-lg border border-border/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                    {/* Tahun */}
                                    <div className="space-y-1.5">
                                        <label htmlFor="surat-keluar-tahun" className="text-xs font-semibold text-muted-foreground uppercase">Tahun</label>
                                        <Select value={tahun} onValueChange={applyFilter(setTahun)}>
                                            <SelectTrigger id="surat-keluar-tahun" className="h-9 bg-background">
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
                                        <label htmlFor="surat-keluar-jenis" className="text-xs font-semibold text-muted-foreground uppercase">Naskah Dinas</label>
                                        <SearchableSelect
                                            id="surat-keluar-jenis"
                                            ariaLabel="Naskah Dinas"
                                            options={[{ value: 'all', label: 'Semua Naskah' }, ...JENIS_NASKAH_DINAS]}
                                            value={naskahDinas}
                                            onValueChange={applyFilter(setNaskahDinas)}
                                            placeholder="Pilih Naskah"
                                            searchPlaceholder=" Cari..."
                                            className="h-9"
                                        />
                                    </div>

                                    {/* Persetujuan */}
                                    {isAdmin && (
                                        <div className="space-y-1.5">
                                            <label htmlFor="surat-keluar-persetujuan" className="text-xs font-semibold text-muted-foreground uppercase">Persetujuan</label>
                                            <Select value={saringPersetujuan} onValueChange={setSaringPersetujuan}>
                                                <SelectTrigger id="surat-keluar-persetujuan" className="h-9 bg-background">
                                                    <SelectValue placeholder="Semua surat" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {PILIHAN_SARING_PERSETUJUAN.map(pilihan => (
                                                        <SelectItem key={pilihan.value} value={pilihan.value}>{pilihan.label}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}

                                    {/* Filter Tanggal */}
                                    <fieldset className="min-w-0 space-y-1.5 sm:col-span-2">
                                        <legend className="text-xs font-semibold text-muted-foreground uppercase">Rentang Tanggal</legend>
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                            <label className="min-w-0 space-y-1.5">
                                                <span className="text-xs text-muted-foreground">Tanggal dari</span>
                                                <DatePicker
                                                    date={tanggalDari}
                                                    onDateChange={applyFilter(setTanggalDari)}
                                                    placeholder="Pilih tanggal awal"
                                                    className="h-9 bg-background"
                                                />
                                            </label>
                                            <label className="min-w-0 space-y-1.5">
                                                <span className="text-xs text-muted-foreground">Tanggal sampai</span>
                                                <DatePicker
                                                    date={tanggalSampai}
                                                    onDateChange={applyFilter(setTanggalSampai)}
                                                    placeholder="Pilih tanggal akhir"
                                                    className="h-9 bg-background"
                                                />
                                            </label>
                                        </div>
                                    </fieldset>
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    </div>
                </CardHeader>

                <CardContent className="p-0">
                    <div className="border-t border-border/60">
                        {isAdmin && (
                            <PersetujuanMassal
                                jumlahDipilih={loading || loadError ? 0 : barisTerpilih.length}
                                dapatDiajukan={barisTerpilih.filter(bisaDiajukan)}
                                dapatDisetujui={barisTerpilih.filter(bisaDisetujui)}
                                onBatalPilih={() => setSelectedIds(new Set())}
                                onSelesai={() => { refreshAll(); fetchPendingApprovals(); }}
                            />
                        )}
                        {loading ? (
                            <div className="p-4">
                                <TableSkeleton columns={7} rows={5} />
                            </div>
                        ) : loadError ? (
                            <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                                <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
                                <p className="font-medium">Gagal memuat daftar surat keluar</p>
                                <p className="text-sm text-muted-foreground">Periksa koneksi Anda lalu coba lagi.</p>
                                <Button variant="outline" onClick={refreshAll}>
                                    <RefreshCw className="h-4 w-4" aria-hidden="true" /> Coba lagi
                                </Button>
                            </div>
                        ) : (
                            <Table responsive>
                                <TableHeader className="bg-muted/30">
                                    <TableRow className="hover:bg-transparent">
                                        {isAdmin && (
                                            <TableHead className="w-[40px]">
                                                <Checkbox
                                                    aria-label="Pilih semua di halaman ini"
                                                    checked={semuaTerpilih}
                                                    disabled={barisBisaDipilih.length === 0}
                                                    onCheckedChange={(nilai) => togglePilihSemua(nilai === true)}
                                                />
                                            </TableHead>
                                        )}
                                        <TableHead className="w-[50px] text-center">No.</TableHead>
                                        <TableHead className="w-[120px]">Tanggal</TableHead>
                                        <TableHead className="w-[160px]">Nomor Surat</TableHead>
                                        {tampilkanKolomUnit && <TableHead className="w-[180px]">Unit Kerja</TableHead>}
                                        <TableHead>Perihal & Tujuan</TableHead>
                                        <TableHead className="w-[180px]">Status</TableHead>
                                        <TableHead className="w-[100px] text-right">Aksi</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={jumlahKolom} className="text-center py-16 text-muted-foreground">
                                                <div className="flex flex-col items-center justify-center gap-2">
                                                    <div className="p-3 bg-muted rounded-full">
                                                        <Inbox className="h-8 w-8 opacity-50" />
                                                    </div>
                                                    <p className="font-medium">Tidak ada surat keluar ditemukan</p>
                                                    <p className="text-sm text-muted-foreground">
                                                        {searchTerm || hasActiveFilters ? 'Coba sesuaikan filter pencarian Anda' : 'Belum ada data surat di sistem'}
                                                    </p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        data.map((row, index) => (
                                            <TableRow key={row.id} className="group hover:bg-muted/30 transition-colors">
                                                {isAdmin && (
                                                    <TableCell data-label="Pilih">
                                                        {bisaDipilih(row) && (
                                                            <Checkbox
                                                                aria-label={`Pilih surat ${row.nomorSurat || row.perihal || ''}`.trim()}
                                                                checked={selectedIds.has(row.id)}
                                                                onCheckedChange={(nilai) => togglePilih(row.id, nilai === true)}
                                                            />
                                                        )}
                                                    </TableCell>
                                                )}
                                                <TableCell data-label="No." className="text-center font-medium text-muted-foreground text-xs">
                                                    {(pagination.page - 1) * pagination.limit + index + 1}
                                                </TableCell>
                                                <TableCell data-label="Tanggal" className="text-sm">
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{formatDate(row.tanggalSurat)}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell data-label="Nomor Surat">
                                                    <span className="rounded-md border bg-background px-2 py-0.5 font-mono text-xs" style={{ overflowWrap: 'anywhere' }}>
                                                        {row.nomorSurat}
                                                    </span>
                                                </TableCell>
                                                {tampilkanKolomUnit && (
                                                    <TableCell data-label="Unit Kerja" className="text-sm">{row.unitKerjaNama || '-'}</TableCell>
                                                )}
                                                <TableCell data-label="Perihal">
                                                    <div className="flex flex-col gap-1 max-w-[400px]">
                                                        <span className="font-semibold line-clamp-1 group-hover:text-primary transition-colors">{row.perihal}</span>
                                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                            <span className="max-w-[150px] truncate" title={row.kepada || 'Penerima belum tercatat'}>Kepada: {row.kepada || '-'}</span>
                                                            {row.naskahDinas && <span className="px-1.5 py-0.5 rounded-full bg-muted/50 border border-border/50 text-[10px]">{row.naskahDinas}</span>}
                                                            {row.sifatSurat && row.sifatSurat !== 'biasa' && (
                                                                <span data-badge="sifat-surat" className="px-1.5 py-0.5 rounded-full text-[10px] font-medium border bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200">
                                                                    {sifatSuratKeluarLabel(row.sifatSurat)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell data-label="Status">
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {capabilities.files && row.filePath && (
                                                            <Badge variant="secondary" className="gap-1 bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200">
                                                                <FileText className="h-3 w-3" />
                                                                File
                                                            </Badge>
                                                        )}
                                                        {(row.isBalasan || row.balasanUntuk) && (
                                                            <Badge data-badge="balasan" variant="outline" className="gap-1 border-orange-200 text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-500/15">
                                                                <MailOpen className="h-3 w-3" />
                                                                Balasan
                                                            </Badge>
                                                        )}
                                                        {row.asalNaskah === 'inisiatif' && (
                                                            <Badge data-badge="asal-naskah" variant="outline" className="border-emerald-200 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15">Inisiatif</Badge>
                                                        )}
                                                        {row.asalNaskah === 'tindak_lanjut' && (
                                                            <Badge data-badge="asal-naskah" variant="outline" className="border-sky-200 text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-500/15">Tindak Lanjut</Badge>
                                                        )}
                                                        <Badge variant="outline" className="capitalize">
                                                            {(row.klasifikasiKeamanan || 'terbatas').replaceAll('_', ' ')}
                                                        </Badge>
                                                        {row.isArchived ? (
                                                            <Badge variant="outline" className="border-green-500 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/15">
                                                                <FolderArchive className="h-3 w-3 mr-1" />
                                                                Arsip
                                                            </Badge>
                                                        ) : (
                                                            <Badge
                                                                variant="outline"
                                                                className={approvalStatusDisplay[row.approvalStatus]?.className || 'text-muted-foreground'}
                                                            >
                                                                {approvalStatusDisplay[row.approvalStatus]?.label || 'Draft'}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted" aria-label="Buka menu tindakan surat keluar">
                                                                <MoreHorizontal className="h-4 w-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="w-48">
                                                            <DropdownMenuItem onClick={() => handleViewDetail(row)}>
                                                                <Eye className="h-4 w-4 mr-2" /> Detail & File
                                                            </DropdownMenuItem>
                                                            {isAdmin && (
                                                                <>
                                                                    {['draft', 'rejected'].includes(row.approvalStatus || 'draft') && (
                                                                        <DropdownMenuItem onClick={() => handleEdit(row)}>
                                                                            <Edit className="h-4 w-4 mr-2" /> Edit Surat
                                                                        </DropdownMenuItem>
                                                                    )}
                                                                    {row.approvalStatus === 'approved' && !row.isArchived && (
                                                                        <DropdownMenuItem onClick={() => handleOpenArchiveDialog(row)}>
                                                                            <Archive className="h-4 w-4 mr-2" /> Arsipkan
                                                                        </DropdownMenuItem>
                                                                    )}
                                                                    {['draft', 'rejected'].includes(row.approvalStatus || 'draft') && (
                                                                        <>
                                                                            <DropdownMenuSeparator />
                                                                            <DropdownMenuItem onClick={() => handleOpenDeleteDialog(row)} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                                                                                <Trash2 className="h-4 w-4 mr-2" /> Hapus Surat
                                                                            </DropdownMenuItem>
                                                                        </>
                                                                    )}
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
                    {!loading && !loadError && (pagination.total > PILIHAN_BARIS_PER_HALAMAN[0] || pagination.totalPages > 1) && (
                        <div className="border-t border-border/60 p-4 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
                            <div className="order-2 flex flex-wrap items-center gap-3 sm:order-1">
                                <p className="text-sm text-muted-foreground">
                                    Menampilkan <span className="font-medium text-foreground">{data.length}</span> dari <span className="font-medium text-foreground">{pagination.total}</span> surat
                                </p>
                                <div className="flex items-center gap-2">
                                    <label htmlFor="surat-keluar-baris" className="text-sm text-muted-foreground">Baris per halaman</label>
                                    <Select
                                        value={String(pagination.limit)}
                                        onValueChange={(nilai) => setPagination(prev => ({ ...prev, limit: Number(nilai), page: 1 }))}
                                    >
                                        <SelectTrigger id="surat-keluar-baris" className="h-8 w-[76px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {PILIHAN_BARIS_PER_HALAMAN.map(jumlah => (
                                                <SelectItem key={jumlah} value={String(jumlah)}>{jumlah}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            {pagination.totalPages > 1 && <div className="order-1 sm:order-2">
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
                            </div>}
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
            <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => { setDeleteDialogOpen(open); if (!open) setAlasanHapus(''); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Hapus Surat Keluar?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Apakah Anda yakin ingin menghapus surat <strong>{selectedSurat?.nomorSurat}</strong>?
                            Surat akan hilang dari semua daftar. Hanya Super Admin yang dapat memulihkannya.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-1">
                        <Label htmlFor="alasan-hapus-surat-keluar">Alasan penghapusan <span className="text-destructive">*</span></Label>
                        <Textarea
                            id="alasan-hapus-surat-keluar"
                            value={alasanHapus}
                            onChange={(event) => setAlasanHapus(event.target.value)}
                            placeholder="Jelaskan alasan penghapusan surat ini (minimal 10 karakter)..."
                            rows={3}
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            disabled={alasanHapus.trim().length < 10}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Hapus
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
