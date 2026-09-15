import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, MapPin } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useRequiredUnitKerjaScope } from '@/hooks/use-required-unit-kerja-scope'
import { RequiredUnitKerjaScope } from '@/components/RequiredUnitKerjaScope'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import storageLocationService from '@/services/storage-location.service'

const levelLabels = { gedung: 'Gedung', ruang: 'Ruang', rak: 'Rak', box: 'Boks' }
const unavailable = 'Lokasi tidak tersedia atau Anda tidak memiliki akses.'

export default function StorageLocationDetail() {
    const { id } = useParams()
    const { user } = useAuth()
    const scope = useRequiredUnitKerjaScope(user)
    const unitKerjaId = scope.unitKerjaId
    const [request, setRequest] = useState(null)
    const [revision, setRevision] = useState(0)
    const requestKey = `${unitKerjaId}:${id}:${revision}`

    useEffect(() => {
        if (!unitKerjaId) return
        let active = true
        storageLocationService.getById(id, unitKerjaId)
            .then(location => {
                if (!active) return
                if (!location) {
                    setRequest({ key: requestKey, error: unavailable })
                } else if (location.id !== id) {
                    setRequest({ key: requestKey, error: 'Data lokasi tidak sesuai dengan tautan yang dibuka.', retryable: true })
                } else {
                    setRequest({ key: requestKey, location })
                }
            })
            .catch(error => {
                if (!active) return
                const denied = [403, 404].includes(error.status ?? error.response?.status)
                setRequest({ key: requestKey, error: denied ? unavailable : 'Gagal memuat lokasi. Periksa koneksi dan coba lagi.', retryable: !denied })
            })
        return () => { active = false }
    }, [id, unitKerjaId, requestKey])

    // A new QR/unit must never display a previous request's location while it loads.
    const current = unitKerjaId && request?.key === requestKey ? request : null
    const location = current?.location
    return (
        <section className="space-y-6">
            <Link to="/storage-locations" className="inline-flex min-h-11 items-center gap-2 text-sm text-primary hover:underline">
                <ArrowLeft className="h-4 w-4" /> Kembali ke lokasi penyimpanan
            </Link>
            <div className="flex items-center gap-3">
                <MapPin className="h-6 w-6 text-primary" />
                <h1 className="text-2xl font-semibold">{location?.name || 'Detail lokasi penyimpanan'}</h1>
            </div>
            <RequiredUnitKerjaScope scope={scope} />
            {unitKerjaId && !current && (
                <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Memuat lokasi…</p>
            )}
            {current?.error && (
                <div className="space-y-3 rounded-lg border p-4">
                    <p role="alert">{current.error}</p>
                    {current.retryable && <Button variant="outline" onClick={() => setRevision(value => value + 1)}>Coba lagi</Button>}
                </div>
            )}
            {location && (
                <Card><CardContent className="pt-6">
                    <dl className="grid gap-5 sm:grid-cols-2">
                        {[
                            ['Kode lokasi', location.code], ['Jenis lokasi', levelLabels[location.level] || location.level],
                            ['ID lokasi', location.id], ['Unit kerja', location.unitKerjaId],
                            ['Keterangan', location.description || '—'], ['Kapasitas', location.capacity ?? 'Tidak ditentukan'],
                            ['Jumlah arsip', location.currentCount ?? 0],
                        ].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}
                    </dl>
                </CardContent></Card>
            )}
        </section>
    )
}
