import { useState, useCallback } from 'react'
import { arsipService } from '@/services/arsip.service'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ShieldAlert, Search, FileText } from 'lucide-react'
import { KATEGORI_CONFIG, KEKRITISAN_CONFIG, METODE_PROTEKSI } from './constants'

export default function ArsipVitalForm({ open, onOpenChange, form, setForm, onSubmit, unitKerjaId }) {
    const [arsipSearch, setArsipSearch] = useState('')
    const [arsipList, setArsipList] = useState([])
    const [loadingArsip, setLoadingArsip] = useState(false)

    const searchArsip = useCallback(async (query) => {
        if (!query || query.length < 3) return
        setLoadingArsip(true)
        try {
            const res = await arsipService.search({ q: query, limit: 5, unitKerjaId })
            if (res.success) setArsipList(res.data)
        } catch (err) {
            console.error(err)
        } finally {
            setLoadingArsip(false)
        }
    }, [unitKerjaId])

    const handleOpenChange = (val) => {
        if (!val) {
            setArsipSearch('')
            setArsipList([])
        }
        onOpenChange(val)
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldAlert className="h-5 w-5 text-red-600" />
                        Tetapkan Arsip Vital
                    </DialogTitle>
                    <DialogDescription>
                        Pastikan arsip memenuhi kriteria vital: esensial, tak tergantikan, dan krusial bagi organisasi.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 py-4">
                    {/* Arsip Picker */}
                    <div className="space-y-3">
                        <Label className="text-base font-semibold">1. Identifikasi Arsip</Label>
                        <div className="p-4 bg-muted/40 rounded-lg space-y-3 border">
                            <Label>Cari Arsip dari Database *</Label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Ketik nomor berkas atau isi ringkas..."
                                    value={arsipSearch}
                                    onChange={e => { setArsipSearch(e.target.value); searchArsip(e.target.value) }}
                                    className="pl-9"
                                />
                            </div>
                            {loadingArsip && <p className="text-xs text-muted-foreground animate-pulse">Sedang mencari...</p>}
                            {arsipList.length > 0 && !form.arsipId && (
                                <div className="border rounded-md max-h-40 overflow-y-auto bg-card shadow-sm">
                                    {arsipList.map(a => (
                                        <div key={a.id} className="p-3 hover:bg-muted/50 cursor-pointer border-b last:border-0 text-sm group"
                                            onClick={() => { setForm(f => ({ ...f, arsipId: a.id })); setArsipSearch(a.nomorBerkas || a.uraianBerkas || a.id) }}>
                                            <div className="font-medium group-hover:text-red-700 dark:group-hover:text-red-300">{a.nomorBerkas || 'Tanpa Nomor'}</div>
                                            <div className="text-muted-foreground text-xs">{a.uraianBerkas || a.perihalOriginal || '-'}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {form.arsipId && (
                                <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/15 p-2 rounded border border-emerald-100">
                                    <FileText className="h-4 w-4" />
                                    <span>Arsip berhasil dipilih</span>
                                    <Button variant="ghost" size="sm" className="h-auto p-0 text-muted-foreground ml-auto hover:text-red-600"
                                        onClick={() => { setForm(f => ({ ...f, arsipId: '' })); setArsipSearch('') }}>Ubah</Button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Klasifikasi */}
                    <div className="space-y-3">
                        <Label className="text-base font-semibold">2. Klasifikasi Kepentingan</Label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Kategori Vital *</Label>
                                <Select value={form.kategoriVital} onValueChange={v => setForm(f => ({ ...f, kategoriVital: v }))}>
                                    <SelectTrigger><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(KATEGORI_CONFIG).map(([k, v]) => (
                                            <SelectItem key={k} value={k}>{v.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Tingkat Kekritisan *</Label>
                                <Select value={form.tingkatKekritisan} onValueChange={v => setForm(f => ({ ...f, tingkatKekritisan: v }))}>
                                    <SelectTrigger><SelectValue placeholder="Pilih tingkat" /></SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(KEKRITISAN_CONFIG).map(([k, v]) => (
                                            <SelectItem key={k} value={k}>{v.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Alasan Penetapan</Label>
                            <Textarea
                                value={form.alasanPenetapan}
                                onChange={e => setForm(f => ({ ...f, alasanPenetapan: e.target.value }))}
                                placeholder="Jelaskan alasan mengapa arsip ini sangat vital..."
                                rows={2}
                            />
                        </div>
                    </div>

                    {/* Proteksi */}
                    <div className="space-y-3">
                        <Label className="text-base font-semibold">3. Metode Proteksi & Backup</Label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/40 p-4 rounded-lg border">
                            <div className="space-y-2">
                                <Label>Metode Proteksi</Label>
                                <Select value={form.metodeProteksi} onValueChange={v => setForm(f => ({ ...f, metodeProteksi: v }))}>
                                    <SelectTrigger><SelectValue placeholder="Pilih metode" /></SelectTrigger>
                                    <SelectContent>
                                        {METODE_PROTEKSI.map(m => (
                                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Jadwal Backup</Label>
                                <Select value={form.jadwalBackup} onValueChange={v => setForm(f => ({ ...f, jadwalBackup: v }))}>
                                    <SelectTrigger><SelectValue placeholder="Pilih jadwal" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="harian">Harian</SelectItem>
                                        <SelectItem value="mingguan">Mingguan</SelectItem>
                                        <SelectItem value="bulanan">Bulanan</SelectItem>
                                        <SelectItem value="tahunan">Tahunan</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Lokasi Backup/Simpan</Label>
                                <Input value={form.lokasiBackup} onChange={e => setForm(f => ({ ...f, lokasiBackup: e.target.value }))} placeholder="contoh: Data Center, Lemari Besi" />
                            </div>
                            <div className="space-y-2">
                                <Label>Media Backup</Label>
                                <Input value={form.mediaBackup} onChange={e => setForm(f => ({ ...f, mediaBackup: e.target.value }))} placeholder="contoh: HDD, Cloud, Microfilm" />
                            </div>
                        </div>
                    </div>

                    {/* Tanggal */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Tgl. Penetapan</Label>
                            <Input type="date" value={form.tanggalPenetapan} onChange={e => setForm(f => ({ ...f, tanggalPenetapan: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                            <Label>Tgl. Review Berikutnya</Label>
                            <Input type="date" value={form.tanggalReviewSelanjutnya} onChange={e => setForm(f => ({ ...f, tanggalReviewSelanjutnya: e.target.value }))} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Penanggung Jawab</Label>
                        <Input value={form.penanggungJawab} onChange={e => setForm(f => ({ ...f, penanggungJawab: e.target.value }))} placeholder="Nama penanggung jawab..." />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => handleOpenChange(false)}>Batal</Button>
                    <Button onClick={onSubmit} disabled={!form.arsipId} className="bg-red-600 hover:bg-red-700">Tetapkan</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
