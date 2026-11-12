import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Link2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'
import { tunjukSilangService } from '@/services/tunjuk-silang.service'
import { LabelDokumen } from './LabelDokumen'
import { PERAN_PENGELOLA, alamatTunjukSilang, jenisRelasi } from './dokumen'

/**
 * Kartu baca-saja di halaman rinci surat/arsip: tunjuk silang aktif dokumen ini.
 * Server hanya mengirim hubungan yang dokumen terkaitnya boleh dibaca pemirsa. Bila dokumen ini
 * sendiri tidak dapat ditelusuri oleh pemirsa (404), kartu tidak ditampilkan.
 */
export function KartuTunjukSilang({ tipe, id }) {
    const { user } = useAuth()
    const kunci = `${tipe}:${id}`
    const [hasil, setHasil] = useState({ kunci: null, data: [], status: 'memuat' })

    useEffect(() => {
        if (!tipe || !id) return undefined
        let aktif = true
        tunjukSilangService.getByEntity(tipe, id)
            .then((response) => {
                if (aktif) setHasil({ kunci, data: response.data, status: 'siap' })
            })
            .catch((err) => {
                if (aktif) setHasil({ kunci, data: [], status: err?.status === 404 ? 'tersembunyi' : 'gagal' })
            })
        return () => { aktif = false }
    }, [kunci, tipe, id])

    if (!tipe || !id) return null
    const status = hasil.kunci === kunci ? hasil.status : 'memuat'
    if (status === 'tersembunyi') return null
    const bolehKelola = PERAN_PENGELOLA.includes(user?.role)

    let isi
    if (status === 'memuat') {
        isi = <p role="status" className="text-sm text-muted-foreground">Memuat tunjuk silang...</p>
    } else if (status === 'gagal') {
        isi = <p className="text-sm text-muted-foreground">Tunjuk silang belum dapat dimuat. Muat ulang halaman untuk mencoba lagi.</p>
    } else if (hasil.data.length === 0) {
        isi = <p className="text-sm text-muted-foreground">Tidak ada tunjuk silang yang dapat Anda lihat untuk dokumen ini.</p>
    } else {
        isi = (
            <ul className="space-y-3">
                {hasil.data.map((ref) => {
                    const relasi = jenisRelasi(ref.jenisRelasi)
                    return (
                        <li key={ref.id} className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-medium uppercase text-muted-foreground">
                                    {ref.direction === 'outgoing' ? 'Menunjuk ke' : 'Ditunjuk oleh'}
                                </span>
                                <Badge variant="outline" className={`h-5 text-[10px] ${relasi.color}`}>{relasi.label}</Badge>
                            </div>
                            <LabelDokumen tipe={ref.relatedType} id={ref.relatedId} label={ref.relatedLabel} />
                            {ref.keterangan && <p className="text-xs italic text-muted-foreground">{ref.keterangan}</p>}
                        </li>
                    )
                })}
            </ul>
        )
    }

    return (
        <Card className="shadow-sm">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <Link2 className="h-4 w-4 text-indigo-600" aria-hidden="true" />
                    Tunjuk Silang
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {isi}
                {bolehKelola && (
                    <Link
                        to={alamatTunjukSilang(tipe, id)}
                        className="inline-block text-sm font-medium text-indigo-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        Buka halaman Tunjuk Silang
                    </Link>
                )}
            </CardContent>
        </Card>
    )
}

export default KartuTunjukSilang
