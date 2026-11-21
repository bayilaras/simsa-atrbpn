import { useMemo, useState } from 'react'
import { AlertTriangle, Info, Loader2, Plus, Save } from 'lucide-react'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/hooks/use-toast'
import { arsipService } from '@/services/arsip.service'
import { adaKelasTersembunyi, PESAN_KELAS_TERBATAS_PERAN, saringOpsiKelas } from '@/lib/kelas-keamanan'
import {
    KLASIFIKASI_KEAMANAN_OPTIONS,
    MEDIA_OPTIONS,
    PESAN_KELAS_PERLU_PERSETUJUAN,
    TINGKAT_PERKEMBANGAN_OPTIONS,
    UNIT_PENGOLAH_OPTIONS,
    kelasPerluPersetujuan,
} from './edit-arsip-form'
import { LokasiSimpanPicker } from './LokasiSimpanPicker'
import { PETUNJUK_LOKASI_SIMPAN, bolehMemilihLokasiUnit } from './lokasi-simpan'
import {
    FIELD_TAMBAH, JENIS_ARSIP_OPTIONS, PESAN_TAMBAH_PERMANEN,
    formAwalTambah, galatTambahArsip, payloadTambahArsip, pesanGalatTambahArsip,
} from './tambah-arsip-form'

const ID = field => `tambah-arsip-${field}`

function Bidang({ field, label, wajib, petunjuk, galat, className = '', children }) {
    const id = ID(field)
    return (
        <div className={`min-w-0 space-y-1.5 ${className}`}>
            <Label htmlFor={id}>
                {label}
                {wajib && <span className="text-destructive" aria-hidden="true">*</span>}
            </Label>
            {children}
            {petunjuk && <p id={`${id}-petunjuk`} className="text-xs text-muted-foreground">{petunjuk}</p>}
            {galat && <p id={`${id}-galat`} className="text-xs font-medium text-destructive">{galat}</p>}
        </div>
    )
}

function atribut(field, { petunjuk, galat, wajib } = {}) {
    const id = ID(field)
    const keterangan = [petunjuk && `${id}-petunjuk`, galat && `${id}-galat`].filter(Boolean).join(' ')
    return {
        id,
        name: field,
        'aria-invalid': galat ? true : undefined,
        'aria-describedby': keterangan || undefined,
        'aria-required': wajib ? true : undefined,
    }
}

const KELAS_SELECT = 'min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

