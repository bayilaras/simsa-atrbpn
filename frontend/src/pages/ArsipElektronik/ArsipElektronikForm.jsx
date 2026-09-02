import { useEffect, useState } from 'react'
import { Loader2, Search, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import api from '@/services/api'
import { arsipService } from '@/services/arsip.service'
import { MEDIA_OPTIONS } from './constants'

const MINIMUM_DPI = { paper: 300, cartographic: 400, photo: 600 }

export default function ArsipElektronikForm({ open, onOpenChange, form, setForm, onSubmit }) {
    const [pickerOpen, setPickerOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [archives, setArchives] = useState([])
    const [selectedArchive, setSelectedArchive] = useState(null)
    const [attachments, setAttachments] = useState([])
    const [loadingArchives, setLoadingArchives] = useState(false)
    const [loadingAttachments, setLoadingAttachments] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        if (!open || form.arsipId) return
        setSelectedArchive(null)
        setAttachments([])
        setError('')
    }, [open, form.arsipId])

    useEffect(() => {
        if (!pickerOpen) return
        const timer = window.setTimeout(async () => {
            setLoadingArchives(true)
            try {
                const result = await arsipService.search({ q: search, limit: 10 })
                setArchives(result.data || [])
            } catch (requestError) {
                setError(requestError.message || 'Gagal mencari arsip')
            } finally {
                setLoadingArchives(false)
            }
        }, 250)
        return () => window.clearTimeout(timer)
    }, [pickerOpen, search])

    const loadAttachments = async (arsipId) => {
        setLoadingAttachments(true)
        try {
            const result = await api.get(`/api/upload/arsip/${arsipId}`)
            setAttachments(result.data || [])
        } catch (requestError) {
            setError(requestError.message || 'Gagal memuat lampiran arsip')
            setAttachments([])
        } finally {
            setLoadingAttachments(false)
        }
    }

    const chooseArchive = async (archive) => {
        setSelectedArchive(archive)
        setForm(current => ({ ...current, arsipId: archive.id, fileAttachmentId: '' }))
        setPickerOpen(false)
        setError('')
        await loadAttachments(archive.id)
    }

    const uploadControlledAttachment = async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file || !form.arsipId) return

        setUploading(true)
        setError('')
        try {
            const payload = new FormData()
            payload.append('file', file)
            const result = await api.post(`/api/upload/arsip/${form.arsipId}`, payload)
            const attachment = result.data
            setAttachments(current => [attachment, ...current.filter(item => item.id !== attachment.id)])
            setForm(current => ({ ...current, fileAttachmentId: attachment.id }))
        } catch (requestError) {
            setError(requestError.message || 'Unggah lampiran gagal')
        } finally {
            setUploading(false)
        }
    }

    const minimumDpi = MINIMUM_DPI[form.scanCategory] || 300

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
                    <DialogHeader>
                        <DialogTitle>Registrasi Arsip Elektronik Terkendali</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Arsip induk *</Label>
                            <div className="flex gap-2">
                                <div className="min-w-0 flex-1 rounded-md border bg-muted/20 p-3 text-sm">
                                    {selectedArchive ? (
                                        <>
                                            <p className="font-medium">{selectedArchive.nomorBerkas || selectedArchive.id}</p>
                                            <p className="truncate text-muted-foreground">{selectedArchive.uraianBerkas || '-'}</p>
                                        </>
                                    ) : (
                                        <p className="text-muted-foreground">Belum ada arsip dipilih</p>
                                    )}
                                </div>
                                <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}>
                                    <Search className="mr-2 h-4 w-4" /> Cari
                                </Button>
                            </div>
                        </div>

                        {form.arsipId && (
                            <div className="space-y-2 rounded-lg border p-3">
                                <Label>Bitstream/lampiran terkendali *</Label>
                                <Select
                                    value={form.fileAttachmentId || ''}
                                    onValueChange={(value) => setForm(current => ({ ...current, fileAttachmentId: value }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={loadingAttachments ? 'Memuat lampiran...' : 'Pilih lampiran'} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {attachments.map(attachment => (
                                            <SelectItem key={attachment.id} value={attachment.id}>
                                                {attachment.fileName || attachment.id} ({attachment.sha256?.slice(0, 10) || 'hash belum ada'}…)
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="file"
                                        accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif"
                                        disabled={uploading}
                                        onChange={uploadControlledAttachment}
                                    />
                                    {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Format, ukuran, dan SHA-256 dihitung otomatis dari byte yang tersimpan; nilai tersebut tidak dapat diketik manual.
                                </p>
                            </div>
                        )}

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label>Sumber rekod *</Label>
                                <Select value={form.sourceType} onValueChange={(value) => setForm(current => ({ ...current, sourceType: value }))}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="digitized">Hasil alih media/pemindaian</SelectItem>
                                        <SelectItem value="born_digital">Tercipta secara digital</SelectItem>
                                        <SelectItem value="received">Diterima secara digital</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Jumlah halaman</Label>
                                <Input type="number" min="1" value={form.jumlahHalaman}
                                    onChange={(event) => setForm(current => ({ ...current, jumlahHalaman: event.target.value }))} />
                            </div>
                        </div>

                        {form.sourceType === 'digitized' && (
                            <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
                                <div className="space-y-1.5">
                                    <Label>Kategori pindai</Label>
                                    <Select value={form.scanCategory} onValueChange={(value) => setForm(current => ({
                                        ...current,
                                        scanCategory: value,
                                        resolusiDPI: String(MINIMUM_DPI[value] || 300),
                                    }))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="paper">Kertas (≥300 DPI)</SelectItem>
                                            <SelectItem value="cartographic">Kartografi (≥400 DPI)</SelectItem>
                                            <SelectItem value="photo">Foto (≥600 DPI)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Resolusi (min. {minimumDpi} DPI)</Label>
                                    <Input type="number" min={minimumDpi} max="2400" value={form.resolusiDPI}
                                        onChange={(event) => setForm(current => ({ ...current, resolusiDPI: event.target.value }))} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Kedalaman warna (min. 24-bit)</Label>
                                    <Input type="number" min="24" max="64" value={form.colorDepth}
                                        onChange={(event) => setForm(current => ({ ...current, colorDepth: event.target.value }))} />
                                </div>
                            </div>
                        )}

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label>Media asal</Label>
                                <Select value={form.mediaAsal} onValueChange={(value) => setForm(current => ({ ...current, mediaAsal: value }))}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {MEDIA_OPTIONS.map(media => <SelectItem key={media} value={media}>{media}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Tanggal digitalisasi</Label>
                                <Input type="date" value={form.tanggalDigitalisasi}
                                    onChange={(event) => setForm(current => ({ ...current, tanggalDigitalisasi: event.target.value }))} />
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label>Alat digitalisasi</Label>
                                <Input value={form.alatDigitalisasi} placeholder="Merek/tipe scanner"
                                    onChange={(event) => setForm(current => ({ ...current, alatDigitalisasi: event.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Perangkat lunak</Label>
                                <Input value={form.softwareDigitalisasi} placeholder="Nama dan versi"
                                    onChange={(event) => setForm(current => ({ ...current, softwareDigitalisasi: event.target.value }))} />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label>Catatan proses/konversi</Label>
                            <Textarea value={form.catatanKonversi} placeholder="Provenans, QC, atau perubahan format"
                                onChange={(event) => setForm(current => ({ ...current, catatanKonversi: event.target.value }))} />
                        </div>

                        {error && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
                        <Button onClick={onSubmit} disabled={!form.fileAttachmentId || uploading}>
                            <Upload className="mr-2 h-4 w-4" /> Registrasikan
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>Pilih Arsip Induk</DialogTitle></DialogHeader>
                    <Input value={search} onChange={(event) => setSearch(event.target.value)}
                        placeholder="Cari nomor berkas atau uraian..." />
                    <div className="max-h-[360px] overflow-y-auto rounded-md border">
                        {loadingArchives ? (
                            <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" /> Memuat arsip
                            </div>
                        ) : archives.length === 0 ? (
                            <p className="p-8 text-center text-muted-foreground">Arsip tidak ditemukan</p>
                        ) : archives.map(archive => (
                            <button key={archive.id} type="button" onClick={() => chooseArchive(archive)}
                                className="block w-full border-b p-3 text-left transition-colors last:border-0 hover:bg-muted">
                                <p className="font-medium">{archive.nomorBerkas || archive.id}</p>
                                <p className="text-sm text-muted-foreground">{archive.uraianBerkas || '-'}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{archive.kodeKlasifikasi || '-'} · {archive.tahun || '-'}</p>
                            </button>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
