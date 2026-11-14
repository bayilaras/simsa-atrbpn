import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { pesanGalat } from '@/lib/pesan-galat'
import dosirService from '@/services/dosir.service'

// Batas yang sama dengan updateDosirSchema di server.
const MAKS_JUDUL = 500
const MAKS_DESKRIPSI = 2000

const tanggalInput = (nilai) => (nilai ? String(nilai).slice(0, 10) : '')

/**
 * Edit dari kartu daftar dosir, dengan isian yang sama seperti Buat Dosir Baru.
 * Status dan tanggal selesai diubah lewat Edit Dosir di halaman detail.
 * Isi dialog hanya terpasang selama dialog terbuka, jadi setiap pembukaan
 * mulai dari data dosir yang dipilih.
 */
export function EditDosirDialog({ open, onOpenChange, dosir, kategoriOptions = [], onBerhasil }) {
    const [menyimpan, setMenyimpan] = useState(false)
    return (
        <Dialog open={open && Boolean(dosir)} onOpenChange={(value) => !menyimpan && onOpenChange(value)}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Edit Dosir</DialogTitle>
                    <DialogDescription>
                        Perbarui judul, kategori, tanggal mulai, dan deskripsi dosir ini.
                    </DialogDescription>
                </DialogHeader>
                {dosir && (
                    <EditDosirIsi
                        dosir={dosir} kategoriOptions={kategoriOptions} menyimpan={menyimpan} setMenyimpan={setMenyimpan}
                        onOpenChange={onOpenChange} onBerhasil={onBerhasil}
                    />
                )}
            </DialogContent>
        </Dialog>
    )
}

function EditDosirIsi({ dosir, kategoriOptions, menyimpan, setMenyimpan, onOpenChange, onBerhasil }) {
    const { toast } = useToast()
    const [form, setForm] = useState(() => ({
        judul: dosir.judul || '',
        kategori: dosir.kategori || '',
        tanggalMulai: tanggalInput(dosir.tanggalMulai),
        deskripsi: dosir.deskripsi || '',
    }))
    // Kategori yang diisi bebas di halaman detail tetap tampil sebagai pilihan.
    const pilihanKategori = form.kategori && !kategoriOptions.includes(form.kategori)
        ? [form.kategori, ...kategoriOptions]
        : kategoriOptions
    const ubah = (field, value) => setForm((sebelum) => ({ ...sebelum, [field]: value }))

    const simpan = async () => {
        if (menyimpan || !form.judul.trim()) return
        setMenyimpan(true)
        try {
            await dosirService.update(dosir.id, { ...form, judul: form.judul.trim() })
            setMenyimpan(false)
            toast({ title: 'Dosir diperbarui', description: `Perubahan pada dosir ${dosir.kode} telah disimpan.` })
            onOpenChange(false)
            onBerhasil?.()
        } catch (error) {
            setMenyimpan(false)
            toast({
                title: 'Dosir gagal diperbarui',
                description: pesanGalat(error, 'Perubahan dosir belum tersimpan. Silakan coba lagi.'),
                variant: 'destructive',
            })
        }
    }

    return (
        <>
            <div className="grid gap-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="edit-dosir-judul">Judul Perkara *</Label>
                    <Input
                        id="edit-dosir-judul"
                        value={form.judul}
                        maxLength={MAKS_JUDUL}
                        onChange={(e) => ubah('judul', e.target.value)}
                    />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="edit-dosir-kategori">Kategori</Label>
                        <Select value={form.kategori} onValueChange={(value) => ubah('kategori', value)}>
                            <SelectTrigger id="edit-dosir-kategori">
                                <SelectValue placeholder="Pilih kategori" />
                            </SelectTrigger>
                            <SelectContent>
                                {pilihanKategori.map((kategori) => (
                                    <SelectItem key={kategori} value={kategori}>{kategori}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="edit-dosir-tanggal-mulai">Tanggal Mulai</Label>
                        <Input
                            id="edit-dosir-tanggal-mulai"
                            type="date"
                            value={form.tanggalMulai}
                            max={tanggalInput(dosir.tanggalSelesai) || undefined}
                            onChange={(e) => ubah('tanggalMulai', e.target.value)}
                        />
                    </div>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="edit-dosir-deskripsi">Deskripsi</Label>
                    <Textarea
                        id="edit-dosir-deskripsi"
                        value={form.deskripsi}
                        maxLength={MAKS_DESKRIPSI}
                        rows={3}
                        onChange={(e) => ubah('deskripsi', e.target.value)}
                    />
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={menyimpan}>
                    Batal
                </Button>
                <Button onClick={simpan} disabled={menyimpan || !form.judul.trim()} className="bg-indigo-600 hover:bg-indigo-700">
                    {menyimpan && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Simpan Perubahan
                </Button>
            </DialogFooter>
        </>
    )
}

export default EditDosirDialog
