import { useCallback, useEffect, useState } from 'react'
import distributionService from '@/services/distribution.service'
import { useToast } from '@/hooks/use-toast'

const OPSI_KOSONG = { instruksi: [], jalurAksesTerkendali: false }

/**
 * Unit tujuan disposisi (D6: `bagian_*` hanya label, tidak pernah ditawarkan sebagai target)
 * dan chip instruksi + status jalur akses disposisi surat terkendali (§7). Dipakai DistributeDialog
 * (Task 22) dan GabungDialog (Task 24). `sourceUnitId` yang falsy (mis. dialog belum terbuka) tidak
 * memuat apa pun.
 */
export function useDisposisiOpsi(sourceUnitId) {
    const { toast } = useToast()
    const [loading, setLoading] = useState(false)
    const [units, setUnits] = useState([])
    const [opsi, setOpsi] = useState(OPSI_KOSONG)

    const muat = useCallback(async () => {
        setLoading(true)
        try {
            const [daftar, pilihan] = await Promise.all([
                distributionService.getDistributableUnits(sourceUnitId),
                distributionService.getOpsi().catch(() => OPSI_KOSONG),
            ])
            // D6: unit bagian hanya label, tidak pernah menjadi target disposisi.
            setUnits(Array.isArray(daftar) ? daftar.filter((unit) => unit.unitType !== 'bagian') : [])
            setOpsi(pilihan || OPSI_KOSONG)
        } catch (error) {
            console.error('Error loading units:', error)
            toast({ title: 'Error', description: 'Gagal memuat daftar unit kerja', variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }, [sourceUnitId, toast])

    useEffect(() => {
        if (sourceUnitId) void muat()
    }, [muat, sourceUnitId])

    return { units, instruksi: opsi.instruksi, jalurAksesTerkendali: opsi.jalurAksesTerkendali, loading }
}
