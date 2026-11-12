import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { tampilanDokumen } from './dokumen'

/**
 * Satu dokumen dalam daftar tunjuk silang: jenis, nomor, perihal/uraian, dan tautan ke halaman rincinya.
 * `label` berasal dari server; dokumen di luar jangkauan pemirsa tampil sebagai teks netral tanpa tautan.
 */
export function LabelDokumen({ tipe, id, label }) {
    const { user } = useAuth()
    const dokumen = tampilanDokumen(tipe, id, label, user?.role)
    const Icon = dokumen.jenis.icon

    if (!dokumen.terjangkau) {
        return (
            <div className="flex min-w-0 items-center gap-3">
                <div className="rounded-md bg-muted/50 p-1.5">
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <p className="min-w-0 text-sm italic text-muted-foreground">{dokumen.judul}</p>
            </div>
        )
    }

    const keterangan = [dokumen.jenis.label, dokumen.nomor ? `No: ${dokumen.nomor}` : null, dokumen.rincian]
        .filter(Boolean)
        .join(' • ')
    return (
        <div className="flex min-w-0 items-center gap-3">
            <div className={`rounded-md p-1.5 ${dokumen.jenis.bg}`}>
                <Icon className={`h-4 w-4 ${dokumen.jenis.color}`} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
                {dokumen.tautan ? (
                    <Link
                        to={dokumen.tautan}
                        className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <span className="truncate">{dokumen.judul}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                ) : (
                    <p className="truncate text-sm font-medium text-foreground">{dokumen.judul}</p>
                )}
                <p className="truncate text-xs text-muted-foreground">{keterangan}</p>
            </div>
        </div>
    )
}

export default LabelDokumen
