import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PESAN_VERSI_BARU, pembaruanAplikasi } from '@/lib/pembaruan-aplikasi'

/**
 * Pemberitahuan versi baru yang tidak menghalangi pekerjaan. Halaman hanya
 * dimuat ulang saat pengguna menekan Muat ulang (lib/pembaruan-aplikasi.js).
 */
export function PemberitahuanVersiBaru({ pembaruan = pembaruanAplikasi }) {
    const [keadaan, setKeadaan] = useState(() => pembaruan.keadaan())
    const [ditunda, setDitunda] = useState(false)

    useEffect(() => pembaruan.dengarkan((baru) => {
        setKeadaan(baru)
        setDitunda(false)
    }), [pembaruan])

    if (!keadaan.tersedia || ditunda) return null

    return (
        <div
            role="status"
            aria-live="polite"
            className="fixed left-4 right-4 top-20 z-[60] mx-auto max-w-sm rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg sm:left-auto sm:right-4 sm:mx-0 print:hidden"
        >
            <p className="flex items-start gap-2 text-sm">
                <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{PESAN_VERSI_BARU}</span>
            </p>
            <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setDitunda(true)}>
                    Nanti
                </Button>
                <Button type="button" size="sm" onClick={() => pembaruan.muatUlangVersiBaru()}>
                    Muat ulang
                </Button>
            </div>
        </div>
    )
}

export default PemberitahuanVersiBaru
