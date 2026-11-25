import { useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertCircle, RefreshCw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * Pengganti isi halaman detail surat yang tidak termuat. Hanya jawaban 404
 * (surat tidak ada atau tidak boleh dibuka) yang tampil sebagai "Surat Tidak
 * Ditemukan"; galat lain (jaringan, server, pembatasan) tampil sebagai "Surat
 * belum dapat dimuat" dengan tombol Coba lagi.
 */
export function SuratTidakTermuat({ galat, daftarPath, onCobaLagi }) {
    const navigate = useNavigate()
    const tidakDitemukan = !galat || galat.status === 404
    // Pesan dari services/api.js sudah berbahasa Indonesia; galat lain memakai kalimat umum.
    const pesanGagal = (galat?.status || galat?.code === 'NETWORK_ERROR') && galat.message
        ? galat.message
        : 'Periksa koneksi Anda, lalu coba lagi.'

    return (
        <div className="space-y-6">
            <Button variant="ghost" onClick={() => navigate(-1)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Kembali
            </Button>
            <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16" role={tidakDitemukan ? undefined : 'alert'}>
                    <div className="bg-muted/50 p-4 rounded-full mb-4">
                        <AlertCircle className={`h-12 w-12 ${tidakDitemukan ? 'text-muted-foreground' : 'text-destructive'}`} aria-hidden="true" />
                    </div>
                    <h2 className="text-xl font-semibold mb-2">{tidakDitemukan ? 'Surat Tidak Ditemukan' : 'Surat belum dapat dimuat'}</h2>
                    <p className="text-muted-foreground text-center max-w-sm">
                        {tidakDitemukan
                            ? 'Surat ini tidak tersedia. Mungkin sudah dihapus, atau Anda tidak memiliki akses untuk membukanya.'
                            : pesanGagal}
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-2">
                        {!tidakDitemukan && (
                            <Button onClick={onCobaLagi}>
                                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Coba lagi
                            </Button>
                        )}
                        <Button variant={tidakDitemukan ? 'default' : 'outline'} onClick={() => navigate(daftarPath)}>
                            Kembali ke Daftar Surat
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

export default SuratTidakTermuat
