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
import { Edit } from 'lucide-react'
import { KATEGORI_CONFIG, KEKRITISAN_CONFIG, STATUS_PROTEKSI_CONFIG, METODE_PROTEKSI } from './constants'

export default function ArsipVitalDetail({
    open, onOpenChange, selectedItem, isEditing, setIsEditing,
    form, setForm, onUpdate
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEditing ? 'Edit Arsip Vital' : 'Detail Arsip Vital'}</DialogTitle>
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
                                <div className="flex flex-col items-end gap-1">
                                    <Badge variant="outline" className={KATEGORI_CONFIG[selectedItem.kategoriVital]?.color}>
                                        {KATEGORI_CONFIG[selectedItem.kategoriVital]?.label}
                                    </Badge>
                                    <Badge variant="outline" className={KEKRITISAN_CONFIG[selectedItem.tingkatKekritisan]?.color}>
                                        {KEKRITISAN_CONFIG[selectedItem.tingkatKekritisan]?.label}
                                    </Badge>
                                </div>
                            </div>
                            <div className="text-xs font-mono text-muted-foreground">
                                Kode Klasifikasi: {selectedItem.kodeKlasifikasi || '-'} | No. Surat: {selectedItem.nomorSuratOriginal || '-'}
                            </div>
                        </div>

                        {isEditing ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Kategori</Label>
                                        <Select value={form.kategoriVital} onValueChange={v => setForm(f => ({ ...f, kategoriVital: v }))}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {Object.entries(KATEGORI_CONFIG).map(([k, v]) => (
                                                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Kekritisan</Label>
                                        <Select value={form.tingkatKekritisan} onValueChange={v => setForm(f => ({ ...f, tingkatKekritisan: v }))}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {Object.entries(KEKRITISAN_CONFIG).map(([k, v]) => (
                                                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Status Proteksi</Label>
                                        <Select value={form.statusProteksi} onValueChange={v => setForm(f => ({ ...f, statusProteksi: v }))}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {Object.entries(STATUS_PROTEKSI_CONFIG).map(([k, v]) => (
                                                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Metode</Label>
                                        <Select value={form.metodeProteksi} onValueChange={v => setForm(f => ({ ...f, metodeProteksi: v }))}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {METODE_PROTEKSI.map(m => (
                                                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Alasan Penetapan</Label>
                                    <Textarea value={form.alasanPenetapan} onChange={e => setForm(f => ({ ...f, alasanPenetapan: e.target.value }))} rows={2} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Lokasi Backup</Label>
                                        <Input value={form.lokasiBackup} onChange={e => setForm(f => ({ ...f, lokasiBackup: e.target.value }))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Tgl. Review</Label>
                                        <Input type="date" value={form.tanggalReviewSelanjutnya} onChange={e => setForm(f => ({ ...f, tanggalReviewSelanjutnya: e.target.value }))} />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                                <div className="space-y-4">
                                    <div>
                                        <Label className="text-muted-foreground text-xs">Status Proteksi</Label>
                                        <div className="mt-1">
                                            <Badge variant="outline" className={STATUS_PROTEKSI_CONFIG[selectedItem.statusProteksi]?.color}>
                                                {STATUS_PROTEKSI_CONFIG[selectedItem.statusProteksi]?.label}
                                            </Badge>
                                        </div>
                                    </div>
                                    <div>
                                        <Label className="text-muted-foreground text-xs">Metode Proteksi</Label>
                                        <div className="font-medium mt-1">{selectedItem.metodeProteksi ? METODE_PROTEKSI.find(m => m.value === selectedItem.metodeProteksi)?.label : '-'}</div>
                                    </div>
                                    <div>
                                        <Label className="text-muted-foreground text-xs">Lokasi & Media</Label>
                                        <div className="font-medium mt-1">{selectedItem.lokasiBackup || '-'} ({selectedItem.mediaBackup || '-'})</div>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <Label className="text-muted-foreground text-xs">Alasan Penetapan</Label>
                                        <div className="mt-1">{selectedItem.alasanPenetapan || '-'}</div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <Label className="text-muted-foreground text-xs">Tgl. Penetapan</Label>
                                            <div>{selectedItem.tanggalPenetapan ? new Date(selectedItem.tanggalPenetapan).toLocaleDateString('id-ID') : '-'}</div>
                                        </div>
                                        <div>
                                            <Label className="text-muted-foreground text-xs">Jadwal Review</Label>
                                            <div className="text-red-600 font-medium">{selectedItem.tanggalReviewSelanjutnya ? new Date(selectedItem.tanggalReviewSelanjutnya).toLocaleDateString('id-ID') : '-'}</div>
                                        </div>
                                    </div>
                                    <div>
                                        <Label className="text-muted-foreground text-xs">Penanggung Jawab</Label>
                                        <div>{selectedItem.penanggungJawab || '-'}</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                <DialogFooter>
                    {isEditing ? (
                        <>
                            <Button variant="outline" onClick={() => setIsEditing(false)}>Batal</Button>
                            <Button onClick={onUpdate}>Simpan Perubahan</Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
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
