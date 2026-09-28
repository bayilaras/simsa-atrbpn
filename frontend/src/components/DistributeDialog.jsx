import { useState } from 'react'
import { Loader2, Send, ShieldAlert } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useDisposisiOpsi } from '@/hooks/use-disposisi-opsi'
import distributionService from '@/services/distribution.service'
import { appendInstruksi, hariIniJakarta, isSifatTerkendali, PESAN_TERKENDALI } from '@/lib/tindak-lanjut'

export { PESAN_TERKENDALI }

/** Disposisi ke Direktorat (§7): multi-target, chip instruksi, batas waktu, penanggung jawab (Unit Pengolah). */
export function DistributeDialog({ open, onOpenChange, suratData, sourceUnitId, onSuccess }) {
    const { toast } = useToast()
    const [loading, setLoading] = useState(false)
    const [targets, setTargets] = useState([])
    const [penanggungJawab, setPenanggungJawab] = useState('')
    const [batasWaktu, setBatasWaktu] = useState('')
    const [instruction, setInstruction] = useState('')
    const { units, instruksi, jalurAksesTerkendali, loading: loadingUnits } = useDisposisiOpsi(open ? sourceUnitId : null)
    const terkendali = isSifatTerkendali(suratData?.sifatSurat)
    const diblokir = terkendali && !jalurAksesTerkendali

    const reset = () => {
        setTargets([])
        setPenanggungJawab('')
        setBatasWaktu('')
        setInstruction('')
    }

    const toggleTarget = (id) => {
        setTargets((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
        setPenanggungJawab((prev) => (prev === id ? '' : prev))
    }
    const tambahInstruksi = (teks) => setInstruction((prev) => appendInstruksi(prev, teks))

    const handleSubmit = async () => {
        if (!sourceUnitId) {
            toast({ title: 'Unit kerja belum dipilih', description: 'Disposisi memerlukan unit pencatat yang konkret.', variant: 'destructive' })
            return
        }
        if (targets.length === 0) {
            toast({ title: 'Validasi', description: 'Pilih minimal satu unit tujuan', variant: 'destructive' })
            return
        }
        setLoading(true)
        try {
            await distributionService.distributeMany({
                suratMasukId: suratData.id,
                sourceUnitId,
                targets: targets.map((unitKerjaId) => ({
                    unitKerjaId,
                    penanggungJawab: unitKerjaId === penanggungJawab,
                    ...(batasWaktu ? { batasWaktu } : {}),
                })),
                instruksi: instruction.trim() || null,
            })
            toast({ title: 'Berhasil', description: `Surat didisposisikan ke ${targets.length} unit` })
            reset()
            onOpenChange(false)
            onSuccess?.()
        } catch (error) {
            console.error('Error distributing:', error)
            toast({ title: 'Error', description: error.response?.data?.error || error.message || 'Gagal mendisposisikan surat', variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }

    const handleClose = () => {
        if (loading) return
        reset()
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Send className="h-5 w-5 text-primary" />
                        Disposisi ke Direktorat
                    </DialogTitle>
                    <DialogDescription>Teruskan surat ke satu atau beberapa unit untuk ditindaklanjuti</DialogDescription>
                </DialogHeader>

                <div className="max-h-[65vh] space-y-4 overflow-y-auto py-2">
                    {suratData && (
                        <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
                            <p><span className="text-muted-foreground">Nomor Surat:</span> <span className="font-medium">{suratData.nomorSurat}</span></p>
                            <p className="truncate"><span className="text-muted-foreground">Perihal:</span> {suratData.perihal}</p>
                        </div>
                    )}
                    {diblokir && (
                        <Alert variant="destructive">
                            <ShieldAlert className="h-4 w-4" />
                            <AlertDescription>{PESAN_TERKENDALI}</AlertDescription>
                        </Alert>
                    )}
                    {terkendali && !diblokir && (
                        <Alert>
                            <ShieldAlert className="h-4 w-4" />
                            <AlertDescription>Permohonan akses disposisi akan diajukan untuk admin unit tujuan dan menunggu persetujuan super admin.</AlertDescription>
                        </Alert>
                    )}

                    <fieldset className="space-y-2" disabled={diblokir || loadingUnits}>
                        <legend className="text-sm font-medium">Unit tujuan <span className="text-destructive">*</span></legend>
                        {loadingUnits ? (
                            <p className="text-sm text-muted-foreground">Memuat...</p>
                        ) : (
                            <div className="grid gap-2 sm:grid-cols-2">
                                {units.map((unit) => (
                                    <label key={unit.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                                        <input type="checkbox" checked={targets.includes(unit.id)} onChange={() => toggleTarget(unit.id)} />
                                        {unit.name}
                                    </label>
                                ))}
                            </div>
                        )}
                    </fieldset>

                    {targets.length > 0 && (
                        <fieldset className="space-y-2" disabled={diblokir}>
                            <legend className="text-sm font-medium">Penanggung jawab (Unit Pengolah)</legend>
                            {targets.map((id) => (
                                <label key={id} className="flex items-center gap-2 text-sm">
                                    <input type="radio" name="penanggung-jawab" value={id} checked={penanggungJawab === id} onChange={() => setPenanggungJawab(id)} />
                                    {units.find((unit) => unit.id === id)?.name || id}
                                </label>
                            ))}
                        </fieldset>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="batas-waktu-disposisi">Batas waktu</Label>
                        <Input id="batas-waktu-disposisi" type="date" min={hariIniJakarta()} value={batasWaktu} onChange={(event) => setBatasWaktu(event.target.value)} disabled={diblokir} />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="instruction">Instruksi / Catatan</Label>
                        {instruksi.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {instruksi.map((teks) => (
                                    <Button key={teks} type="button" size="sm" variant="outline" onClick={() => tambahInstruksi(teks)} disabled={diblokir}>{teks}</Button>
                                ))}
                            </div>
                        )}
                        <Textarea id="instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={3} disabled={diblokir}
                            placeholder="Contoh: Mohon ditindaklanjuti sesuai tugas pokok dan fungsi..." />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={loading}>Batal</Button>
                    <Button onClick={handleSubmit} disabled={loading || diblokir || !sourceUnitId || targets.length === 0}>
                        {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Mengirim...</>) : (<><Send className="mr-2 h-4 w-4" />Disposisikan</>)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
