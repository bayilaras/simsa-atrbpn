import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Edit, Send } from 'lucide-react'
import { KATEGORI_CONFIG, STATUS_PELAPORAN_CONFIG } from './constants'

export default function ArsipTerjagaDetail({
    open, onOpenChange, selectedItem, isEditing, setIsEditing,
    form, setForm, onUpdate, onOpenReport
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEditing ? 'Edit Arsip Terjaga' : 'Detail Arsip Terjaga'}</DialogTitle>
                </DialogHeader>
                {selectedItem && (
                    <div className="space-y-6">
                        {/* Arsip Info Header */}
                        <div className="bg-slate-50 p-4 rounded-lg border space-y-2">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h3 className="font-semibold text-lg">{selectedItem.nomorBerkas || 'Tanpa Nomor Berkas'}</h3>
                                    <p className="text-muted-foreground text-sm">{selectedItem.uraianBerkas || selectedItem.perihalOriginal}</p>
                                </div>
                                <Badge variant="outline" className={KATEGORI_CONFIG[selectedItem.kategoriTerjaga]?.color}>
                                    {KATEGORI_CONFIG[selectedItem.kategoriTerjaga]?.label}
                                </Badge>
                            </div>
                            <div className="text-xs font-mono text-muted-foreground">
                                Kode Klasifikasi: {selectedItem.kodeKlasifikasi || '-'} | No. Surat: {selectedItem.nomorSuratOriginal || '-'}
                            </div>
                        </div>

                        {isEditing ? (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Kategori Terjaga</Label>
                                    <Select value={form.kategoriTerjaga} onValueChange={v => setForm(f => ({ ...f, kategoriTerjaga: v }))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {Object.entries(KATEGORI_CONFIG).map(([k, v]) => (
                                                <SelectItem key={k} value={k}>{v.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Dasar Hukum</Label>
                                    <Textarea value={form.dasarHukum} onChange={e => setForm(f => ({ ...f, dasarHukum: e.target.value }))} rows={2} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Uraian Isi</Label>
                                    <Textarea value={form.uraianIsi} onChange={e => setForm(f => ({ ...f, uraianIsi: e.target.value }))} rows={3} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Tgl. Review Berikutnya</Label>
                                        <Input type="date" value={form.tanggalReviewSelanjutnya} onChange={e => setForm(f => ({ ...f, tanggalReviewSelanjutnya: e.target.value }))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Periode Lapor (Hari)</Label>
                                        <Input type="number" value={form.periodePelaporanHari} onChange={e => setForm(f => ({ ...f, periodePelaporanHari: Number(e.target.value) }))} />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Catatan</Label>
                                    <Textarea value={form.catatan} onChange={e => setForm(f => ({ ...f, catatan: e.target.value }))} rows={2} />
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                                <div className="space-y-4">
                                    <div>
                                        <Label className="text-muted-foreground text-xs">Status Pelaporan</Label>
                                        <div className="mt-1">
                                            <Badge variant="outline" className={STATUS_PELAPORAN_CONFIG[selectedItem.statusPelaporan]?.color}>
                                                {STATUS_PELAPORAN_CONFIG[selectedItem.statusPelaporan]?.label}
                                            </Badge>
                                        </div>
                                    </div>
                                    <div>
                                        <Label className="text-muted-foreground text-xs">No. Laporan ANRI</Label>
                                        <div className="font-medium mt-1">{selectedItem.nomorLaporanANRI || '-'}</div>
                                    </div>
                                    <div>
                                        <Label className="text-muted-foreground text-xs">Tanggal Pelaporan Terakhir</Label>
                                        <div className="font-medium mt-1">{selectedItem.tanggalPelaporan ? new Date(selectedItem.tanggalPelaporan).toLocaleDateString('id-ID') : '-'}</div>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <Label className="text-muted-foreground text-xs">Dasar Hukum</Label>
                                        <div className="mt-1">{selectedItem.dasarHukum || '-'}</div>
                                    </div>
                                    <div>
                                        <Label className="text-muted-foreground text-xs">Uraian Isi</Label>
                                        <div className="mt-1">{selectedItem.uraianIsi || '-'}</div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <Label className="text-muted-foreground text-xs">Tgl. Penetapan</Label>
                                            <div>{selectedItem.tanggalPenetapan ? new Date(selectedItem.tanggalPenetapan).toLocaleDateString('id-ID') : '-'}</div>
                                        </div>
                                        <div>
                                            <Label className="text-muted-foreground text-xs">Periode Lapor</Label>
                                            <div>{selectedItem.periodePelaporanHari || 365} hari</div>
                                        </div>
                                    </div>
                                </div>
                                <div className="col-span-2">
                                    <Label className="text-muted-foreground text-xs">Catatan</Label>
                                    <div className="mt-1 p-2 bg-muted/20 rounded border">{selectedItem.catatan || '-'}</div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                <DialogFooter className="gap-2 sm:gap-0">
                    {isEditing ? (
                        <>
                            <Button variant="outline" onClick={() => setIsEditing(false)}>Batal</Button>
                            <Button onClick={onUpdate}>Simpan Perubahan</Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
                            {selectedItem?.statusPelaporan === 'belum_dilaporkan' && (
                                <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => { onOpenChange(false); onOpenReport(selectedItem) }}>
                                    <Send className="h-4 w-4 mr-2" /> Laporkan ke ANRI
                                </Button>
                            )}
                            <Button variant="secondary" onClick={() => setIsEditing(true)}>
                                <Edit className="h-4 w-4 mr-2" /> Edit Data
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
