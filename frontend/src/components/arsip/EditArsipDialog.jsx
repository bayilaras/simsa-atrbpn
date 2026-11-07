import { useMemo, useState } from 'react'
import { AlertTriangle, Info, Loader2, Pencil, Save } from 'lucide-react'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/hooks/use-toast'
import { arsipService } from '@/services/arsip.service'
import { adaKelasTersembunyi, bolehMemilihKelas, PESAN_KELAS_TERBATAS_PERAN, saringOpsiKelas } from '@/lib/kelas-keamanan'
import {
    FIELD_METADATA,
    KLASIFIKASI_KEAMANAN_OPTIONS,
    LABEL_FIELD,
    MEDIA_OPTIONS,
    PESAN_KELAS_PERLU_PERSETUJUAN,
    TINGKAT_PERKEMBANGAN_OPTIONS,
    UNIT_PENGOLAH_OPTIONS,
    fieldBerubah,
    formAwal,
    kelasPerluPersetujuan,
    opsiDenganNilaiLama,
    payloadPerubahan,
    peringkatKelas,
    pesanGalatUbahArsip,
    validasiForm,
} from './edit-arsip-form'

const ID = field => `ubah-arsip-${field}`
const ID_KURUN_DARI = 'ubah-arsip-kurunDari'
const ID_KURUN_TEKS = 'ubah-arsip-kurunTeks'
const PETUNJUK_KURUN_TEKS = 'Isian lama disimpan apa adanya. Contoh format: 2026-01-01 s/d 2026-12-31.'

