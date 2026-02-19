import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { FORMAT_OPTIONS, MEDIA_OPTIONS } from './constants'

export default function ArsipElektronikForm({ open, onOpenChange, form, setForm, onSubmit }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-auto">
                <DialogHeader>
                    <DialogTitle>Tambah Metadata Arsip Elektronik</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <div>
                        <label className="text-sm font-medium">Arsip ID *</label>
                        <Input
                            placeholder="UUID arsip"
                            value={form.arsipId}
                            onChange={(e) => setForm(f => ({ ...f, arsipId: e.target.value }))}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-sm font-medium">Format File *</label>
                            <Select value={form.formatFile} onValueChange={(v) => setForm(f => ({ ...f, formatFile: v }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {FORMAT_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-sm font-medium">Ukuran File (bytes)</label>
                            <Input type="number" placeholder="0" value={form.ukuranFile}
                                onChange={(e) => setForm(f => ({ ...f, ukuranFile: e.target.value }))} />
                        </div>
                    </div>
                    <div>
                        <label className="text-sm font-medium">Hash SHA-256</label>
                        <Input placeholder="Checksum integritas" value={form.hashSHA256}
                            onChange={(e) => setForm(f => ({ ...f, hashSHA256: e.target.value }))} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-sm font-medium">Resolusi (DPI)</label>
                            <Input type="number" placeholder="300" value={form.resolusiDPI}
                                onChange={(e) => setForm(f => ({ ...f, resolusiDPI: e.target.value }))} />
                        </div>
                        <div>
                            <label className="text-sm font-medium">Jumlah Halaman</label>
                            <Input type="number" placeholder="1" value={form.jumlahHalaman}
                                onChange={(e) => setForm(f => ({ ...f, jumlahHalaman: e.target.value }))} />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-sm font-medium">Media Asal</label>
                            <Select value={form.mediaAsal} onValueChange={(v) => setForm(f => ({ ...f, mediaAsal: v }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {MEDIA_OPTIONS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-sm font-medium">Media Tujuan</label>
                            <Select value={form.mediaTujuan} onValueChange={(v) => setForm(f => ({ ...f, mediaTujuan: v }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="digital">Digital</SelectItem>
                                    <SelectItem value="mikrofilm">Mikrofilm</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div>
                        <label className="text-sm font-medium">Tanggal Digitalisasi</label>
                        <Input type="date" value={form.tanggalDigitalisasi}
                            onChange={(e) => setForm(f => ({ ...f, tanggalDigitalisasi: e.target.value }))} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-sm font-medium">Alat Digitalisasi</label>
                            <Input placeholder="e.g. Canon DR-C225" value={form.alatDigitalisasi}
                                onChange={(e) => setForm(f => ({ ...f, alatDigitalisasi: e.target.value }))} />
                        </div>
                        <div>
                            <label className="text-sm font-medium">Software</label>
                            <Input placeholder="e.g. Adobe Acrobat" value={form.softwareDigitalisasi}
                                onChange={(e) => setForm(f => ({ ...f, softwareDigitalisasi: e.target.value }))} />
                        </div>
                    </div>
                    <div>
                        <label className="text-sm font-medium">Catatan Konversi</label>
                        <Textarea placeholder="Catatan proses digitalisasi/konversi" value={form.catatanKonversi}
                            onChange={(e) => setForm(f => ({ ...f, catatanKonversi: e.target.value }))} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
                    <Button onClick={onSubmit}>Simpan</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
