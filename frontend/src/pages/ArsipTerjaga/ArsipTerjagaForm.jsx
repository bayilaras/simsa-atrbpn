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
import { ShieldAlert, Search, FileCheck, Calendar } from 'lucide-react'
import { KATEGORI_CONFIG } from './constants'

export default function ArsipTerjagaForm({ open, onOpenChange, form, setForm, onSubmit, unitKerjaId }) {
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
        if (!val) { setArsipSearch(''); setArsipList([]) }
        onOpenChange(val)
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldAlert className="h-5 w-5 text-purple-600" />
                        Tetapkan Arsip Terjaga
                    </DialogTitle>
                    <DialogDescription>
                        Pilih arsip yang memenuhi kriteria arsip terjaga sesuai Permen ATR/BPN 2/2026.
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
                                        <div key={a.id} className="p-3 hover:bg-purple-50 dark:hover:bg-purple-500/15 cursor-pointer border-b last:border-0 text-sm group"
                                            onClick={() => { setForm(f => ({ ...f, arsipId: a.id })); setArsipSearch(a.nomorBerkas || a.uraianBerkas || a.id) }}>
                                            <div className="font-medium group-hover:text-purple-700 dark:group-hover:text-purple-300">{a.nomorBerkas || 'Tanpa Nomor'}</div>
                                            <div className="text-muted-foreground text-xs">{a.uraianBerkas || a.perihalOriginal || '-'}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {form.arsipId && (
                                <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/15 p-2 rounded border border-emerald-100">
                                    <FileCheck className="h-4 w-4" />
                                    <span>Arsip berhasil dipilih</span>
                                    <Button variant="ghost" size="sm" className="h-auto p-0 text-muted-foreground ml-auto hover:text-red-600 dark:hover:text-red-400"
                                        onClick={() => { setForm(f => ({ ...f, arsipId: '' })); setArsipSearch('') }}>Ubah</Button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Klasifikasi */}
                    <div className="space-y-3">
                        <Label className="text-base font-semibold">2. Klasifikasi & Dasar Hukum</Label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Kategori Terjaga (sesuai Permen) *</Label>
                                <Select value={form.kategoriTerjaga} onValueChange={v => setForm(f => ({ ...f, kategoriTerjaga: v }))}>
                                    <SelectTrigger><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(KATEGORI_CONFIG).map(([k, v]) => (
                                            <SelectItem key={k} value={k}>{v.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Dasar Hukum Penetapan</Label>
                                <Input
                                    value={form.dasarHukum}
                                    onChange={e => setForm(f => ({ ...f, dasarHukum: e.target.value }))}
                                    placeholder="Contoh: UU 43/2009, Permen ATR/BPN..."
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Uraian Isi Ringkas</Label>
                            <Textarea
                                value={form.uraianIsi}
                                onChange={e => setForm(f => ({ ...f, uraianIsi: e.target.value }))}
                                placeholder="Jelaskan isi ringkas arsip yang membuatnya dikategorikan terjaga..."
                                rows={2}
                            />
                        </div>
                    </div>

                    {/* Jadwal */}
                    <div className="space-y-3">
                        <Label className="text-base font-semibold">3. Jadwal Pelaporan</Label>
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 p-4 bg-muted/40 rounded-lg border">
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5" /> Tgl. Penetapan</Label>
                                <Input type="date" value={form.tanggalPenetapan} onChange={e => setForm(f => ({ ...f, tanggalPenetapan: e.target.value }))} />
                            </div>
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5" /> Next Review</Label>
                                <Input type="date" value={form.tanggalReviewSelanjutnya} onChange={e => setForm(f => ({ ...f, tanggalReviewSelanjutnya: e.target.value }))} />
                            </div>
                            <div className="space-y-2">
                                <Label>Periode (Hari)</Label>
                                <Input type="number" value={form.periodePelaporanHari} onChange={e => setForm(f => ({ ...f, periodePelaporanHari: Number(e.target.value) }))} min={1} />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Catatan Tambahan</Label>
                        <Textarea value={form.catatan} onChange={e => setForm(f => ({ ...f, catatan: e.target.value }))} rows={2} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => handleOpenChange(false)}>Batal</Button>
                    <Button onClick={onSubmit} disabled={!form.arsipId} className="bg-purple-600 hover:bg-purple-700">Tetapkan</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
