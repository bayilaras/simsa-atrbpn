import { CheckCircle2, FileText } from 'lucide-react'
import { Progress } from '@/components/ui/progress'

/**
 * Penanda draf isian di bilah tombol formulir surat. Teksnya hanya menyebut
 * yang benar: isian tersimpan sementara di tab ini, hilang bila tab ditutup
 * atau pengguna keluar (lib/draf-isian.js).
 */
export function StatusDrafIsian({ status }) {
    if (!status) return null
    return (
        <span
            role="status"
            title="Isian ini hilang bila tab ditutup atau Anda keluar dari SIMSA."
            className="text-xs text-muted-foreground flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted"
        >
            {status === 'dipulihkan' ? (
                <><FileText className="h-3 w-3 text-blue-500" aria-hidden="true" /> Isian dipulihkan</>
            ) : (
                <><CheckCircle2 className="h-3 w-3 text-emerald-500" aria-hidden="true" /> Isian tersimpan sementara di tab ini</>
            )}
        </span>
    )
}

/**
 * Kemajuan unggah berkas PDF saat formulir surat disimpan. persen null berarti
 * tidak ada berkas yang sedang diunggah.
 */
export function KemajuanUnggah({ persen }) {
    if (persen === null || persen === undefined) return null
    const selesai = persen >= 100
    return (
        <div className="w-full max-w-xs space-y-1">
            <p className="text-xs text-muted-foreground">
                {selesai ? 'Berkas terunggah. Menyimpan surat…' : `Mengunggah berkas: ${persen}%`}
            </p>
            <Progress value={persen} aria-label="Kemajuan unggah berkas" className="h-1.5" />
        </div>
    )
}
