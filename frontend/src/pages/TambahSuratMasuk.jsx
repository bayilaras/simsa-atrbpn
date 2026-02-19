import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { suratMasukService } from '@/services/surat-masuk.service';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useAutoSave } from '@/hooks/useAutoSave';
import { KlasifikasiPicker } from '@/components/KlasifikasiPicker';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
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
import { MultiSelect } from '@/components/ui/multi-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    MailOpen,
    ChevronLeft,
    Save,
    Upload,
    FileText,
    Loader2,
    AlertCircle,
    X,
    Link as LinkIcon,
    User,
    Users,
    Calendar,
    Hash,
    FileType,
    Zap,
    FolderOpen,
    ArrowRight,
    Info,
    CheckCircle2,
    Clock
} from 'lucide-react';

// Jenis Surat options
const JENIS_SURAT_OPTIONS = [
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

// Sifat Surat options with colors
const SIFAT_SURAT_OPTIONS = [
    { value: 'biasa', label: 'Biasa', color: 'bg-slate-100 text-slate-700 border-slate-200' },
    { value: 'segera', label: 'Segera', color: 'bg-amber-100 text-amber-700 border-amber-200' },
    { value: 'sangat_segera', label: 'Sangat Segera', color: 'bg-red-100 text-red-700 border-red-200' },
    { value: 'rahasia', label: 'Rahasia', color: 'bg-purple-100 text-purple-700 border-purple-200' },
    { value: 'undangan', label: 'Undangan', color: 'bg-blue-100 text-blue-700 border-blue-200' },
    { value: 'penting', label: 'Penting', color: 'bg-orange-100 text-orange-700 border-orange-200' },
];

// Keterangan options
const KETERANGAN_OPTIONS = [
    { value: 'penanggung_jawab', label: 'Penanggung Jawab', icon: '👔' },
    { value: 'tembusan', label: 'Tembusan', icon: '📋' },
    { value: 'disposisi_menteri', label: 'Disposisi Menteri', icon: '📜' },
];

// Disposisi options
const DISPOSISI_OPTIONS = [
    'Ditjen',
    'SekDitjen',
    'Dit. BPPT',
    'Dit. PTEP',
    'Dit. KTPP',
    'Kabag Program dan Hukum',
    'Kabag Kepegawaian Keuangan dan Umum',
];

export default function TambahSuratMasuk() {
    const { id } = useParams(); // Get ID from URL for edit mode
    const isEditMode = Boolean(id);
    const { user } = useAuth();
    const navigate = useNavigate();
    const fileInputRef = useRef(null);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [existingFile, setExistingFile] = useState(null);

    // Unsaved changes warning & auto-save draft
    const { isDirty, setDirty, resetDirty } = useUnsavedChanges();
    const { saveDraft, clearDraft, restoreDraft, saveStatus } = useAutoSave('tambah-surat-masuk');

    // Form state
    const [formData, setFormData] = useState({
        jenisSurat: '',
        sifatSurat: 'biasa',
        nomorSurat: '',
        tanggalSurat: '',
        perihal: '',
        dari: '',
        kepada: '',
        klasifikasiKode: '',
        klasifikasiUraian: '',
        jraKode: '',
        jraUraian: '',
        jraRetensiAktif: '',
        jraRetensiInaktif: '',
        jraKeterangan: '',
        keterangan: '',
        disposisi: [],
        linkDokumen: '',
    });

    // Restore draft on mount (only for new entries, not edit mode)
    useEffect(() => {
        if (!isEditMode) {
            const draft = restoreDraft();
            if (draft) {
                const shouldRestore = window.confirm('Ditemukan draft yang belum disimpan. Muat draft tersebut?');
                if (shouldRestore) {
                    setFormData(draft);
                } else {
                    clearDraft();
                }
            }
        }
    }, []);

    // Fetch existing data for edit mode
    useEffect(() => {
        if (isEditMode && id) {
            fetchSuratData();
        }
    }, [id, isEditMode]);

    const fetchSuratData = async () => {
        setIsLoading(true);
        try {
            const data = await suratMasukService.getById(id);
            // Map fetched data to form fields
            setFormData({
                jenisSurat: data.jenisSurat || '',
                sifatSurat: data.sifatSurat || 'biasa',
                nomorSurat: data.nomorSurat || '',
                tanggalSurat: data.tanggalSurat ? data.tanggalSurat.split('T')[0] : '',
                perihal: data.perihal || '',
                dari: data.dari || '',
                kepada: data.kepada || '',
                klasifikasiKode: data.klasifikasiKode || '',
                klasifikasiUraian: data.klasifikasiUraian || '',
                jraKode: data.jraKode || '',
                jraUraian: data.jraUraian || '',
                jraRetensiAktif: data.jraRetensiAktif || '',
                jraRetensiInaktif: data.jraRetensiInaktif || '',
                jraKeterangan: data.jraKeterangan || '',
                keterangan: data.keterangan || '',
                disposisi: Array.isArray(data.disposisi) ? data.disposisi : (data.disposisi ? [data.disposisi] : []),
                linkDokumen: data.linkDokumen || '',
            });
            // Track existing file info
            if (data.filePath) {
                setExistingFile({
                    path: data.filePath,
                    name: data.fileOriginalName || data.filePath.split('/').pop(),
                });
            }
        } catch (err) {
            console.error('Error fetching surat data:', err);
            setError('Gagal memuat data surat');
        } finally {
            setIsLoading(false);
        }
    };

    // Handle input changes
    const handleChange = (field, value) => {
        setFormData(prev => {
            const updated = { ...prev, [field]: value };
            saveDraft(updated);
            return updated;
        });
        setError(null);
        setDirty();
    };

    // Handle file selection
    const handleFileSelect = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'];
            if (!allowedTypes.includes(file.type)) {
                setError('Tipe file tidak didukung. Gunakan PDF, DOC, DOCX, JPG, atau PNG.');
                return;
            }
            if (file.size > 10 * 1024 * 1024) {
                setError('Ukuran file maksimal 10MB');
                return;
            }
            setSelectedFile(file);
            setError(null);
        }
    };

    // Remove selected file
    const removeFile = () => {
        setSelectedFile(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // Validate form
    const validateForm = () => {
        if (!formData.jenisSurat) return 'Jenis Surat wajib diisi';
        if (!formData.nomorSurat) return 'Nomor Surat wajib diisi';
        if (!formData.tanggalSurat) return 'Tanggal Surat wajib diisi';
        if (!formData.perihal) return 'Perihal wajib diisi';
        if (!formData.dari) return 'Pengirim (Dari) wajib diisi';
        if (!formData.kepada) return 'Penerima (Kepada) wajib diisi';
        if (!formData.disposisi || formData.disposisi.length === 0) return 'Disposisi wajib diisi';
        // For edit mode, allow existing file or link
        if (!formData.linkDokumen && !selectedFile && !existingFile) {
            return 'Link dokumen atau upload berkas wajib diisi (salah satu)';
        }
        return null;
    };

    // Handle form submission
    const handleSubmit = async (e) => {
        e.preventDefault();

        const validationError = validateForm();
        if (validationError) {
            setError(validationError);
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const dataToSubmit = {
                ...formData,
                unitKerjaId: user?.unitKerjaId || 'ditjen',
                tahun: new Date().getFullYear(),
            };

            if (isEditMode) {
                // Update existing surat (with optional file)
                await suratMasukService.update(id, dataToSubmit, selectedFile);
            } else {
                // Create new surat
                await suratMasukService.create(dataToSubmit, selectedFile);
            }
            resetDirty();
            clearDraft();
            setSuccess(true);

            setTimeout(() => {
                navigate('/surat/masuk', {
                    state: { message: isEditMode ? 'Surat masuk berhasil diperbarui' : 'Surat masuk berhasil ditambahkan' }
                });
            }, 1500);
        } catch (err) {
            setError(err.message || 'Gagal menyimpan surat masuk');
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatFileSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const getSifatColor = (value) => {
        return SIFAT_SURAT_OPTIONS.find(o => o.value === value)?.color || '';
    };

    // Section Header Component
    const SectionHeader = ({ icon: Icon, title, description, step }) => (
        <div className="flex items-start gap-3 pb-4 border-b border-border/50">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Icon className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1">
                <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">{title}</h3>
                    {step && (
                        <Badge variant="outline" className="text-xs">
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

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-24 relative">
            {/* Sticky Progress Bar */}
            <div className="fixed top-0 left-0 right-0 h-1 bg-slate-100 z-50">
                <div
                    className="h-full bg-primary transition-all duration-150"
                    style={{ width: `${scrollProgress * 100}%` }}
                />
            </div>

            {/* Header */}
            <div className="flex items-center gap-4 pt-4">
                <Link to="/surat/masuk">
                    <Button variant="ghost" size="icon" className="rounded-full hover:bg-primary/10">
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                            <MailOpen className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">
                                {isEditMode ? 'Edit Surat Masuk' : 'Tambah Surat Masuk'}
                            </h1>
                            <p className="text-muted-foreground text-sm">
                                {isEditMode ? 'Ubah data surat masuk' : 'Registrasi surat masuk baru ke sistem'}
                            </p>
                        </div>
                    </div>
                </div>
                <Badge variant="outline" className="hidden sm:flex gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Badge>
            </div>

            {/* Error/Success Alerts */}
            {error && (
                <Alert variant="destructive" className="animate-in slide-in-from-top-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {success && (
                <Alert className="border-emerald-500 bg-emerald-50 text-emerald-700 animate-in slide-in-from-top-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                        <span className="font-medium">Berhasil!</span> Surat masuk telah disimpan ke sistem.
                    </AlertDescription>
                </Alert>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Section 1: Jenis & Klasifikasi Surat */}
                <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="p-6 space-y-5">
                        <SectionHeader
                            icon={FileType}
                            title="Jenis & Sifat Surat"
                            description="Tentukan kategori dan prioritas surat"
                            step={1}
                        />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="space-y-2">
                                <Label className="text-sm font-medium flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-muted-foreground" />
                                    Jenis Surat <span className="text-destructive">*</span>
                                </Label>
                                <SearchableSelect
                                    options={JENIS_SURAT_OPTIONS}
                                    value={formData.jenisSurat}
                                    onValueChange={(v) => handleChange('jenisSurat', v)}
                                    placeholder="Pilih jenis naskah dinas..."
                                    searchPlaceholder="Cari jenis surat..."
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-sm font-medium flex items-center gap-2">
                                    <Zap className="h-4 w-4 text-muted-foreground" />
                                    Sifat Surat <span className="text-destructive">*</span>
                                </Label>
                                <SearchableSelect
                                    options={SIFAT_SURAT_OPTIONS.map(opt => ({ value: opt.value, label: opt.label }))}
                                    value={formData.sifatSurat}
                                    onValueChange={(v) => handleChange('sifatSurat', v)}
                                    placeholder="Pilih sifat surat..."
                                    searchPlaceholder="Cari sifat surat..."
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Section 2: Identitas Surat */}
                <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="p-6 space-y-5">
                        <SectionHeader
                            icon={Hash}
                            title="Identitas Surat"
                            description="Nomor, tanggal, dan perihal surat"
                            step={2}
                        />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="space-y-2">
                                <Label className="text-sm font-medium flex items-center gap-2">
                                    <Hash className="h-4 w-4 text-muted-foreground" />
                                    Nomor Surat <span className="text-destructive">*</span>
                                </Label>
                                <Input
                                    value={formData.nomorSurat}
                                    onChange={(e) => handleChange('nomorSurat', e.target.value)}
                                    placeholder="Contoh: S-123/PTEP/2026"
                                    className="h-11 focus-visible:ring-primary"
                                />
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Info className="h-3 w-3" />
                                    Bila tidak ada nomor, isi dengan tanda strip (-)
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-sm font-medium flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-muted-foreground" />
                                    Tanggal Surat <span className="text-destructive">*</span>
                                </Label>
                                <Input
                                    type="date"
                                    value={formData.tanggalSurat}
                                    onChange={(e) => handleChange('tanggalSurat', e.target.value)}
                                    className="h-11 focus-visible:ring-primary"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-medium">
                                Perihal <span className="text-destructive">*</span>
                            </Label>
                            <Textarea
                                value={formData.perihal}
                                onChange={(e) => handleChange('perihal', e.target.value)}
                                placeholder="Tuliskan perihal/hal surat..."
                                rows={3}
                                className="resize-none focus-visible:ring-primary"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Section 3: Pengirim & Penerima */}
                <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="p-6 space-y-5">
                        <SectionHeader
                            icon={Users}
                            title="Pengirim & Penerima"
                            description="Informasi asal dan tujuan surat"
                            step={3}
                        />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="space-y-2">
                                <Label className="text-sm font-medium flex items-center gap-2">
                                    <User className="h-4 w-4 text-muted-foreground" />
                                    Dari (Pengirim) <span className="text-destructive">*</span>
                                </Label>
                                <Input
                                    value={formData.dari}
                                    onChange={(e) => handleChange('dari', e.target.value)}
                                    placeholder="Instansi/nama pengirim surat"
                                    className="h-11 focus-visible:ring-primary"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-sm font-medium flex items-center gap-2">
                                    <Users className="h-4 w-4 text-muted-foreground" />
                                    Kepada (Penerima) <span className="text-destructive">*</span>
                                </Label>
                                <Input
                                    value={formData.kepada}
                                    onChange={(e) => handleChange('kepada', e.target.value)}
                                    placeholder="Unit kerja/pejabat penerima"
                                    className="h-11 focus-visible:ring-primary"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="space-y-2">
                                <Label className="text-sm font-medium flex items-center gap-2">
                                    <Info className="h-4 w-4 text-muted-foreground" />
                                    Keterangan
                                </Label>
                                <Select
                                    value={formData.keterangan}
                                    onValueChange={(v) => handleChange('keterangan', v)}
                                >
                                    <SelectTrigger className="h-11 focus-visible:ring-primary">
                                        <SelectValue placeholder="Pilih keterangan..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {KETERANGAN_OPTIONS.map(opt => (
                                            <SelectItem key={opt.value} value={opt.value}>
                                                <span className="flex items-center gap-2">
                                                    <span>{opt.icon}</span>
                                                    {opt.label}
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-sm font-medium flex items-center gap-2">
                                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                    Disposisi ke <span className="text-destructive">*</span>
                                </Label>
                                <MultiSelect
                                    options={DISPOSISI_OPTIONS.map(opt => ({ label: opt, value: opt }))}
                                    selected={formData.disposisi}
                                    onChange={(val) => handleChange('disposisi', val)}
                                    placeholder="Pilih penerima disposisi..."
                                    className="w-full focus-visible:ring-primary"
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Section 4: Klasifikasi & Arsip */}
                <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="p-6 space-y-5">
                        <SectionHeader
                            icon={FolderOpen}
                            title="Klasifikasi Arsip"
                            description="Pengelompokan untuk kebutuhan kearsipan (opsional)"
                            step={4}
                        />

                        <div className="space-y-2">
                            <Label className="text-sm font-medium flex items-center gap-2">
                                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                                Klasifikasi
                            </Label>
                            <KlasifikasiPicker
                                value={formData.klasifikasiKode}
                                onChange={(kode, klasifikasi, jra) => {
                                    setFormData(prev => {
                                        const updated = {
                                            ...prev,
                                            klasifikasiKode: kode,
                                            klasifikasiUraian: klasifikasi?.jenis || '',
                                            jraKode: jra?.kode || '',
                                            jraUraian: jra?.uraian || '',
                                            jraRetensiAktif: jra?.retensiAktif || '',
                                            jraRetensiInaktif: jra?.retensiInaktif || '',
                                            jraKeterangan: jra?.keterangan || '',
                                        };
                                        saveDraft(updated);
                                        return updated;
                                    });
                                    setError(null);
                                    setDirty();
                                }}
                                label="Klik untuk memilih klasifikasi arsip..."
                            />
                            <p className="text-xs text-muted-foreground">
                                Pilih klasifikasi arsip Fasilitatif atau Substantif sesuai peraturan kearsipan
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Section 5: Lampiran Dokumen */}
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
                                <Label className="text-sm font-medium flex items-center gap-2">
                                    <LinkIcon className="h-4 w-4 text-muted-foreground" />
                                    Link Dokumen
                                </Label>
                                <Input
                                    value={formData.linkDokumen}
                                    onChange={(e) => handleChange('linkDokumen', e.target.value)}
                                    placeholder="https://drive.google.com/..."
                                    className="h-11 focus-visible:ring-primary"
                                />
                            </div>

                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t border-border/50" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-card px-2 text-muted-foreground">atau</span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-sm font-medium flex items-center gap-2">
                                    <Upload className="h-4 w-4 text-muted-foreground" />
                                    Upload Berkas
                                </Label>
                                <div
                                    className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${selectedFile
                                        ? 'border-emerald-400 bg-emerald-50/50'
                                        : 'border-border hover:border-primary/50 hover:bg-muted/30 group'
                                        }`}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.zip,.rar"
                                        onChange={handleFileSelect}
                                        className="hidden"
                                    />
                                    {selectedFile ? (
                                        <div className="flex items-center justify-center gap-3">
                                            <div className="p-2 bg-emerald-100 rounded-lg">
                                                <FileText className="h-6 w-6 text-emerald-600" />
                                            </div>
                                            <div className="text-left">
                                                <p className="font-medium text-emerald-700">{selectedFile.name}</p>
                                                <p className="text-sm text-emerald-600">{formatFileSize(selectedFile.size)}</p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="ml-2 hover:bg-red-100 hover:text-red-600"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    removeFile();
                                                }}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="mx-auto w-12 h-12 rounded-full bg-muted group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                                                <Upload className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-foreground">
                                                    Klik untuk memilih berkas
                                                </p>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    PDF, DOC, DOCX, JPG, PNG, ZIP, RAR (maks. 10MB)
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-100">
                                <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-blue-700">
                                    <strong>Catatan:</strong> Salah satu dari link dokumen atau upload berkas wajib diisi.
                                    Anda dapat mengisi keduanya jika diperlukan.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Floating Action Bar */}
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-md border-t border-border/50 z-40 flex items-center justify-between sm:justify-end gap-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                    <div className="hidden sm:block mr-auto">
                        {/* Auto-save status indicator */}
                        {saveStatus && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100">
                                {saveStatus === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" /> Menyimpan draft...</>}
                                {saveStatus === 'saved' && <><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Draft tersimpan</>}
                                {saveStatus === 'restored' && <><FileText className="h-3 w-3 text-blue-500" /> Draft dimuat</>}
                            </span>
                        )}
                    </div>

                    <Link to="/surat/masuk">
                        <Button type="button" variant="outline" size="lg" disabled={isSubmitting} className="rounded-full px-6">
                            Batal
                        </Button>
                    </Link>
                    <Button
                        type="submit"
                        size="lg"
                        disabled={isSubmitting}
                        className="min-w-[140px] bg-primary hover:bg-primary/90 rounded-full px-8 shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Menyimpan...
                            </>
                        ) : (
                            <>
                                <Save className="h-4 w-4 mr-2" />
                                {isEditMode ? 'Perbarui' : 'Simpan'}
                            </>
                        )}
                    </Button>
                </div>
            </form>
        </div>
    );
}