function FormTambahArsip({ unitKerjaId, jenisAwal, saving, setSaving, onClose, onSaved }) {
    const { user } = useAuth()
    const { toast } = useToast()
    const role = user?.role
    const [form, setForm] = useState(() => formAwalTambah(jenisAwal))
    const [sudahDicoba, setSudahDicoba] = useState(false)
    const [galatServer, setGalatServer] = useState('')
    const galat = useMemo(() => galatTambahArsip(form, role), [form, role])
    const galatTampil = sudahDicoba ? galat : {}
    const opsiKelas = saringOpsiKelas(KLASIFIKASI_KEAMANAN_OPTIONS, role, form.klasifikasiKeamanan)
    const kelasDisembunyikan = adaKelasTersembunyi(KLASIFIKASI_KEAMANAN_OPTIONS, role)

    const ubah = field => value => {
        setForm(current => ({ ...current, [field]: value }))
        setGalatServer('')
    }
    const ubahInput = field => event => ubah(field)(event.target.value)

    const handleSubmit = async (event) => {
        event.preventDefault()
        if (saving) return
        setSudahDicoba(true)
        const pertama = FIELD_TAMBAH.find(field => galat[field])
        if (pertama) {
            document.getElementById(ID(pertama))?.focus()
            return
        }
        setSaving(true)
        setGalatServer('')
        let hasil
        try {
            hasil = await arsipService.createManual({ ...payloadTambahArsip(form), unitKerjaId })
        } catch (err) {
            setGalatServer(pesanGalatTambahArsip(err))
            setSaving(false)
            return
        }
        setSaving(false)
        toast({ title: 'Arsip ditambahkan', description: 'Cocokkan klasifikasi/JRA lewat Rekonsiliasi pada detail arsip.' })
        onClose()
        onSaved?.(hasil)
    }

    const teks = (field, label, opsi = {}) => (
        <Bidang field={field} label={label} wajib={opsi.wajib} petunjuk={opsi.petunjuk} galat={galatTampil[field]} className={opsi.className}>
            <Input
                {...atribut(field, { petunjuk: opsi.petunjuk, galat: galatTampil[field], wajib: opsi.wajib })}
                type={opsi.type || 'text'}
                value={form[field]}
                onChange={ubahInput(field)}
                placeholder={opsi.placeholder}
                disabled={saving}
                {...(opsi.type === 'number' ? { min: 1, max: 10000, step: 1, inputMode: 'numeric' } : {})}
            />
        </Bidang>
    )

    const pilihan = (field, label, options, opsi = {}) => (
        <Bidang field={field} label={label} wajib={opsi.wajib} petunjuk={opsi.petunjuk} galat={galatTampil[field]} className={opsi.className}>
            <select
                {...atribut(field, { petunjuk: opsi.petunjuk, galat: galatTampil[field], wajib: opsi.wajib })}
                value={form[field]}
                onChange={ubahInput(field)}
                disabled={saving}
                className={KELAS_SELECT}
            >
                {opsi.kosong && <option value="">{opsi.kosong}</option>}
                {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
        </Bidang>
    )

    return (
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
            <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                    Untuk surat yang sudah tercatat, gunakan tombol Arsipkan pada detail surat. Formulir ini untuk arsip yang belum ada di
                    daftar surat, termasuk dokumen yang bukan surat. Klasifikasi/JRA dicocokkan sesudahnya lewat Rekonsiliasi pada detail arsip.
                </span>
            </p>

            <fieldset className="min-w-0 space-y-3">
                <legend className="mb-1 text-sm font-semibold">Identitas Berkas</legend>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {pilihan('jenisArsip', 'Jenis Arsip', JENIS_ARSIP_OPTIONS, { wajib: true, className: 'sm:col-span-2' })}
                    {teks('nomorBerkas', 'Nomor Berkas', { wajib: true, petunjuk: 'Harus berbeda dari nomor berkas lain di unit ini pada tahun yang sama.' })}
                    {teks('tanggalArsip', 'Tanggal Arsip', { wajib: true, type: 'date', petunjuk: 'Tahun arsip diambil dari tanggal ini.' })}
                    <Bidang field="uraianBerkas" label="Uraian Berkas" wajib galat={galatTampil.uraianBerkas} className="sm:col-span-2">
                        <Textarea
                            {...atribut('uraianBerkas', { galat: galatTampil.uraianBerkas, wajib: true })}
                            value={form.uraianBerkas}
                            onChange={ubahInput('uraianBerkas')}
                            rows={3}
                            disabled={saving}
                        />
                    </Bidang>
                    {teks('kurunWaktu', 'Kurun Waktu', { placeholder: 'Contoh: 2024 s/d 2025' })}
                    {pilihan('unitPengolah', 'Unit Pengolah', UNIT_PENGOLAH_OPTIONS, { kosong: 'Pilih unit pengolah' })}
                    {pilihan('tingkatPerkembangan', 'Tingkat Perkembangan', TINGKAT_PERKEMBANGAN_OPTIONS, { kosong: 'Pilih tingkat perkembangan' })}
                    {pilihan('mediaType', 'Media', MEDIA_OPTIONS)}
                    {teks('jumlah', 'Jumlah', { type: 'number' })}
                </div>
            </fieldset>

            <fieldset className="min-w-0 space-y-3">
                <legend className="mb-1 text-sm font-semibold">Lokasi Penyimpanan Fisik</legend>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {teks('lokasiFc', 'No. Filing Cabinet', { wajib: true, placeholder: 'Contoh: FC-01' })}
                    {teks('lokasiLaci', 'No. Laci', { wajib: true, placeholder: 'Contoh: L-02' })}
                    {teks('lokasiFolder', 'No. Folder', { wajib: true, placeholder: 'Contoh: F-003' })}
                </div>
                {bolehMemilihLokasiUnit(user, unitKerjaId) && (
                    <Bidang field="storageLocationId" label="Lokasi Simpan" petunjuk={PETUNJUK_LOKASI_SIMPAN}>
                        <LokasiSimpanPicker
                            {...atribut('storageLocationId', { petunjuk: PETUNJUK_LOKASI_SIMPAN })}
                            unitKerjaId={unitKerjaId}
                            value={form.storageLocationId}
                            onChange={ubah('storageLocationId')}
                            disabled={saving}
                        />
                    </Bidang>
                )}
            </fieldset>

            <fieldset className="min-w-0 space-y-3">
                <legend className="mb-1 text-sm font-semibold">Keamanan & Catatan</legend>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {pilihan('klasifikasiKeamanan', 'Klasifikasi Keamanan', opsiKelas, {
                        petunjuk: kelasDisembunyikan ? PESAN_KELAS_TERBATAS_PERAN : undefined,
                    })}
                    {teks('personInCharge', 'Penanggung Jawab')}
                </div>
                {kelasPerluPersetujuan(form.klasifikasiKeamanan) && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <p>{PESAN_KELAS_PERLU_PERSETUJUAN} Setelah disimpan, Anda mungkin perlu mengajukan persetujuan akses untuk membuka arsip ini.</p>
                    </div>
                )}
                <Bidang field="keterangan" label="Keterangan" galat={galatTampil.keterangan}>
                    <Textarea
                        {...atribut('keterangan', { galat: galatTampil.keterangan })}
                        value={form.keterangan}
                        onChange={ubahInput('keterangan')}
                        rows={2}
                        disabled={saving}
                    />
                </Bidang>
            </fieldset>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                <p><strong>Arsip bersifat permanen.</strong> {PESAN_TAMBAH_PERMANEN}</p>
                <div className="mt-2 flex items-start gap-2">
                    <Checkbox
                        id={ID('pernyataan')}
                        checked={form.pernyataan}
                        onCheckedChange={nilai => ubah('pernyataan')(nilai === true)}
                        disabled={saving}
                        aria-invalid={galatTampil.pernyataan ? true : undefined}
                        aria-describedby={galatTampil.pernyataan ? `${ID('pernyataan')}-galat` : undefined}
                    />
                    <Label htmlFor={ID('pernyataan')} className="text-xs font-normal leading-snug">
                        Saya sudah memeriksa isian dan memahami bahwa arsip ini tidak dapat dihapus.
                    </Label>
                </div>
                {galatTampil.pernyataan && <p id={`${ID('pernyataan')}-galat`} className="mt-1 font-medium text-destructive">{galatTampil.pernyataan}</p>}
            </div>

            {sudahDicoba && Object.keys(galat).length > 0 && (
                <Alert variant="destructive">
                    <AlertTriangle aria-hidden="true" />
                    <AlertDescription>Periksa kembali isian yang ditandai sebelum menyimpan.</AlertDescription>
                </Alert>
            )}
            {galatServer && (
                <Alert variant="destructive">
                    <AlertTriangle aria-hidden="true" />
                    <AlertDescription>{galatServer}</AlertDescription>
                </Alert>
            )}

            <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="w-full sm:w-auto">Batal</Button>
                <Button type="submit" disabled={saving} className="w-full sm:w-auto">
                    {saving
                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Menyimpan...</>
                        : <><Save className="mr-2 h-4 w-4" aria-hidden="true" /> Simpan Arsip</>}
                </Button>
            </DialogFooter>
        </form>
    )
}

