import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { suratKeluarService } from '@/services/surat-keluar.service';
import { suratMasukService } from '@/services/surat-masuk.service';
import { KlasifikasiPicker } from '@/components/KlasifikasiPicker';
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
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
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
    Search,
    Reply,
    Mail
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

export default function TambahSuratKeluar() {
    const { id } = useParams(); // Get ID from URL for edit mode
    const isEditMode = Boolean(id);
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const fileInputRef = useRef(null);
    const errorRef = useRef(null);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [existingFile, setExistingFile] = useState(null);
    const [isDragging, setIsDragging] = useState(false);

    // State for surat masuk search
    const [suratMasukOptions, setSuratMasukOptions] = useState([]);
    const [selectedSuratMasuk, setSelectedSuratMasuk] = useState(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [loadingSuratMasuk, setLoadingSuratMasuk] = useState(false);

    // Form state
    const [formData, setFormData] = useState({
        naskahDinas: '',
        nomorSurat: '',
        tanggalSurat: '',
        perihal: '',
        kepada: '',
        klasifikasiFasilitatif: '',
        klasifikasiFasilitatifKode: '',
        klasifikasiSubstantif: '',
        klasifikasiSubstantifKode: '',
        linkDokumen: '',
        balasanUntuk: null,
    });

    // Load surat masuk yang belum dibalas
    useEffect(() => {
        loadSuratMasukOptions();
    }, [user?.unitKerjaId]);

    // Fetch existing data for edit mode
    useEffect(() => {
        if (isEditMode && id) {
            fetchSuratData();
        }
    }, [id, isEditMode]);

    // Auto-fill from reply state (when clicking "Balas Surat" from detail surat masuk)
    useEffect(() => {
        const replyTo = location.state?.replyTo;
        if (replyTo && !isEditMode) {
            setFormData(prev => ({
                ...prev,
                perihal: `Balasan: ${replyTo.perihal || ''}`,
                kepada: replyTo.dari || '',
                balasanUntuk: replyTo.id,
            }));
            setSelectedSuratMasuk({
                id: replyTo.id,
                nomorSurat: replyTo.nomorSurat,
                perihal: replyTo.perihal,
            });
        }
    }, [location.state, isEditMode]);

    const fetchSuratData = async () => {
        setIsLoading(true);
        try {
            const data = await suratKeluarService.getById(id);
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
            // If this is a reply to a surat masuk, set it
            if (data.balasanUntuk) {
                try {
                    const suratMasuk = await suratMasukService.getById(data.balasanUntuk);
                    setSelectedSuratMasuk(suratMasuk);
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
    };

    const loadSuratMasukOptions = async () => {
        try {
            setLoadingSuratMasuk(true);
            const response = await suratMasukService.getBelumDibalas({
                unitKerjaId: user?.unitKerjaId || 'ditjen',
            });
            setSuratMasukOptions(response.data || []);
        } catch (err) {
            console.error('Failed to load surat masuk:', err);
        } finally {
            setLoadingSuratMasuk(false);
        }
    };

    // Handle input changes
    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setError(null);
    };

    // Handle surat masuk selection
    const handleSelectSuratMasuk = (surat) => {
        setSelectedSuratMasuk(surat);
        setFormData(prev => ({
            ...prev,
            balasanUntuk: surat.id,
        }));
        setSearchOpen(false);
    };

    // Clear surat masuk selection
    const clearSuratMasuk = () => {
        setSelectedSuratMasuk(null);
        setFormData(prev => ({
            ...prev,
            balasanUntuk: null,
        }));
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
        if (!formData.naskahDinas) return 'Naskah Dinas wajib diisi';
        if (!formData.nomorSurat) return 'Nomor Surat wajib diisi';
        if (!formData.tanggalSurat) return 'Tanggal Surat wajib diisi';
        if (!formData.perihal) return 'Perihal wajib diisi';
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
            // Auto-scroll ke error agar user tahu field mana yang belum diisi
            setTimeout(() => {
                errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            // Resolve unitKerjaId berdasarkan role (konsisten dengan backend resolveUnitKerjaId)
            // Admin roles have FIXED unit kerja assignments regardless of user record
            const resolvedUnitKerjaId = (() => {
                switch (user?.role) {
                    case 'admin_sesditjen': return 'sesditjen';
                    case 'admin_dirjen': return 'ditjen';
                    default: return user?.unitKerjaId || 'ditjen';
                }
            })();

            const dataToSubmit = {
                ...formData,
                unitKerjaId: resolvedUnitKerjaId,
            };

            if (isEditMode) {
                // Tahun tidak dikirim saat edit agar tahun asli surat tidak tertimpa
                await suratKeluarService.update(id, dataToSubmit, selectedFile);
            } else {
                // Create new surat
                await suratKeluarService.create({
                    ...dataToSubmit,
                    tahun: Number(formData.tanggalSurat?.slice(0, 4)) || new Date().getFullYear(),
                }, selectedFile);
            }
            setSuccess(true);

            setTimeout(() => {
                navigate('/surat/keluar', {
                    state: { message: isEditMode ? 'Surat keluar berhasil diperbarui' : 'Surat keluar berhasil ditambahkan' }
                });
            }, 1500);
        } catch (err) {
            setError(err.message || 'Gagal menyimpan surat keluar');
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatFileSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    // Filter surat masuk based on search
    const filteredSuratMasuk = suratMasukOptions.filter(surat => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (
            surat.nomorSurat?.toLowerCase().includes(term) ||
            surat.perihal?.toLowerCase().includes(term)
        );
    });

    // Section Header Component
    const SectionHeader = ({ icon: Icon, title, description, step }) => (
        <div className="flex items-start gap-3 pb-4 border-b border-border/50">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <Icon className="h-4 w-4 text-emerald-600" />
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
                <Link to="/surat/keluar">
                    <Button variant="ghost" size="icon" className="rounded-full hover:bg-emerald-500/10">
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                </Link>
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

            {/* Error/Success Alerts */}
            {error && (
                <Alert ref={errorRef} variant="destructive" className="animate-in slide-in-from-top-2">
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
                {/* Section 1: Balasan Surat (Optional) */}
                <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="p-6 space-y-5">
                        <SectionHeader
                            icon={Reply}
                            title="Referensi Surat Masuk"
                            description="Hubungkan dengan surat masuk yang akan dibalas (opsional)"
                        />

                        {selectedSuratMasuk ? (
                            <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-500/15 border border-blue-200 rounded-xl">
                                <div className="p-2 bg-blue-100 dark:bg-blue-500/15 rounded-lg flex-shrink-0">
                                    <Mail className="h-5 w-5 text-blue-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-blue-900 dark:text-blue-300">{selectedSuratMasuk.nomorSurat || 'Tanpa Nomor'}</p>
                                    <p className="text-sm text-blue-700 dark:text-blue-300 truncate">{selectedSuratMasuk.perihal}</p>
                                    <p className="text-xs text-blue-500 mt-1">
                                        Surat ini akan ditandai sebagai balasan
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={clearSuratMasuk}
                                    className="flex-shrink-0 hover:bg-blue-100 dark:hover:bg-blue-500/15 text-blue-600"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        ) : (
                            <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        role="combobox"
                                        className="w-full h-12 justify-start text-muted-foreground border-dashed hover:border-solid hover:border-blue-300 hover:bg-blue-50/50"
                                    >
                                        <Search className="h-4 w-4 mr-2 text-muted-foreground/70" />
                                        <span>Cari surat masuk untuk dibalas...</span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[500px] p-0" align="start">
                                    <Command>
                                        <CommandInput
                                            placeholder="Ketik nomor surat atau perihal..."
                                            value={searchTerm}
                                            onValueChange={setSearchTerm}
                                        />
                                        <CommandList>
                                            <CommandEmpty>
                                                {loadingSuratMasuk ? (
                                                    <div className="flex items-center justify-center py-6">
                                                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                                        <span className="ml-2 text-sm text-muted-foreground">Memuat...</span>
                                                    </div>
                                                ) : (
                                                    <div className="py-6 text-center">
                                                        <Mail className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
                                                        <p className="text-sm text-muted-foreground">Tidak ada surat masuk yang belum dibalas</p>
                                                    </div>
                                                )}
                                            </CommandEmpty>
                                            <CommandGroup heading="Surat Masuk Belum Dibalas">
                                                {filteredSuratMasuk.slice(0, 10).map((surat) => (
                                                    <CommandItem
                                                        key={surat.id}
                                                        onSelect={() => handleSelectSuratMasuk(surat)}
                                                        className="cursor-pointer py-3"
                                                    >
                                                        <div className="flex items-center gap-3 w-full">
                                                            <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-medium truncate">{surat.nomorSurat || '-'}</p>
                                                                <p className="text-sm text-muted-foreground truncate">
                                                                    {surat.perihal}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        )}

                        <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border/50">
                            <Info className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-muted-foreground">
                                Pilih surat masuk yang akan dibalas untuk tracking. Kosongkan jika ini surat keluar baru (bukan balasan).
                            </p>
                        </div>
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
                            <Label className="text-sm font-medium flex items-center gap-2">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                Naskah Dinas <span className="text-destructive">*</span>
                            </Label>
                            <SearchableSelect
                                options={NASKAH_DINAS_OPTIONS}
                                value={formData.naskahDinas}
                                onValueChange={(v) => handleChange('naskahDinas', v)}
                                placeholder="Pilih jenis naskah dinas..."
                                searchPlaceholder="Cari jenis naskah dinas..."
                            />
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
                                <Label className="text-sm font-medium flex items-center gap-2">
                                    <Hash className="h-4 w-4 text-muted-foreground" />
                                    Nomor Surat <span className="text-destructive">*</span>
                                </Label>
                                <Input
                                    value={formData.nomorSurat}
                                    onChange={(e) => handleChange('nomorSurat', e.target.value)}
                                    placeholder="Contoh: S-123/PTEP/2026"
                                    className="h-11 focus-visible:ring-emerald-500"
                                />
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
                                    className="h-11 focus-visible:ring-emerald-500"
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
                            <Label className="text-sm font-medium flex items-center gap-2">
                                <Users className="h-4 w-4 text-muted-foreground" />
                                Kepada
                            </Label>
                            <Input
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

                        <div className="space-y-2">
                            <Label className="text-sm font-medium flex items-center gap-2">
                                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                                Klasifikasi
                            </Label>
                            <KlasifikasiPicker
                                value={formData.klasifikasiFasilitatifKode}
                                onChange={(kode, klasifikasi, jra) => {
                                    setFormData(prev => ({
                                        ...prev,
                                        klasifikasiFasilitatifKode: kode,
                                        klasifikasiFasilitatif: klasifikasi?.jenis || '',
                                    }));
                                    setError(null);
                                }}
                                label="Klik untuk memilih klasifikasi arsip..."
                            />
                            <p className="text-xs text-muted-foreground">
                                Pilih klasifikasi arsip Fasilitatif atau Substantif sesuai peraturan kearsipan
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Section 6: Lampiran Dokumen */}
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
                                    className="h-11 focus-visible:ring-emerald-500"
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
                                        : isDragging
                                            ? 'border-emerald-500 bg-emerald-500/5 scale-[1.02] shadow-lg'
                                            : 'border-border hover:border-emerald-300 hover:bg-emerald-50/30 group'
                                        }`}
                                    onClick={() => fileInputRef.current?.click()}
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
                                        const file = e.dataTransfer.files?.[0];
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
                                    }}
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
                                            <div className="p-2 bg-emerald-100 dark:bg-emerald-500/15 rounded-lg">
                                                <FileText className="h-6 w-6 text-emerald-600" />
                                            </div>
                                            <div className="text-left">
                                                <p className="font-medium text-emerald-700 dark:text-emerald-300">{selectedFile.name}</p>
                                                <p className="text-sm text-emerald-600">{formatFileSize(selectedFile.size)}</p>
                                            </div>
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
                                                    PDF, DOC, DOCX, JPG, PNG, ZIP, RAR (maks. 10MB)
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

                {/* Floating Action Bar */}
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-card/80 backdrop-blur-md border-t border-border/50 z-40 flex items-center justify-end gap-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                    <Link to="/surat/keluar">
                        <Button type="button" variant="outline" size="lg" disabled={isSubmitting} className="rounded-full px-6">
                            Batal
                        </Button>
                    </Link>
                    <Button
                        type="submit"
                        size="lg"
                        disabled={isSubmitting}
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
                                {isEditMode ? 'Perbarui' : 'Simpan'}
                            </>
                        )}
                    </Button>
                </div>
            </form>
        </div>
    );
}
