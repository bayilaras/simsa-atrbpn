import { useAppConfig } from '@/context/app-config-context'
import { Button } from '@/components/ui/button'

export function FileAvailabilityNotice() {
    const { capabilities, loading, configurationError, mode, checking, retryCapabilities } = useAppConfig()
    if (capabilities?.fileUploads && !loading) return null
    const message = loading ? 'Memeriksa ketersediaan layanan berkas…'
        : configurationError || (mode === 'metadata-demo'
            ? 'Unggah dan akses dokumen dinonaktifkan pada demo metadata.'
            : !capabilities?.files
                ? 'Layanan penyimpanan berkas belum tersedia. Metadata surat dan arsip tetap dapat dikelola. Hubungi administrator untuk mengaktifkan layanan berkas.'
                : 'Unggah ditunda karena layanan pemeriksaan keamanan berkas belum tersedia. Berkas yang telah lolos pemeriksaan tetap dapat diakses; berkas dalam karantina tetap terkunci. Hubungi administrator.')
    return <div role="note" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 print:hidden">
        <p>{message}</p>
        {configurationError && retryCapabilities && <Button type="button" variant="outline" className="mt-2"
            disabled={checking} onClick={retryCapabilities}>
            {checking ? 'Memeriksa layanan…' : 'Periksa lagi'}
        </Button>}
    </div>
}