/** Tambah Arsip dari daftar arsip (POST /api/arsip/manual) untuk satu unit kerja. */
export function TambahArsipDialog({ unitKerjaId, jenisAwal = 'lainnya', onSaved }) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    return (
        <Dialog open={open} onOpenChange={next => !saving && setOpen(next)}>
            <DialogTrigger asChild>
                <Button variant="default" size="sm" className="h-9">
                    <Plus className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Tambah Arsip
                </Button>
            </DialogTrigger>
            <DialogContent
                className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
                onEscapeKeyDown={event => saving && event.preventDefault()}
                onInteractOutside={event => saving && event.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Plus className="h-5 w-5 text-emerald-600" aria-hidden="true" /> Tambah Arsip
                    </DialogTitle>
                    <DialogDescription>
                        Catat arsip fisik yang belum ada di daftar surat. Penyimpanan tercatat di log audit.
                    </DialogDescription>
                </DialogHeader>
                {open && (
                    <FormTambahArsip
                        unitKerjaId={unitKerjaId}
                        jenisAwal={jenisAwal}
                        saving={saving}
                        setSaving={setSaving}
                        onClose={() => setOpen(false)}
                        onSaved={onSaved}
                    />
                )}
            </DialogContent>
        </Dialog>
    )
}

export default TambahArsipDialog
