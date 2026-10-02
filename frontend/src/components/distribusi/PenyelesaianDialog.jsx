import { useEffect, useState } from 'react'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import distributionService from '@/services/distribution.service'

/** Penyelesaian disposisi (§5): surat keluar approved milik unit di rangkaian yang sama, atau catatan ≥10. */
export function PenyelesaianDialog({ open, onOpenChange, distribusi, unitKerjaId, onSelesai }) {
    const { toast } = useToast()
    const [kandidat, setKandidat] = useState([])
    const [pilihan, setPilihan] = useState('')
    const [catatan, setCatatan] = useState('')
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!open || !distribusi) return undefined
        setPilihan('')
        setCatatan('')
        // Dialog dapat dibuka dari detail surat maupun Kotak Disposisi: jangan
        // tampilkan kandidat milik disposisi sebelumnya selama memuat.
        setKandidat([])
        let aktif = true
        distributionService.getKandidatPenyelesaian(distribusi.id, unitKerjaId)
            .then((rows) => { if (aktif) setKandidat(rows) })
            .catch(() => { if (aktif) setKandidat([]) })
        return () => { aktif = false }
    }, [open, distribusi, unitKerjaId])

    const siap = pilihan === 'catatan' ? catatan.trim().length >= 10 : Boolean(pilihan)

    const simpan = async () => {
        setLoading(true)
        try {
            await distributionService.process(distribusi.id, unitKerjaId, pilihan === 'catatan'
                ? { catatanPenyelesaian: catatan.trim() }
                : { penyelesaianSuratKeluarId: pilihan })
            toast({ title: 'Berhasil', description: 'Disposisi diselesaikan' })
            onOpenChange(false)
            onSelesai?.()
        } catch (error) {
            toast({ title: 'Error', description: error.response?.data?.error || error.message || 'Gagal menyelesaikan disposisi', variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(value) => !loading && onOpenChange(value)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Penyelesaian Disposisi</DialogTitle>
                    <DialogDescription>Pilih surat keluar penyelesaian yang sudah disetujui, atau tulis catatan penyelesaian.</DialogDescription>
                </DialogHeader>
                <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">Bukti penyelesaian</legend>
                    {kandidat.length === 0 && (
                        <p className="text-sm text-muted-foreground">Belum ada surat keluar disetujui milik unit Anda di rangkaian ini.</p>
                    )}
                    {kandidat.map((sk) => (
                        <label key={sk.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                            <input type="radio" name="penyelesaian" value={sk.id} checked={pilihan === sk.id} onChange={() => setPilihan(sk.id)} />
                            <span>{sk.nomorSurat || 'Tanpa nomor'} — {sk.perihal}</span>
                        </label>
                    ))}
                    <label className="flex items-start gap-2 rounded-md border p-2 text-sm">
                        <input type="radio" name="penyelesaian" value="catatan" checked={pilihan === 'catatan'} onChange={() => setPilihan('catatan')} />
                        <span>Catatan penyelesaian (tanpa surat keluar)</span>
                    </label>
                    {pilihan === 'catatan' && (
                        <div className="space-y-1">
                            <Textarea aria-label="Isi catatan penyelesaian" value={catatan} onChange={(event) => setCatatan(event.target.value)} rows={4} />
                            <p className="text-xs text-muted-foreground">Minimal 10 karakter.</p>
                        </div>
                    )}
                </fieldset>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Batal</Button>
                    <Button onClick={simpan} disabled={!siap || loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Simpan Penyelesaian
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
