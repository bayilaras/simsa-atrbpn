import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { pesanGalat } from '@/lib/pesan-galat'

/**
 * Dialog satu isian teks dengan batas minimal (alasan/catatan ≥10, tujuan akses ≥20; GC "Alasan/catatan wajib").
 * Isian dan galat berada di komponen isi yang hanya terpasang selama dialog terbuka, sehingga membuka ulang
 * selalu mulai dari kosong tanpa setState di dalam effect.
 */
export function AlasanDialog({
    open, onOpenChange, title, description, label = 'Alasan', minLength = 10, submitLabel = 'Simpan', destructive = false, onSubmit, children,
}) {
    const [loading, setLoading] = useState(false)
    return (
        <Dialog open={open} onOpenChange={(value) => !loading && onOpenChange(value)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </DialogHeader>
                {children}
                <AlasanIsian
                    label={label} minLength={minLength} submitLabel={submitLabel} destructive={destructive}
                    loading={loading} setLoading={setLoading} onSubmit={onSubmit} onOpenChange={onOpenChange}
                />
            </DialogContent>
        </Dialog>
    )
}

function AlasanIsian({ label, minLength, submitLabel, destructive, loading, setLoading, onSubmit, onOpenChange }) {
    const id = useId()
    const [nilai, setNilai] = useState('')
    const [error, setError] = useState(null)
    const valid = nilai.trim().length >= minLength

    const kirim = async () => {
        setLoading(true)
        setError(null)
        try {
            await onSubmit(nilai.trim())
            setLoading(false)
            onOpenChange(false)
        } catch (err) {
            setLoading(false)
            setError(pesanGalat(err, 'Gagal menyimpan'))
        }
    }

    return (
        <>
            <div className="space-y-2">
                <Label htmlFor={id}>{label}</Label>
                <Textarea id={id} value={nilai} onChange={(event) => setNilai(event.target.value)} rows={4} disabled={loading} />
                <p className="text-xs text-muted-foreground">Minimal {minLength} karakter.</p>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Batal</Button>
                <Button type="button" variant={destructive ? 'destructive' : 'default'} onClick={kirim} disabled={!valid || loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    {submitLabel}
                </Button>
            </DialogFooter>
        </>
    )
}

export default AlasanDialog
