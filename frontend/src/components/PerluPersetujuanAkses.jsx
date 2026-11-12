import { useNavigate } from 'react-router-dom'
import { ArrowLeft, LockKeyhole } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LABEL_JENIS_REKAMAN, labelKelasTerkendali } from '@/lib/akses-rekaman'

const SEBUTAN = { surat_masuk: 'Surat', surat_keluar: 'Surat', arsip: 'Arsip' }

/**
 * Keadaan halaman detail saat rekaman ada di daftar pengguna tetapi belum
 * boleh dibuka karena kelas keamanannya memerlukan persetujuan akses.
 */
export function PerluPersetujuanAkses({ rekaman, daftarPath, daftarLabel }) {
    const navigate = useNavigate()
    const sebutan = SEBUTAN[rekaman.entityType] || 'Rekaman'
    const mintaAkses = () => navigate('/record-access-grants', {
        state: {
            mintaAkses: {
                entityType: rekaman.entityType,
                entityId: rekaman.entityId,
                nomor: rekaman.nomor,
                perihal: rekaman.perihal,
            },
        },
    })

    return (
        <div className="space-y-6">
            <Button variant="ghost" onClick={() => navigate(-1)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Kembali
            </Button>
            <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16">
                    <div className="bg-amber-100 dark:bg-amber-500/15 p-4 rounded-full mb-4">
                        <LockKeyhole className="h-12 w-12 text-amber-700 dark:text-amber-300" />
                    </div>
                    <h2 className="text-xl font-semibold mb-2">Perlu persetujuan akses</h2>
                    <p className="text-muted-foreground text-center max-w-md">
                        {sebutan} ini berkelas keamanan {labelKelasTerkendali(rekaman.klasifikasi)}. Datanya tetap tersimpan
                        dan tidak dihapus, tetapi isinya baru dapat dibuka setelah permohonan akses Anda disetujui Super Admin.
                    </p>
                    {(rekaman.nomor || rekaman.perihal) && (
                        <dl className="mt-4 w-full max-w-md rounded-md border bg-muted/40 p-3 text-sm">
                            <dt className="text-xs text-muted-foreground">{LABEL_JENIS_REKAMAN[rekaman.entityType]}</dt>
                            <dd className="font-medium break-words">{rekaman.nomor || 'Tanpa nomor'}</dd>
                            {rekaman.perihal && <dd className="text-muted-foreground break-words">{rekaman.perihal}</dd>}
                        </dl>
                    )}
                    <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                        <Button onClick={mintaAkses}>
                            <LockKeyhole className="mr-2 h-4 w-4" />
                            Minta Akses
                        </Button>
                        <Button variant="outline" onClick={() => navigate(daftarPath)}>{daftarLabel}</Button>
                    </div>
                    <p className="mt-4 text-xs text-muted-foreground text-center max-w-md">
                        Sudah mengajukan? Status permohonan dapat dipantau di menu Persetujuan Akses Arsip.
                    </p>
                </CardContent>
            </Card>
        </div>
    )
}

export default PerluPersetujuanAkses
