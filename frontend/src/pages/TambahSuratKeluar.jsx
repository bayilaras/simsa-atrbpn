import { buildSuratFormPayload } from '@/lib/surat-form-payload'
import { buildSuratArchiveSelection, readSuratArchiveSelection, selectedSuratArchiveRules, validateSuratArchiveSelection } from '@/lib/surat-archive-selection'
import { archiveUploadError } from '@/lib/archive-upload';
import { createElement, useCallback, useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useAppConfig } from '@/context/app-config-context';
import { useToast } from '@/hooks/use-toast';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { suratKeluarService } from '@/services/surat-keluar.service';
import { suratMasukService } from '@/services/surat-masuk.service';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { KlasifikasiPicker } from '@/components/KlasifikasiPicker';
import { useRequiredUnitKerjaScope } from '@/hooks/use-required-unit-kerja-scope';
import { RequiredUnitKerjaScope } from '@/components/RequiredUnitKerjaScope';
import { buildOutgoingNumberingPayload } from '@/lib/surat-numbering';
import { ReferensiSection } from '@/components/surat-keluar/ReferensiSection';
import { toTindakLanjutPayload } from '@/lib/tindak-lanjut';
import {
    Card,
    CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Send,
    ChevronLeft,
    Save,
    Upload,
    FileText,
    Loader2,
    AlertCircle,
    X,
    Link as LinkIcon,
    Users,
    Calendar,
    Hash,
    FileType,
    FolderOpen,
    Info,
    CheckCircle2,
    Clock,
    Reply,
} from 'lucide-react';

// Naskah Dinas options
const NASKAH_DINAS_OPTIONS = [
    'Keputusan',
    'Surat Tugas',
    'Surat Perintah',
    'Nota Dinas',
    'Memorandum',
    'Surat Dinas',
    'Surat Undangan',
    'Surat Perjanjian/MoU',
    'Surat Kuasa',
    'Berita Acara',
    'Surat Keterangan',
    'Surat Pengantar',
    'Pemberitahuan',
    'Pengumuman',
    'Laporan',
    'Telaahan Staf',
    'Piagam',
    'Umum',
    'Naskah Dinas Arahan',
    'Naskah Dinas Korespondensi',
    'Naskah Dinas Khusus',
    'Naskah Dinas Lainnya',
    'Peraturan',
    'Pedoman',
    'Petunjuk Pelaksanaan',
    'Instruksi',
    'Prosedur Tetap (Protap)',
    'Surat Edaran',
    'Pengaduan',
    'Tindak Lanjut Pengaduan',
    'Surat Keputusan Hak Milik',
    'Surat Keputusan Hak Guna Usaha',
    'Surat Keputusan Hak Guna Bangunan',
    'Surat Keputusan Hak Pakai',
    'Surat Keputusan Hak Pengelolaan',
    'Surat Keputusan Hak Rumah Susun',
    'Surat Keputusan Hak Wakaf',
    'Permohonan Hak Milik',
    'Permohonan Hak Guna Usaha',
    'Permohonan Hak Guna Bangunan',
    'Permohonan Hak Pakai',
    'Permohonan Hak Pengelolaan',
    'Permohonan Hak Rumah Susun',
    'Permohonan Hak Wakaf',
    'Pembatalan Hak',
];

