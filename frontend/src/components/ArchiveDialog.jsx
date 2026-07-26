import { useState, useEffect } from 'react'
import { KlasifikasiPicker } from '@/components/KlasifikasiPicker'
import {
    Dialog,
    DialogContent,
    DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Card,
    CardContent,
} from '@/components/ui/card'
import {
    Archive,
    Plus,
    Search,
    FileText,
    Folder,
    Clock,
    MapPin,
    X,
    Loader2,
    Info,
    Shield,
    User,
    Hash,
    Calendar,
    Building2,
    FileArchive
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'

const TINGKAT_PERKEMBANGAN_OPTIONS = [
    { value: 'Asli', label: 'Asli' },
    { value: 'Salinan', label: 'Salinan' },
    { value: 'Tembusan', label: 'Tembusan' },
]

const KLASIFIKASI_KEAMANAN_OPTIONS = [
    { value: 'biasa', label: 'Biasa/Terbuka' },
    { value: 'terbatas', label: 'Terbatas' },
    { value: 'rahasia', label: 'Rahasia' },
    { value: 'sangat_rahasia', label: 'Sangat Rahasia' },
]

const UNIT_PENGOLAH_OPTIONS = [
    { value: 'Ditjen', label: 'Ditjen' },
    { value: 'SekDitjen', label: 'SekDitjen' },
    { value: 'Dit. BPPT', label: 'Dit. BPPT' },
    { value: 'Dit. PTEP', label: 'Dit. PTEP' },
    { value: 'Dit. KTPP', label: 'Dit. KTPP' },
]

const buildFormData = ({ nomorSurat, klasifikasiKode, perihal }) => ({
    nomorBerkas: nomorSurat || '',
    kodeKlasifikasi: klasifikasiKode || '',
    klasifikasiArsip: '',
    uraianBerkas: perihal || '',
    unitPengolah: '',
    kurunWaktuDari: '',
    kurunWaktuSampai: '',
    // JRA
    jraKode: '',
    jraUraian: '',
    retensiAktif: '',
    retensiInaktif: '',
    hasilAkhir: '',
    // Keamanan & PIC
    klasifikasiKeamanan: 'biasa',
    personInCharge: '',
    keterangan: '',
})

const buildItems = ({ perihal, tanggalSurat }) => ([
    {
        nomor: '1',
        uraian: perihal || '',
        perkembangan: 'Asli',
        tanggal: tanggalSurat || '',
        jumlah: 1,
        lokasiFc: '',
        lokasiLaci: '',
        lokasiFolder: ''
    }
])

// Section Header Component with Dashboard Theme Colors
function SectionHeader({ number, title, icon: Icon, colorClass = "text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-500/15 border-teal-100" }) {
    return (
        <div className={`flex items-center gap-3 pb-3 border-b-2 ${colorClass.split(' ')[2]}`}>
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${colorClass.split(' ')[1]} ${colorClass.split(' ')[0]}`}>
                <Icon className="h-4 w-4" />
            </div>
            <h3 className={`${colorClass.split(' ')[0]} font-semibold text-base`}>
                {number}. {title}
            </h3>
        </div>
    )
}

// Field with helper text
function FormField({ label, required, hint, children, icon: Icon }) {
    return (
        <div className="space-y-1.5">
            <Label className="text-foreground font-medium flex items-center gap-2">
                {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
                {label}
                {required && <span className="text-red-500">*</span>}
            </Label>
            {children}
            {hint && (
                <p className="text-[11px] text-muted-foreground italic mt-0.5">{hint}</p>
            )}
        </div>
    )
}

export function ArchiveDialog({
    open,
    onOpenChange,
    suratType,
    suratData,
    onArchive
}) {
    const [loading, setLoading] = useState(false)

    const { nomorSurat, klasifikasiKode, perihal, tanggalSurat } = suratData || {}

    // Form state for Identifikasi Berkas
    const [formData, setFormData] = useState(() => buildFormData({ nomorSurat, klasifikasiKode, perihal }))

    // Items state
    const [items, setItems] = useState(() => buildItems({ perihal, tanggalSurat }))

    // Dialog stays mounted between surat, so refill the form from the surat being archived
    useEffect(() => {
        if (!open) return
        setFormData(buildFormData({ nomorSurat, klasifikasiKode, perihal }))
        setItems(buildItems({ perihal, tanggalSurat }))
    }, [open, nomorSurat, klasifikasiKode, perihal, tanggalSurat])

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }))
    }

    const handleItemChange = (index, field, value) => {
        const newItems = [...items]
        newItems[index] = { ...newItems[index], [field]: value }
        setItems(newItems)
    }

    const addItem = () => {
        setItems([...items, {
            nomor: String(items.length + 1),
            uraian: '',
            perkembangan: 'Asli',
            tanggal: '',
            jumlah: 1,
            lokasiFc: '',
            lokasiLaci: '',
            lokasiFolder: ''
        }])
    }

    const removeItem = (index) => {
        if (items.length > 1) {
            const newItems = items.filter((_, i) => i !== index)
            // Renumber items
            newItems.forEach((item, i) => {
                item.nomor = String(i + 1)
            })
            setItems(newItems)
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setLoading(true)
        try {
            // Flatten items[0] data into payload for backward compat
            const firstItem = items[0] || {}
            const payload = {
                ...formData,
                kurunWaktu: formData.kurunWaktuDari && formData.kurunWaktuSampai
                    ? `${formData.kurunWaktuDari} s/d ${formData.kurunWaktuSampai}`
                    : '',
                // Tanggal arsip (from first item)
                tanggalArsip: firstItem.tanggal || '',
                // Item detail (from first item — backward compat)
                nomorItem: firstItem.nomor || '',
                uraianItem: firstItem.uraian || '',
                tingkatPerkembangan: firstItem.perkembangan || '',
                jumlah: items.length,
                // Lokasi fisik (from first item — backward compat)
                lokasiFc: firstItem.lokasiFc || '',
                lokasiLaci: firstItem.lokasiLaci || '',
                lokasiFolder: firstItem.lokasiFolder || '',
                // Send ALL items so backend can save to arsip_items table
                items: items,
            }
            await onArchive(payload)
            onOpenChange(false)
        } catch (error) {
            console.error('Archive failed:', error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* Added: data-[state=open] styling directly here to ensure checks pass, but DialogContent handles animation via class */}
            <DialogContent showCloseButton={false} className="!max-w-[95vw] !w-[95vw] h-[95vh] p-0 gap-0 overflow-hidden flex flex-col bg-muted/50 border-0 rounded-xl shadow-2xl">

                {/* Header - Updated to Teal Gradient (ATR/BPN Style) */}
                <div className="bg-gradient-to-r from-teal-700 to-teal-600 text-white px-6 py-4 flex items-center gap-4 shadow-md shrink-0">
                    <div className="p-2.5 bg-card/15 rounded-xl border border-white/10 backdrop-blur-sm shadow-inner">
                        <Archive className="h-6 w-6 text-white" />
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-bold tracking-tight">Arsipkan Surat</h2>
                            <span className="bg-card/20 text-xs px-2 py-0.5 rounded-full font-medium border border-white/10">Input Data</span>
                        </div>
                        <p className="text-teal-50 text-sm mt-0.5 opacity-90">Lengkapi data arsip dengan teliti untuk kemudahan pencarian.</p>
                    </div>
                    <DialogClose className="text-white/80 hover:text-white hover:bg-card/20 rounded-full p-2 transition-all">
                        <X className="h-5 w-5" />
                    </DialogClose>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto bg-muted/50">
                    <form id="archive-form" onSubmit={handleSubmit} className="p-6 md:p-8 space-y-8 max-w-[1600px] mx-auto">

                        {/* ==================== SECTION 1: IDENTIFIKASI BERKAS ==================== */}
                        <section className="bg-card rounded-xl border shadow-sm overflow-hidden hover:shadow-md transition-shadow duration-200">
                            <div className="bg-teal-50/50 px-6 py-4 border-b border-teal-100/50">
                                <SectionHeader
                                    number={1}
                                    title="Identifikasi Berkas"
                                    icon={FileText}
                                    colorClass="text-teal-700 dark:text-teal-300 bg-teal-100 dark:bg-teal-500/15 border-teal-200"
                                />
                            </div>

                            <div className="p-6 space-y-6">
                                {/* Row 1: Nomor Berkas & Klasifikasi Arsip */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <FormField
                                        label="Nomor Berkas"
                                        required
                                        icon={Hash}
                                        hint="Otomatis terisi dari nomor surat, dapat diedit jika perlu"
                                    >
                                        <Input
                                            value={formData.nomorBerkas}
                                            onChange={(e) => handleChange('nomorBerkas', e.target.value)}
                                            placeholder="Contoh: AT.02.02/2172-32/VIII/2025"
                                            className="bg-muted/50 border-border focus:border-teal-500 focus:ring-teal-500 h-10"
                                        />
                                    </FormField>

                                    <FormField
                                        label="Klasifikasi Arsip & Jadwal Retensi"
                                        required
                                        icon={FileArchive}
                                        hint="Pilih klasifikasi arsip, lalu pilih jadwal retensi yang sesuai dari saran yang muncul"
                                    >
                                        <KlasifikasiPicker
                                            value={formData.kodeKlasifikasi}
                                            onChange={(kode, klasifikasi, jra) => {
                                                handleChange('kodeKlasifikasi', kode)
                                                handleChange('klasifikasiArsip', klasifikasi?.jenis || '')
                                                // Auto-fill JRA fields
                                                if (jra) {
                                                    handleChange('jraKode', jra.kode || '')
                                                    handleChange('jraUraian', jra.uraian || '')
                                                    handleChange('retensiAktif', jra.retensiAktif || '')
                                                    handleChange('retensiInaktif', jra.retensiInaktif || '')
                                                    handleChange('hasilAkhir', jra.keterangan || '')
                                                } else {
                                                    handleChange('jraKode', '')
                                                    handleChange('jraUraian', '')
                                                    handleChange('retensiAktif', '')
                                                    handleChange('retensiInaktif', '')
                                                    handleChange('hasilAkhir', '')
                                                }
                                            }}
                                            label="Klik untuk memilih klasifikasi arsip..."
                                        />
                                    </FormField>
                                </div>

                                {/* Row 2: Kode Klasifikasi (auto-filled) */}
                                <FormField
                                    label="Kode Klasifikasi"
                                    required
                                    hint="Otomatis terisi dari klasifikasi arsip yang dipilih"
                                >
                                    <Input
                                        value={formData.kodeKlasifikasi}
                                        readOnly
                                        placeholder="Otomatis dari klasifikasi arsip"
                                        className="bg-muted/50 border-border text-muted-foreground font-medium w-full md:w-1/2 h-10"
                                    />
                                </FormField>

                                <Separator className="my-2 bg-muted" />

                                {/* JRA Display - auto-filled from KlasifikasiPicker */}
                                {formData.jraKode ? (
                                    <Alert className="bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 text-emerald-800 dark:text-emerald-300">
                                        <Clock className="h-4 w-4 text-emerald-600 mt-0.5" />
                                        <AlertDescription className="text-sm ml-2">
                                            <span className="font-semibold block mb-0.5 text-emerald-700 dark:text-emerald-300">Jadwal Retensi Arsip Terpilih:</span>
                                            <span className="font-mono text-xs bg-emerald-100 dark:bg-emerald-500/15 px-1.5 py-0.5 rounded">{formData.jraKode}</span>
                                            <span className="ml-2">{formData.jraUraian}</span>
                                        </AlertDescription>
                                    </Alert>
                                ) : (
                                    <Alert className="bg-sky-50 dark:bg-sky-500/15 border-sky-200 text-sky-800 dark:text-sky-300">
                                        <Info className="h-4 w-4 text-sky-600 mt-0.5" />
                                        <AlertDescription className="text-sm ml-2">
                                            <span className="font-semibold block mb-0.5 text-sky-700 dark:text-sky-300">Petunjuk Pengisian JRA:</span>
                                            Pilih klasifikasi arsip di atas, kemudian pilih jadwal retensi dari saran yang muncul di panel sebelah kanan.
                                        </AlertDescription>
                                    </Alert>
                                )}

                                {/* JRA Details - 3 columns */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 p-4 bg-muted/50 rounded-lg border border-border">
                                    <FormField
                                        label="Aktif"
                                        required
                                        hint="Masa simpan aktif"
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0 shadow-sm shadow-emerald-200"></div>
                                            <Input
                                                value={formData.retensiAktif}
                                                readOnly
                                                placeholder="--"
                                                className="bg-card border-border text-foreground h-9"
                                            />
                                        </div>
                                    </FormField>

                                    <FormField
                                        label="Inaktif"
                                        required
                                        hint="Masa simpan inaktif"
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0 shadow-sm shadow-amber-200"></div>
                                            <Input
                                                value={formData.retensiInaktif}
                                                readOnly
                                                placeholder="--"
                                                className="bg-card border-border text-foreground h-9"
                                            />
                                        </div>
                                    </FormField>

                                    <FormField
                                        label="Hasil Akhir"
                                        required
                                        hint="Nasib akhir arsip"
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0 shadow-sm shadow-red-200"></div>
                                            <Input
                                                value={formData.hasilAkhir}
                                                readOnly
                                                placeholder="--"
                                                className="bg-card border-border text-foreground h-9"
                                            />
                                        </div>
                                    </FormField>
                                </div>

                                <Separator className="my-2 bg-muted" />

                                {/* Uraian Informasi Berkas */}
                                <FormField
                                    label="Uraian Informasi Berkas"
                                    required
                                    hint="Deskripsi umum tentang berkas atau dokumen"
                                >
                                    <Textarea
                                        value={formData.uraianBerkas}
                                        onChange={(e) => handleChange('uraianBerkas', e.target.value)}
                                        placeholder="Uraian lengkap tentang berkas ini..."
                                        className="min-h-[80px] bg-muted/50 border-border resize-none focus:border-teal-500 focus:ring-teal-500"
                                    />
                                </FormField>

                                {/* Unit Pengolah & Kurun Waktu */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <FormField
                                        label="Unit Pengolah"
                                        required
                                        icon={Building2}
                                        hint="Pilih unit yang mengolah/bertanggung jawab atas arsip ini"
                                    >
                                        <Select value={formData.unitPengolah} onValueChange={(v) => handleChange('unitPengolah', v)}>
                                            <SelectTrigger className="bg-muted/50 border-border h-10 focus:ring-teal-500">
                                                <SelectValue placeholder="-- Pilih Unit Pengolah --" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {UNIT_PENGOLAH_OPTIONS.map(opt => (
                                                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </FormField>

                                    <FormField
                                        label="Kurun Waktu"
                                        icon={Calendar}
                                        hint="Rentang waktu periode arsip"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="flex-1">
                                                <Input
                                                    type="date"
                                                    value={formData.kurunWaktuDari}
                                                    onChange={(e) => handleChange('kurunWaktuDari', e.target.value)}
                                                    className="bg-muted/50 border-border h-10 focus:border-teal-500 focus:ring-teal-500"
                                                />
                                            </div>
                                            <span className="text-muted-foreground font-medium text-sm">s/d</span>
                                            <div className="flex-1">
                                                <Input
                                                    type="date"
                                                    value={formData.kurunWaktuSampai}
                                                    onChange={(e) => handleChange('kurunWaktuSampai', e.target.value)}
                                                    className="bg-muted/50 border-border h-10 focus:border-teal-500 focus:ring-teal-500"
                                                />
                                            </div>
                                        </div>
                                    </FormField>
                                </div>
                            </div>
                        </section>

                        {/* ==================== SECTION 2: DETAIL ITEM ARSIP ==================== */}
                        <section className="bg-card rounded-xl border shadow-sm overflow-hidden hover:shadow-md transition-shadow duration-200">
                            <div className="bg-amber-50/50 px-6 py-4 flex items-center justify-between border-b border-amber-100/50">
                                <SectionHeader
                                    number={2}
                                    title="Detail Item Arsip"
                                    icon={Folder}
                                    colorClass="text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/15 border-amber-200"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={addItem}
                                    className="text-amber-700 dark:text-amber-300 border-amber-200 hover:bg-amber-50 dark:hover:bg-amber-500/15 hover:text-amber-800 dark:hover:text-amber-300 hover:border-amber-300 transition-all font-medium"
                                >
                                    <Plus className="h-4 w-4 mr-1.5" /> Tambah Item
                                </Button>
                            </div>

                            <div className="p-6 space-y-6">
                                {/* Info Alert */}
                                <Alert className="bg-muted/50 border-border text-muted-foreground">
                                    <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                                    <AlertDescription className="text-sm ml-2">
                                        Setiap berkas dapat memiliki beberapa item arsip.
                                        Klik "Tambah Item" untuk menambah item baru.
                                    </AlertDescription>
                                </Alert>

                                {/* Item Cards */}
                                {items.map((item, index) => (
                                    <Card key={index} className="border border-border overflow-hidden shadow-sm hover:shadow-md transition-all duration-200 group">
                                        {/* Item Header - Updated to Amber/Gold Theme */}
                                        <div className="bg-gradient-to-r from-amber-500 to-yellow-500 text-white px-5 py-3 flex justify-between items-center">
                                            <span className="font-semibold flex items-center gap-2 text-sm uppercase tracking-wide">
                                                <Folder className="h-4 w-4 text-white/90" />
                                                Item Arsip #{index + 1}
                                            </span>
                                            {items.length > 1 && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => removeItem(index)}
                                                    className="text-white/90 hover:text-white hover:bg-card/20 h-7 w-7 p-0 rounded-full transition-colors"
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>

                                        <CardContent className="p-5 space-y-5">
                                            {/* Row 1: Nomor & Uraian */}
                                            <div className="grid grid-cols-12 gap-5">
                                                <div className="col-span-12 md:col-span-3">
                                                    <FormField label="Nomor Item">
                                                        <Input
                                                            value={item.nomor}
                                                            onChange={(e) => handleItemChange(index, 'nomor', e.target.value)}
                                                            className="bg-muted/50 h-9"
                                                        />
                                                    </FormField>
                                                </div>
                                                <div className="col-span-12 md:col-span-9">
                                                    <FormField label="Uraian Informasi Item" required>
                                                        <Input
                                                            value={item.uraian}
                                                            onChange={(e) => handleItemChange(index, 'uraian', e.target.value)}
                                                            placeholder="Deskripsi detail item arsip..."
                                                            className="bg-muted/50 h-9 focus:border-amber-400 focus:ring-amber-400"
                                                        />
                                                    </FormField>
                                                </div>
                                            </div>

                                            {/* Row 2: Tingkat Perkembangan, Tanggal, Jumlah */}
                                            <div className="grid grid-cols-12 gap-5">
                                                <div className="col-span-12 md:col-span-4">
                                                    <FormField label="Tingkat Perkembangan" required>
                                                        <Select
                                                            value={item.perkembangan}
                                                            onValueChange={(v) => handleItemChange(index, 'perkembangan', v)}
                                                        >
                                                            <SelectTrigger className="bg-muted/50 h-9">
                                                                <SelectValue placeholder="Pilih..." />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {TINGKAT_PERKEMBANGAN_OPTIONS.map(opt => (
                                                                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </FormField>
                                                </div>
                                                <div className="col-span-12 md:col-span-4">
                                                    <FormField label="Tanggal Arsip" required>
                                                        <Input
                                                            type="date"
                                                            value={item.tanggal}
                                                            onChange={(e) => handleItemChange(index, 'tanggal', e.target.value)}
                                                            className="bg-muted/50 h-9"
                                                        />
                                                    </FormField>
                                                </div>
                                                <div className="col-span-12 md:col-span-4">
                                                    <FormField label="Jumlah">
                                                        <Input
                                                            type="number"
                                                            min="1"
                                                            value={item.jumlah}
                                                            onChange={(e) => handleItemChange(index, 'jumlah', parseInt(e.target.value) || 1)}
                                                            className="bg-muted/50 h-9"
                                                        />
                                                    </FormField>
                                                </div>
                                            </div>

                                            {/* Lokasi Penyimpanan */}
                                            <div className="pt-4 border-t border-dashed border-border">
                                                <Label className="text-amber-700 dark:text-amber-300 font-semibold text-xs uppercase tracking-wider flex items-center gap-2 mb-3">
                                                    <MapPin className="h-3.5 w-3.5" />
                                                    Lokasi Penyimpanan Fisik
                                                </Label>
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-amber-50/30 p-4 rounded-lg border border-amber-100/50">
                                                    <FormField label="No. Filing Cabinet" required>
                                                        <Input
                                                            value={item.lokasiFc}
                                                            onChange={(e) => handleItemChange(index, 'lokasiFc', e.target.value)}
                                                            placeholder="Ex: FC-01"
                                                            className="bg-card h-9 border-amber-200 focus:border-amber-400 focus:ring-amber-400"
                                                        />
                                                    </FormField>
                                                    <FormField label="No. Laci" required>
                                                        <Input
                                                            value={item.lokasiLaci}
                                                            onChange={(e) => handleItemChange(index, 'lokasiLaci', e.target.value)}
                                                            placeholder="Ex: L-02"
                                                            className="bg-card h-9 border-amber-200 focus:border-amber-400 focus:ring-amber-400"
                                                        />
                                                    </FormField>
                                                    <FormField label="No. Folder" required>
                                                        <Input
                                                            value={item.lokasiFolder}
                                                            onChange={(e) => handleItemChange(index, 'lokasiFolder', e.target.value)}
                                                            placeholder="Ex: F-003"
                                                            className="bg-card h-9 border-amber-200 focus:border-amber-400 focus:ring-amber-400"
                                                        />
                                                    </FormField>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </section>

                        {/* ==================== SECTION 3: KEAMANAN, PIC & CATATAN ==================== */}
                        <section className="bg-card rounded-xl border shadow-sm overflow-hidden hover:shadow-md transition-shadow duration-200">
                            <div className="bg-muted/50 px-6 py-4 border-b border-border">
                                <SectionHeader
                                    number={3}
                                    title="Keamanan & Catatan Lain"
                                    icon={Shield}
                                    colorClass="text-foreground bg-muted border-border"
                                />
                            </div>

                            <div className="p-6 space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <FormField
                                        label="Klasifikasi Keamanan"
                                        icon={Shield}
                                        hint="Tingkat kerahasiaan dokumen"
                                    >
                                        <Select
                                            value={formData.klasifikasiKeamanan}
                                            onValueChange={(v) => handleChange('klasifikasiKeamanan', v)}
                                        >
                                            <SelectTrigger className="bg-muted/50 border-border h-10">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {KLASIFIKASI_KEAMANAN_OPTIONS.map(opt => (
                                                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </FormField>

                                    <FormField
                                        label="Person In Charge (PIC)"
                                        required
                                        icon={User}
                                        hint="Nama yang bertanggung jawab atas pengarsipan"
                                    >
                                        <Input
                                            value={formData.personInCharge}
                                            onChange={(e) => handleChange('personInCharge', e.target.value)}
                                            placeholder="Contoh: Nama Staff / Admin"
                                            className="bg-muted/50 border-border h-10"
                                        />
                                    </FormField>
                                </div>

                                <FormField
                                    label="Keterangan Tambahan"
                                    hint="Informasi tambahan lain jika diperlukan"
                                >
                                    <Textarea
                                        value={formData.keterangan}
                                        onChange={(e) => handleChange('keterangan', e.target.value)}
                                        placeholder="Catatan..."
                                        className="min-h-[80px] bg-muted/50 border-border resize-none"
                                    />
                                </FormField>
                            </div>
                        </section>

                    </form>
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-border bg-card flex justify-end gap-3 shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.03)] z-10">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => onOpenChange(false)}
                        className="bg-card border border-border text-foreground hover:bg-muted/50 min-w-[100px] shadow-sm"
                    >
                        <X className="h-4 w-4 mr-2" />
                        Batal
                    </Button>
                    <Button
                        form="archive-form"
                        type="submit"
                        disabled={loading}
                        className="bg-teal-600 hover:bg-teal-700 text-white min-w-[180px] shadow-md shadow-teal-600/20"
                    >
                        {loading ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Archive className="mr-2 h-4 w-4" />
                        )}
                        Simpan Arsip
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