function Bidang({ id, label, wajib, petunjuk, galat, className = '', children }) {
    return (
        <div className={`space-y-1.5 ${className}`}>
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

function atributKendali(id, { petunjuk, galat, wajib } = {}) {
    const keterangan = [petunjuk && `${id}-petunjuk`, galat && `${id}-galat`].filter(Boolean).join(' ')
    return {
        id,
        'aria-invalid': galat ? true : undefined,
        'aria-describedby': keterangan || undefined,
        'aria-required': wajib ? true : undefined,
    }
}

function Bagian({ judul, children }) {
    return (
        <fieldset className="min-w-0 space-y-3">
            <legend className="mb-1 text-sm font-semibold text-foreground">{judul}</legend>
            {children}
        </fieldset>
    )
}

function PilihanSelect({ field, value, options, onChange, disabled, galat, petunjuk, wajib, placeholder = 'Pilih...' }) {
    const id = ID(field)
    return (
        <Select name={field} value={value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger className="w-full" {...atributKendali(id, { petunjuk, galat, wajib })}>
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                {options.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

function FormUbahArsip({ arsip, saving, setSaving, onClose, onSaved }) {
    const { user } = useAuth()
    const { toast } = useToast()
    const role = user?.role
    // Isian awal dibekukan saat dialog dibuka; dialog dilepas saat ditutup.
    const [awal] = useState(() => formAwal(arsip))
    const [form, setForm] = useState(awal)
    const [sudahDicoba, setSudahDicoba] = useState(false)
    const [galatServer, setGalatServer] = useState('')

    const berubah = useMemo(() => fieldBerubah(form, awal), [form, awal])
    const adaPerubahan = berubah.length > 0
    const galat = useMemo(() => validasiForm(form, awal, role), [form, awal, role])
    const galatTampil = sudahDicoba ? galat : {}

    const opsiKelas = saringOpsiKelas(KLASIFIKASI_KEAMANAN_OPTIONS, role, arsip?.klasifikasiKeamanan)
    const kelasDisembunyikan = adaKelasTersembunyi(KLASIFIKASI_KEAMANAN_OPTIONS, role)
    // Sama dengan formulir surat: kelas tersimpan di atas plafon boleh
    // dipertahankan, jadi pesan umum "hanya Super Admin" diganti pesan ini.
    const kelasTersimpanDiAtasPlafon = Boolean(awal.klasifikasiKeamanan)
        && !bolehMemilihKelas(role, awal.klasifikasiKeamanan)
    const labelKelasTersimpan = KLASIFIKASI_KEAMANAN_OPTIONS
        .find(opt => opt.value === awal.klasifikasiKeamanan)?.label ?? awal.klasifikasiKeamanan
    const petunjukKelas = kelasTersimpanDiAtasPlafon
        ? `Kelas ${labelKelasTersimpan} yang sudah tersimpan boleh dipertahankan. Bila diganti lalu disimpan, kelas ini hanya dapat dipilih kembali oleh Super Admin.`
        : kelasDisembunyikan ? PESAN_KELAS_TERBATAS_PERAN : undefined
    const peringkatBaru = peringkatKelas(form.klasifikasiKeamanan)
    const peringkatSemula = peringkatKelas(awal.klasifikasiKeamanan) ?? 0
    const kelasNaikTerkendali = kelasPerluPersetujuan(form.klasifikasiKeamanan) && peringkatBaru > peringkatSemula
    const kelasTurunDariSumber = Boolean(arsip?.sourceSuratId) && peringkatBaru !== null && peringkatBaru < peringkatSemula
    const punyaRincianItem = Array.isArray(arsip?.items) && arsip.items.length > 0

    const ubah = field => value => {
        setForm(current => ({ ...current, [field]: value }))
        setGalatServer('')
    }
    const ubahInput = field => event => ubah(field)(event.target.value)

    const handleSubmit = async (event) => {
        event.preventDefault()
        if (saving || !adaPerubahan) return
        setSudahDicoba(true)
        const pertama = FIELD_METADATA.find(field => galat[field])
        if (pertama) {
            const idFokus = pertama !== 'kurunWaktu' ? ID(pertama)
                : awal.modeKurun === 'teks' ? ID_KURUN_TEKS : ID_KURUN_DARI
            document.getElementById(idFokus)?.focus()
            return
        }

        const perubahan = payloadPerubahan(form, awal)
        setGalatServer('')
        setSaving(true)
        let hasil
        try {
            hasil = await arsipService.update(arsip.id, perubahan)
        } catch (err) {
            setGalatServer(pesanGalatUbahArsip(err))
            setSaving(false)
            return
        }
        setSaving(false)
        toast({ title: 'Metadata arsip diperbarui' })
        onClose()
        onSaved?.(perubahan, hasil)
    }

    const teksInput = (field, { wajib, petunjuk, className, placeholder } = {}) => (
        <Bidang id={ID(field)} label={LABEL_FIELD[field]} wajib={wajib} petunjuk={petunjuk} galat={galatTampil[field]} className={className}>
            <Input
                {...atributKendali(ID(field), { petunjuk, galat: galatTampil[field], wajib })}
                value={form[field]}
                onChange={ubahInput(field)}
                placeholder={placeholder}
                disabled={saving}
            />
        </Bidang>
    )

    const teksPanjang = (field, { wajib, petunjuk, className } = {}) => (
        <Bidang id={ID(field)} label={LABEL_FIELD[field]} wajib={wajib} petunjuk={petunjuk} galat={galatTampil[field]} className={className}>
            <Textarea
                {...atributKendali(ID(field), { petunjuk, galat: galatTampil[field], wajib })}
                value={form[field]}
                onChange={ubahInput(field)}
                rows={3}
                disabled={saving}
            />
        </Bidang>
    )

    const pilihan = (field, options, { wajib, petunjuk, className } = {}) => (
        <Bidang id={ID(field)} label={LABEL_FIELD[field]} wajib={wajib} petunjuk={petunjuk} galat={galatTampil[field]} className={className}>
            <PilihanSelect
                field={field}
                value={form[field]}
                options={options}
                onChange={ubah(field)}
                disabled={saving}
                galat={galatTampil[field]}
                petunjuk={petunjuk}
                wajib={wajib}
            />
        </Bidang>
    )

    const galatKurun = galatTampil.kurunWaktu
    const idGalatKurun = `${ID('kurunWaktu')}-galat`

    return (
        <form id="form-ubah-arsip" onSubmit={handleSubmit} noValidate className="space-y-6">
            <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Kode klasifikasi arsip dan JRA tidak diubah di sini; gunakan Rekonsiliasi Klasifikasi/JRA.</span>
            </p>

            <Bagian judul="Identitas Berkas">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {teksInput('nomorBerkas', { wajib: true })}
                    {pilihan('unitPengolah', opsiDenganNilaiLama(UNIT_PENGOLAH_OPTIONS, awal.unitPengolah), { wajib: true })}
                    {teksPanjang('uraianBerkas', { wajib: true, className: 'sm:col-span-2' })}
                    {awal.modeKurun === 'teks' ? (
                        <Bidang id={ID_KURUN_TEKS} label={LABEL_FIELD.kurunWaktu} petunjuk={PETUNJUK_KURUN_TEKS} galat={galatKurun} className="sm:col-span-2">
                            <Input
                                {...atributKendali(ID_KURUN_TEKS, { petunjuk: PETUNJUK_KURUN_TEKS, galat: galatKurun })}
                                value={form.kurunTeks}
                                onChange={ubahInput('kurunTeks')}
                                disabled={saving}
                            />
                        </Bidang>
                    ) : (
                        <fieldset className="min-w-0 space-y-1.5 sm:col-span-2">
                            <legend className="text-sm font-medium leading-none">{LABEL_FIELD.kurunWaktu}</legend>
                            <div className="grid grid-cols-1 gap-2 pt-1.5 sm:grid-cols-2">
                                <div className="min-w-0 space-y-1">
                                    <Label htmlFor={ID_KURUN_DARI} className="text-xs font-normal text-muted-foreground">Dari</Label>
                                    <Input
                                        id={ID_KURUN_DARI}
                                        type="date"
                                        value={form.kurunDari}
                                        onChange={ubahInput('kurunDari')}
                                        aria-invalid={galatKurun ? true : undefined}
                                        aria-describedby={galatKurun ? idGalatKurun : undefined}
                                        disabled={saving}
                                    />
                                </div>
                                <div className="min-w-0 space-y-1">
                                    <Label htmlFor="ubah-arsip-kurunSampai" className="text-xs font-normal text-muted-foreground">Sampai</Label>
                                    <Input
                                        id="ubah-arsip-kurunSampai"
                                        type="date"
                                        value={form.kurunSampai}
                                        onChange={ubahInput('kurunSampai')}
                                        aria-invalid={galatKurun ? true : undefined}
                                        aria-describedby={galatKurun ? idGalatKurun : undefined}
                                        disabled={saving}
                                    />
                                </div>
                            </div>
                            {galatKurun && <p id={idGalatKurun} className="text-xs font-medium text-destructive">{galatKurun}</p>}
                        </fieldset>
                    )}
                </div>
            </Bagian>

            <Bagian judul="Item Arsip">
                {punyaRincianItem && (
                    <p className="text-xs text-muted-foreground">
                        Perubahan nomor, uraian, tingkat perkembangan, dan tanggal juga diterapkan pada item yang menjadi ringkasan berkas di tab Item Arsip bila item itu dapat dikenali. Jumlah dan media tidak mengubah daftar item.
                    </p>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {teksInput('nomorItem')}
                    {pilihan('tingkatPerkembangan', opsiDenganNilaiLama(TINGKAT_PERKEMBANGAN_OPTIONS, awal.tingkatPerkembangan))}
                    {teksPanjang('uraianItem', { className: 'sm:col-span-2' })}
                    <Bidang id={ID('tanggalArsip')} label={LABEL_FIELD.tanggalArsip} galat={galatTampil.tanggalArsip}>
                        <Input
                            {...atributKendali(ID('tanggalArsip'), { galat: galatTampil.tanggalArsip })}
                            type="date"
                            value={form.tanggalArsip}
                            onChange={ubahInput('tanggalArsip')}
                            disabled={saving}
                        />
                    </Bidang>
                    <Bidang id={ID('jumlah')} label={LABEL_FIELD.jumlah} galat={galatTampil.jumlah}>
                        <Input
                            {...atributKendali(ID('jumlah'), { galat: galatTampil.jumlah })}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={10000}
                            step={1}
                            value={form.jumlah}
                            onChange={ubahInput('jumlah')}
                            disabled={saving}
                        />
                    </Bidang>
                    {pilihan('mediaType', opsiDenganNilaiLama(MEDIA_OPTIONS, awal.mediaType), { wajib: true })}
                </div>
            </Bagian>

            <Bagian judul="Lokasi Penyimpanan Fisik">
                {punyaRincianItem && (
                    <p className="text-xs text-muted-foreground">
                        Lokasi baru juga diterapkan pada item yang tersimpan di lokasi lama yang sama.
                    </p>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {teksInput('lokasiFc', { wajib: true, placeholder: 'Contoh: FC-01' })}
                    {teksInput('lokasiLaci', { wajib: true, placeholder: 'Contoh: L-02' })}
                    {teksInput('lokasiFolder', { wajib: true, placeholder: 'Contoh: F-003' })}
                </div>
            </Bagian>

            <Bagian judul="Keamanan & Catatan">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {pilihan('klasifikasiKeamanan', opsiKelas, {
                        petunjuk: petunjukKelas,
                    })}
                    {teksInput('personInCharge')}
                </div>
                {kelasNaikTerkendali && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <p>
                            {PESAN_KELAS_PERLU_PERSETUJUAN} Setelah disimpan, Anda mungkin perlu mengajukan persetujuan akses untuk membuka arsip ini lagi.
                        </p>
                    </div>
                )}
                {kelasTurunDariSumber && (
                    <p className="text-xs text-muted-foreground">
                        Kelas arsip tidak boleh lebih rendah dari kelas surat sumbernya; server memeriksanya saat disimpan.
                    </p>
                )}
                {teksPanjang('keterangan')}
            </Bagian>

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

            <DialogFooter className="gap-2 sm:items-center">
                {!adaPerubahan && (
                    <p id="ubah-arsip-status" className="order-last text-center text-xs text-muted-foreground sm:order-first sm:mr-auto sm:text-left">
                        Belum ada perubahan untuk disimpan.
                    </p>
                )}
                <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="w-full sm:w-auto">
                    Batal
                </Button>
                <Button
                    type="submit"
                    disabled={saving || !adaPerubahan}
                    aria-describedby={!adaPerubahan ? 'ubah-arsip-status' : undefined}
                    className="w-full sm:w-auto"
                >
                    {saving
                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Menyimpan...</>
                        : <><Save className="mr-2 h-4 w-4" aria-hidden="true" /> Simpan</>}
                </Button>
            </DialogFooter>
        </form>
    )
}

/**
 * Koreksi metadata arsip lewat PUT /api/arsip/:id. Hanya field yang diubah
 * yang dikirim; klasifikasi/JRA dan retensi punya alur sendiri.
 */
export function EditArsipDialog({ open, onOpenChange, arsip, onSaved }) {
    const [saving, setSaving] = useState(false)
    const tutup = () => onOpenChange(false)

    return (
        <Dialog open={open} onOpenChange={next => !saving && onOpenChange(next)}>
            <DialogContent
                className="sm:max-w-2xl"
                onEscapeKeyDown={event => saving && event.preventDefault()}
                onInteractOutside={event => saving && event.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Pencil className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                        Ubah Metadata Arsip
                    </DialogTitle>
                    <DialogDescription>
                        Perbaiki data berkas yang salah catat. Hanya isian yang Anda ubah yang disimpan, dan perubahan tercatat di log audit.
                    </DialogDescription>
                </DialogHeader>
                {open && arsip && (
                    <FormUbahArsip
                        arsip={arsip}
                        saving={saving}
                        setSaving={setSaving}
                        onClose={tutup}
                        onSaved={onSaved}
                    />
                )}
            </DialogContent>
        </Dialog>
    )
}

export default EditArsipDialog
