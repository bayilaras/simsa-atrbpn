import { useEffect, useState } from 'react'
import { bacaTeksPdf } from '@/lib/teks-pdf'
import { letterPrefillService } from '@/services/letter-prefill.service'

const BELUM_ADA = { berkas: null, status: 'diam', terbaca: null }

/**
 * Membaca isian surat dari PDF yang dipilih di formulir: teksnya diambil di
 * peramban, lalu server membacanya menjadi isian. Hasilnya usulan saja.
 *
 * status: 'diam' (tidak aktif atau belum ada berkas), 'membaca', 'siap'
 * (`terbaca` berisi isian dari server), 'tanpa-teks' (PDF hasil pindai), atau
 * 'gagal'. Kegagalan tidak pernah menghalangi penyimpanan surat.
 */
export function useIsianDariPdf({ aktif, berkas }) {
    const [hasil, setHasil] = useState(BELUM_ADA)

    useEffect(() => {
        if (!aktif || !berkas) return undefined
        const pengendali = new AbortController()
        const { signal } = pengendali
        const selesai = (status, terbaca = null) => {
            if (!signal.aborted) setHasil({ berkas, status, terbaca })
        }
        void (async () => {
            try {
                const teks = await bacaTeksPdf(berkas, { signal })
                // Berkas sudah diganti atau dihapus: teksnya tidak dikirim.
                if (signal.aborted) return
                if (!teks) {
                    selesai('tanpa-teks')
                    return
                }
                selesai('siap', await letterPrefillService.bacaIsian(teks, { signal }))
            } catch {
                selesai('gagal')
            }
        })()
        return () => pengendali.abort()
    }, [aktif, berkas])

    if (!aktif || !berkas) return { status: 'diam', terbaca: null }
    // Hasil berkas sebelumnya tidak pernah ditampilkan untuk berkas yang baru dipilih.
    if (hasil.berkas !== berkas) return { status: 'membaca', terbaca: null }
    return { status: hasil.status, terbaca: hasil.terbaca }
}