export default function TambahSuratKeluar({ mode: modeProp } = {}) {
    const { id } = useParams(); // Get ID from URL for edit mode
    const isEditMode = Boolean(id);
    const { user } = useAuth();
    const { capabilities } = useAppConfig();
    const { toast } = useToast();
    const reducedMotion = useReducedMotion();
    const filesEnabled = capabilities.letterFileUploads ?? capabilities.fileUploads;
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const mode = modeProp === 'inisiatif' ? 'inisiatif' : undefined;
    const naskahDariQuery = mode === 'inisiatif' && NASKAH_DINAS_OPTIONS.includes(searchParams.get('naskah') || '')
        ? searchParams.get('naskah') : '';
    const fileInputRef = useRef(null);
    const errorRef = useRef(null);
    const saveLockedRef = useRef(false);
    const navigationTimerRef = useRef(null);
    const mountedRef = useRef(true);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [fieldErrors, setFieldErrors] = useState({});
    const [success, setSuccess] = useState(false);
    const saveLocked = isSubmitting || success;
    const [selectedFile, setSelectedFile] = useState(null);
    const [existingFile, setExistingFile] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [recordUnitKerjaId, setRecordUnitKerjaId] = useState('');
    const [numberPreview, setNumberPreview] = useState(null);
    const [editLocked, setEditLocked] = useState(false);
    const unitScope = useRequiredUnitKerjaScope(user, {
        fixedUnitKerjaId: isEditMode ? recordUnitKerjaId : '',
    });
    const resolvedUnitKerjaId = isEditMode ? recordUnitKerjaId : unitScope.unitKerjaId;
    const { setDirty, resetDirty } = useUnsavedChanges();

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            clearTimeout(navigationTimerRef.current);
        };
    }, []);

    useEffect(() => {
        if (!error || isLoading) return;
        errorRef.current?.focus();
        errorRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    }, [error, fieldErrors, isLoading, reducedMotion]);

    // Nomor Referensi (Lacak mode=referensi) atau chip terkunci dari menu Tindak Lanjut / Kotak Disposisi
    const [referensi, setReferensi] = useState(null);

    // Form state
    const [formData, setFormData] = useState({
        naskahDinas: naskahDariQuery,
        nomorSurat: '',
        tanggalSurat: '',
        perihal: '',
        kepada: '',
        klasifikasiFasilitatif: '',
        klasifikasiFasilitatifKode: '',
        klasifikasiSubstantif: '',
        klasifikasiSubstantifKode: '',
        ...readSuratArchiveSelection(),
        klasifikasiKeamanan: 'biasa',
        linkDokumen: '',
        balasanUntuk: null,
    });
    const archiveRules = selectedSuratArchiveRules(formData);

    // Prefill dari menu Tindak Lanjut / Kotak Disposisi (state.tindakLanjut) atau klien lama (state.replyTo).
    useEffect(() => {
        if (isEditMode) return;
        const state = location.state;
        const tindakLanjut = state?.tindakLanjut ?? (state?.replyTo ? {
            jenis: 'surat_masuk', suratId: state.replyTo.id, nomorSurat: state.replyTo.nomorSurat,
            perihal: state.replyTo.perihal, jenisRelasi: 'balasan', terkunci: true,
        } : null);
        if (!tindakLanjut) return;
        const preset = state?.preset ?? (state?.replyTo ? { perihal: `Balasan: ${state.replyTo.perihal || ''}`, kepada: state.replyTo.dari || '' } : {});
        setReferensi(tindakLanjut);
        setFormData(prev => ({ ...prev, ...preset }));
        setDirty();
    }, [location.state, isEditMode, setDirty]);

    const fetchSuratData = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await suratKeluarService.getById(id);
            // getById now succeeds cross-unit and reports how: 'owner' for the
            // owning unit, anything else (e.g. via a rangkaian as pengawas or
            // peserta) is read-only. Never populate the form for a record we
            // cannot mutate -- send the reader to the detail page instead.
            if (data.aksesMelalui && data.aksesMelalui !== 'owner') {
                toast({
                    title: 'Tidak dapat diubah',
                    description: 'Surat ini hanya dapat dilihat, tidak dapat diubah.',
                    variant: 'destructive',
                });
                navigate(`/surat/keluar/${id}`);
                return;
            }
            if (!['draft', 'rejected'].includes(data.approvalStatus || 'draft')) {
                setEditLocked(true);
                return;
            }
            if (Array.isArray(data.aksiDiizinkan) && !data.aksiDiizinkan.includes('edit')) {
                toast({
                    title: 'Tidak dapat diubah',
                    description: 'Surat ini tidak dapat diubah dari unit Anda',
                    variant: 'destructive',
                });
                navigate(`/surat/keluar/${id}`, { replace: true });
                return;
            }
            setRecordUnitKerjaId(data.unitKerjaId || '');
            // Map fetched data to form fields
            setFormData({
                naskahDinas: data.naskahDinas || '',
                nomorSurat: data.nomorSurat || '',
                tanggalSurat: data.tanggalSurat ? data.tanggalSurat.split('T')[0] : '',
                perihal: data.perihal || '',
                kepada: data.kepada || '',
                klasifikasiFasilitatif: data.klasifikasiFasilitatif || '',
                klasifikasiFasilitatifKode: data.klasifikasiFasilitatifKode || '',
                klasifikasiSubstantif: data.klasifikasiSubstantif || '',
                klasifikasiSubstantifKode: data.klasifikasiSubstantifKode || '',
                ...readSuratArchiveSelection(data),
                // Historical rows without explicit metadata remain fail-closed.
                klasifikasiKeamanan: data.klasifikasiKeamanan || 'terbatas',
                linkDokumen: data.linkDokumen || '',
                balasanUntuk: data.balasanUntuk || null,
            });
            // Track existing file info
            if (data.filePath) {
                setExistingFile({
                    path: data.filePath,
                    name: data.fileOriginalName || (data.filePath.startsWith('blob:') || data.filePath.startsWith('gdrive:') ? 'Dokumen Lampiran' : data.filePath.split('/').pop()),
                });
            }
            if (data.balasanUntuk) {
                try {
                    const suratMasuk = await suratMasukService.getById(data.balasanUntuk);
                    setReferensi({ jenis: 'surat_masuk', suratId: suratMasuk.id, nomorSurat: suratMasuk.nomorSurat,
                        perihal: suratMasuk.perihal, jenisRelasi: 'balasan', terkunci: true });
                } catch (err) {
                    console.error('Error fetching related surat masuk:', err);
                }
            }
        } catch (err) {
            console.error('Error fetching surat data:', err);
            setError('Gagal memuat data surat');
        } finally {
            setIsLoading(false);
        }
    }, [id, navigate, toast]);

    // Fetch existing data for edit mode.
    useEffect(() => {
        if (isEditMode && id) {
            void fetchSuratData();
        }
    }, [fetchSuratData, id, isEditMode]);

    useEffect(() => {
        if (
            isEditMode
            || !resolvedUnitKerjaId
            || !formData.tanggalSurat
            || !formData.naskahDinas
        ) return;
        let active = true;
        suratKeluarService.getNextNumber({
            unitKerjaId: resolvedUnitKerjaId,
            tahun: Number(formData.tanggalSurat.slice(0, 4)),
            tanggalSurat: formData.tanggalSurat,
            naskahDinas: formData.naskahDinas,
        }).then((preview) => {
            if (!active) return;
            setNumberPreview({
                ...preview,
                unitKerjaId: resolvedUnitKerjaId,
                tanggalSurat: formData.tanggalSurat,
                naskahDinas: formData.naskahDinas,
            });
        }).catch(() => {
            // The create transaction remains authoritative if preview is unavailable.
        });
        return () => { active = false; };
    }, [formData.naskahDinas, formData.tanggalSurat, isEditMode, resolvedUnitKerjaId]);

    // Handle input changes
    const handleChange = (field, value) => {
        if (saveLockedRef.current) return;
        setFormData(prev => ({ ...prev, [field]: value }));
        setError(null);
        setFieldErrors(prev => ({ ...prev, [field]: undefined }));
        setDirty();
    };

    // Handle file selection
    const handleFileSelect = (e) => {
        if (saveLockedRef.current) return;
        const file = e.target.files?.[0];
        if (file) {
            const validationError = archiveUploadError(file);
            if (validationError) {
                setError(validationError);
                return;
            }
            setSelectedFile(file);
            setError(null);
            setFieldErrors(prev => ({ ...prev, linkDokumen: undefined }));
            setDirty();
        }
    };

    // Remove selected file
    const removeFile = () => {
        if (saveLockedRef.current) return;
        setSelectedFile(null);
        setDirty();
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // Validate form
    const validateForm = () => {
        if (!resolvedUnitKerjaId) return { message: 'Pilih unit kerja terlebih dahulu' };
        const archiveSelectionError = validateSuratArchiveSelection(formData);
        if (archiveSelectionError) return { message: archiveSelectionError };
        if (!formData.naskahDinas) return { field: 'naskahDinas', message: 'Naskah Dinas wajib diisi' };
        if (!formData.tanggalSurat) return { message: 'Tanggal Surat wajib diisi' };
        if (!formData.perihal) return { message: 'Perihal wajib diisi' };
        // For edit mode, allow existing file or link
        if (filesEnabled && !formData.linkDokumen && !selectedFile && !existingFile) {
            return { field: 'linkDokumen', message: 'Link dokumen atau upload berkas wajib diisi (salah satu)' };
        }
        return null;
    };

    // Handle form submission
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (saveLockedRef.current) return;

        const validationError = validateForm();
        if (validationError) {
            setError(validationError.message);
            setFieldErrors(validationError.field ? { [validationError.field]: validationError.message } : {});
            return;
        }

        // Lock synchronously: consecutive submit events can precede React's next render.
        saveLockedRef.current = true;
        setIsSubmitting(true);
        setError(null);
        setFieldErrors({});

        try {
            const dataToSubmit = buildSuratFormPayload(formData, resolvedUnitKerjaId, filesEnabled);

            if (isEditMode) {
                // Tahun tidak dikirim saat edit agar tahun asli surat tidak tertimpa
                await suratKeluarService.update(id, dataToSubmit, filesEnabled ? selectedFile : null);
            } else {
                // Create new surat
                const { balasanUntuk: _balasanLama, ...tanpaBalasan } = dataToSubmit;
                await suratKeluarService.create({
                    ...tanpaBalasan,
                    ...buildOutgoingNumberingPayload(formData.nomorSurat),
                    tahun: Number(formData.tanggalSurat?.slice(0, 4)) || new Date().getFullYear(),
                    // Tanpa referensi -> selalu inisiatif (spec:51,69), terlepas dari `mode`;
                    // dengan referensi -> tindakLanjut, server menetapkan asalNaskah: 'tindak_lanjut'.
                    ...(referensi ? { tindakLanjut: toTindakLanjutPayload(referensi) } : { asalNaskah: 'inisiatif' }),
                }, filesEnabled ? selectedFile : null);
            }
            if (!mountedRef.current) return;
            resetDirty();
            setSuccess(true);

            navigationTimerRef.current = setTimeout(() => {
                navigate('/surat/keluar', {
                    state: { message: isEditMode ? 'Surat keluar berhasil diperbarui' : 'Surat keluar berhasil ditambahkan' }
                });
            }, 1500);
        } catch (err) {
            if (!mountedRef.current) return;
            saveLockedRef.current = false;
            setError(err.message || 'Gagal menyimpan surat keluar');
        } finally {
            if (mountedRef.current) setIsSubmitting(false);
        }
    };

    const formatFileSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    // Section Header Component
    const SectionHeader = ({ icon, title, description, step }) => (
        <div className="flex items-start gap-3 pb-4 border-b border-border/50">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                {createElement(icon, { className: 'h-4 w-4 text-emerald-600', 'aria-hidden': true })}
            </div>

            <div className="flex-1">
                <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">{title}</h3>
                    {step && (
                        <Badge variant="outline" className="text-xs border-emerald-200 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15">
                            Langkah {step}
                        </Badge>
                    )}
                </div>
                {description && (
                    <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
                )}
            </div>
        </div>
    );

    // Scroll to top on mount
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    // Progress Scroll Indicator
    const [scrollProgress, setScrollProgress] = useState(0);
    useEffect(() => {
        const handleScroll = () => {
            const totalScroll = document.documentElement.scrollTop;
            const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
            const scroll = `${totalScroll / windowHeight}`;
            setScrollProgress(Number(scroll));
        }
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    if (isEditMode && isLoading) {
        return (
            <div role="status" aria-live="polite" className="flex min-h-[40vh] items-center justify-center gap-3 text-muted-foreground">
                <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
                Memuat data surat keluar…
            </div>
        );
    }

    if (isEditMode && editLocked) {
        return (
            <div className="mx-auto max-w-xl space-y-4 py-12 text-center">
                <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                        Surat yang sedang atau telah disetujui bersifat terkunci. Buka halaman detail untuk melihat alur persetujuan.
                    </AlertDescription>
                </Alert>
                <Button asChild>
                    <Link to={`/surat/keluar/${id}`}>Kembali ke Detail Surat</Link>
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-24 relative">
            {/* Sticky Progress Bar */}
            <div className="fixed top-0 left-0 right-0 h-1 bg-muted z-50">
                <div
                    className="h-full bg-emerald-600 transition-all duration-150"
                    style={{ width: `${scrollProgress * 100}%` }}
                />
            </div>

            {/* Header */}
            <div className="flex items-center gap-4 pt-4">
                <Button asChild variant="ghost" size="icon" className="rounded-full hover:bg-emerald-500/10">
                    <Link to="/surat/keluar" aria-label="Kembali ke daftar surat keluar">
                        <ChevronLeft className="h-5 w-5" />
                    </Link>
                </Button>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 border border-emerald-500/20">
                            <Send className="h-6 w-6 text-emerald-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">
                                {isEditMode ? 'Edit Surat Keluar' : 'Tambah Surat Keluar'}
                            </h1>
                            <p className="text-muted-foreground text-sm">
                                {isEditMode ? 'Ubah data surat keluar' : 'Registrasi surat keluar baru ke sistem'}
                            </p>
                        </div>
                    </div>
                </div>
                <Badge variant="outline" className="hidden sm:flex gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Badge>
            </div>

            <RequiredUnitKerjaScope
                scope={unitScope}
                disabled={isEditMode || saveLocked}
            />

            {/* Error/Success Alerts */}
            {error && (
                <Alert ref={errorRef} tabIndex={-1} variant="destructive" className="animate-in slide-in-from-top-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {success && (
                <Alert className="border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 animate-in slide-in-from-top-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                        <span className="font-medium">Berhasil!</span> Surat keluar telah disimpan ke sistem.
                    </AlertDescription>
                </Alert>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
                <fieldset disabled={saveLocked} className="min-w-0 space-y-6">
                {/* Section 1: Nomor Referensi / Asal Naskah */}
                <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="p-6 space-y-5">
                        <SectionHeader
                            icon={Reply}
                            title={mode === 'inisiatif' ? 'Asal Naskah' : 'Nomor Referensi'}
                            description={mode === 'inisiatif'
                                ? 'Surat inisiatif memulai rangkaian baru'
                                : 'Kaitkan dengan surat masuk atau surat keluar yang ditindaklanjuti (opsional)'}
                        />
                        <ReferensiSection
                            mode={mode}
                            referensi={referensi}
                            onPilih={(pilihan) => { if (saveLockedRef.current) return; setReferensi(pilihan); setDirty(); }}
                            onHapus={() => { if (saveLockedRef.current) return; setReferensi(null); setDirty(); }}
                            onUbahRelasi={(jenisRelasi) => setReferensi(prev => (prev ? { ...prev, jenisRelasi } : prev))}
                            disabled={saveLocked || isEditMode || !resolvedUnitKerjaId}
                            autoOpen={!isEditMode && searchParams.get('pilih') === 'referensi'}
                        />
                    </CardContent>
                </Card>

                {/* Section 2: Jenis Naskah Dinas */}
                <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="p-6 space-y-5">
                        <SectionHeader
                            icon={FileType}
                            title="Jenis Naskah Dinas"
                            description="Pilih jenis naskah dinas yang akan dikirim"
                            step={1}
                        />

                        <div className="space-y-2">
                            <Label htmlFor="naskah-dinas" className="text-sm font-medium flex items-center gap-2">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                Naskah Dinas <span className="text-destructive">*</span>
                            </Label>
                            <SearchableSelect
                                id="naskah-dinas"
                                ariaLabel="Jenis naskah dinas"
                                aria-invalid={Boolean(fieldErrors.naskahDinas)}
                                aria-describedby={fieldErrors.naskahDinas ? 'naskah-dinas-error' : undefined}
                                disabled={saveLocked}
                                options={NASKAH_DINAS_OPTIONS}
                                value={formData.naskahDinas}
                                onValueChange={(v) => handleChange('naskahDinas', v)}
                                placeholder="Pilih jenis naskah dinas..."
                                searchPlaceholder="Cari jenis naskah dinas..."
                            />
                            {fieldErrors.naskahDinas && <p id="naskah-dinas-error" className="text-sm text-destructive">{fieldErrors.naskahDinas}</p>}
                        </div>
                    </CardContent>
                </Card>

                {/* Section 3: Identitas Surat */}
                <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="p-6 space-y-5">
                        <SectionHeader
                            icon={Hash}
                            title="Identitas Surat"
                            description="Nomor, tanggal, dan perihal surat keluar"
                            step={2}
                        />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="space-y-2">
                                <Label htmlFor="nomor-surat-keluar" className="text-sm font-medium flex items-center gap-2">
                                    <Hash className="h-4 w-4 text-muted-foreground" />
                                    Nomor Surat
                                </Label>
                                <Input
                                    id="nomor-surat-keluar"
                                    value={formData.nomorSurat}
                                    onChange={(e) => handleChange('nomorSurat', e.target.value)}
                                    placeholder="Kosongkan untuk nomor otomatis"
                                    className="h-11 focus-visible:ring-emerald-500"
                                />
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Info className="h-3 w-3" />
                                    Jika kosong, nomor dibuat dari template unit di dalam transaksi; nomor manual tetap dipertahankan.
                                </p>
                                {numberPreview?.unitKerjaId === resolvedUnitKerjaId
                                    && numberPreview?.tanggalSurat === formData.tanggalSurat
                                    && numberPreview?.naskahDinas === formData.naskahDinas
                                    && numberPreview?.nomorSurat && (
                                    <p className="text-xs text-emerald-700 dark:text-emerald-300">Preview dari template unit: <code>{numberPreview.nomorSurat}</code></p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="tanggal-surat-keluar" className="text-sm font-medium flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-muted-foreground" />
                                    Tanggal Surat <span className="text-destructive">*</span>
                                </Label>
                                <Input
                                    id="tanggal-surat-keluar"
                                    type="date"
                                    required
                                    value={formData.tanggalSurat}
                                    onChange={(e) => handleChange('tanggalSurat', e.target.value)}
                                    className="h-11 focus-visible:ring-emerald-500"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="perihal-surat-keluar" className="text-sm font-medium">
                                Perihal <span className="text-destructive">*</span>
                            </Label>
                            <Textarea
                                id="perihal-surat-keluar"
                                required
                                value={formData.perihal}
                                onChange={(e) => handleChange('perihal', e.target.value)}
                                placeholder="Tuliskan perihal/hal surat..."
                                rows={3}
                                className="resize-none focus-visible:ring-emerald-500"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Section 4: Tujuan Surat */}
                <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="p-6 space-y-5">
                        <SectionHeader
                            icon={Users}
                            title="Tujuan Surat"
                            description="Penerima surat keluar"
                            step={3}
                        />

                        <div className="space-y-2">
                            <Label htmlFor="penerima-surat-keluar" className="text-sm font-medium flex items-center gap-2">
                                <Users className="h-4 w-4 text-muted-foreground" />
                                Kepada
                            </Label>
                            <Input
                                id="penerima-surat-keluar"
                                value={formData.kepada}
                                onChange={(e) => handleChange('kepada', e.target.value)}
                                placeholder="Instansi/nama penerima surat"
                                className="h-11 focus-visible:ring-emerald-500"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Section 5: Klasifikasi Arsip */}
                <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="p-6 space-y-5">
                        <SectionHeader
                            icon={FolderOpen}
                            title="Klasifikasi Arsip"
                            description="Pengelompokan untuk kebutuhan kearsipan (opsional)"
                            step={4}
                        />

                        <div className="grid gap-5 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="klasifikasi-surat-keluar" className="text-sm font-medium flex items-center gap-2">
                                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                                    Klasifikasi
                                </Label>
                                <KlasifikasiPicker
                                    id="klasifikasi-surat-keluar"
                                    value={formData.klasifikasiFasilitatifKode || formData.klasifikasiSubstantifKode}
                                    selectedClassification={archiveRules.classification}
                                    selectedRetention={archiveRules.retention}
                                    disabled={saveLocked}
                                    onChange={(kode, klasifikasi, jra) => {
                                        if (saveLockedRef.current) return;
                                        setFormData(prev => ({
                                            ...prev,
                                            ...buildSuratArchiveSelection(kode, klasifikasi, jra, 'keluar'),
                                        }));
                                        setError(null);
                                        setDirty();
                                    }}
                                    label="Klik untuk memilih klasifikasi arsip..."
                                />
                                <p className="text-xs text-muted-foreground">
                                    Pilih pasangan klasifikasi dan JRA. Pilihan ini diteruskan saat surat diberkaskan menjadi arsip; perhitungan retensi mengikuti pemicu yang dicatat pada siklus hidup arsip.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="klasifikasi-keamanan-surat-keluar" className="text-sm font-medium">
                                    Klasifikasi Keamanan <span className="text-destructive">*</span>
                                </Label>
                                <Select
                                    value={formData.klasifikasiKeamanan}
                                    onValueChange={(value) => handleChange('klasifikasiKeamanan', value)}
                                >
                                    <SelectTrigger id="klasifikasi-keamanan-surat-keluar" aria-label="Klasifikasi keamanan">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="biasa">Biasa / Terbuka</SelectItem>
                                        <SelectItem value="terbatas">Terbatas</SelectItem>
                                        <SelectItem value="rahasia">Rahasia</SelectItem>
                                        <SelectItem value="sangat_rahasia">Sangat Rahasia</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Rekod Terbatas atau lebih tinggi memerlukan persetujuan akses berjangka sebelum dapat ditayangkan atau dikelola.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Section 6: Lampiran Dokumen */}
                {filesEnabled && (
                <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="p-6 space-y-5">
                        <SectionHeader
                            icon={Upload}
                            title="Lampiran Dokumen"
                            description="Unggah berkas atau masukkan link dokumen"
                            step={5}
                        />

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="link-dokumen-keluar" className="text-sm font-medium flex items-center gap-2">
                                    <LinkIcon className="h-4 w-4 text-muted-foreground" />
                                    Link Dokumen
                                </Label>
                                <Input
                                    id="link-dokumen-keluar"
                                    aria-invalid={Boolean(fieldErrors.linkDokumen)}
                                    aria-describedby={fieldErrors.linkDokumen ? 'link-dokumen-keluar-error' : undefined}
                                    value={formData.linkDokumen}
                                    onChange={(e) => handleChange('linkDokumen', e.target.value)}
                                    placeholder="https://drive.google.com/..."
                                    className="h-11 focus-visible:ring-emerald-500"
                                />
                            </div>

                            {fieldErrors.linkDokumen && <p id="link-dokumen-keluar-error" className="text-sm text-destructive">{fieldErrors.linkDokumen}</p>}
                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t border-border/50" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-card px-2 text-muted-foreground">atau</span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="berkas-surat-keluar" className="text-sm font-medium flex items-center gap-2">
                                    <Upload className="h-4 w-4 text-muted-foreground" />
                                    Upload Berkas
                                </Label>
                                <div
                                    className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all ${selectedFile
                                        ? 'cursor-default border-emerald-400 bg-emerald-50/50'
                                        : isDragging
                                            ? 'cursor-pointer border-emerald-500 bg-emerald-500/5 scale-[1.02] shadow-lg'
                                            : 'cursor-pointer border-border hover:border-emerald-300 hover:bg-emerald-50/30 group'
                                        }`}
                                    onClick={() => !selectedFile && fileInputRef.current?.click()}
                                    role={selectedFile ? undefined : 'button'}
                                    tabIndex={selectedFile || saveLocked ? undefined : 0}
                                    aria-label={selectedFile ? undefined : 'Pilih berkas untuk diunggah'}
                                    aria-disabled={saveLocked}
                                    aria-invalid={Boolean(fieldErrors.linkDokumen)}
                                    aria-describedby={fieldErrors.linkDokumen ? 'link-dokumen-keluar-error' : undefined}
                                    onKeyDown={selectedFile ? undefined : (e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            fileInputRef.current?.click();
                                        }
                                    }}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    }}
                                    onDragEnter={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setIsDragging(true);
                                    }}
                                    onDragLeave={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setIsDragging(false);
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setIsDragging(false);
                                        handleFileSelect({ target: { files: e.dataTransfer.files } });
                                    }}
                                >
                                    <input
                                        id="berkas-surat-keluar"
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".pdf,application/pdf"
                                        onChange={handleFileSelect}
                                        className="hidden"
                                    />
                                    {selectedFile ? (
                                        <div className="flex flex-wrap items-center justify-center gap-3">
                                            <div className="p-2 bg-emerald-100 dark:bg-emerald-500/15 rounded-lg">
                                                <FileText className="h-6 w-6 text-emerald-600" />
                                            </div>
                                            <div className="text-left">
                                                <p className="font-medium text-emerald-700 dark:text-emerald-300">{selectedFile.name}</p>
                                                <p className="text-sm text-emerald-600">{formatFileSize(selectedFile.size)}</p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => fileInputRef.current?.click()}
                                            >
                                                Ganti berkas
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="ml-2 hover:bg-red-100 dark:hover:bg-red-500/15 hover:text-red-600 dark:hover:text-red-400"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    removeFile();
                                                }}
                                            >
                                                <X className="h-4 w-4" />
                                                <span className="sr-only">Hapus berkas {selectedFile.name}</span>
                                            </Button>
                                        </div>
                                    ) : isDragging ? (
                                        <div className="space-y-2">
                                            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center animate-pulse">
                                                <Upload className="h-6 w-6 text-emerald-600" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-emerald-600">
                                                    Lepaskan file di sini
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="mx-auto w-12 h-12 rounded-full bg-muted group-hover:bg-emerald-500/10 flex items-center justify-center transition-colors">
                                                <Upload className="h-6 w-6 text-muted-foreground group-hover:text-emerald-600 transition-colors" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-foreground">
                                                    Seret file ke sini atau klik untuk memilih berkas
                                                </p>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    PDF (maks. 10 MiB)
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-100">
                                <Info className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                                    <strong>Catatan:</strong> Salah satu dari link dokumen atau upload berkas wajib diisi.
                                    Anda dapat mengisi keduanya jika diperlukan.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                )}

                {/* Floating Action Bar */}
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-card/80 backdrop-blur-md border-t border-border/50 z-40 flex items-center justify-end gap-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                    <Button type="button" variant="outline" size="lg" disabled={saveLocked} onClick={() => navigate('/surat/keluar')} className="rounded-full px-6">
                        Batal
                    </Button>
                    <Button
                        type="submit"
                        size="lg"
                        disabled={saveLocked || !resolvedUnitKerjaId || unitScope.loading}
                        className="min-w-[140px] bg-emerald-600 hover:bg-emerald-700 rounded-full px-8 shadow-lg shadow-emerald-600/20 hover:shadow-emerald-600/40 transition-all"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Menyimpan...
                            </>
                        ) : (
                            <>
                                <Save className="h-4 w-4 mr-2" />
                                {success ? 'Tersimpan' : isEditMode ? 'Perbarui' : 'Simpan'}
                            </>
                        )}
                    </Button>
                </div>
                </fieldset>
            </form>
        </div>
    );
}
