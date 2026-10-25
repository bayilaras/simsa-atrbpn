import { Link } from 'react-router-dom'
import { useAppConfig } from '@/context/app-config-context'
import { FileAvailabilityNotice } from './FileAvailabilityNotice'

export function FileCapabilityGuard({ children, upload = false }) {
    const { capabilities, loading } = useAppConfig()
    if (loading || !capabilities?.files || (upload && !capabilities?.fileUploads)) {
        return <section className="space-y-4 p-6" aria-label="Ketersediaan layanan berkas">
            <h1 className="text-xl font-semibold">Layanan berkas</h1>
            <FileAvailabilityNotice />
            <Link className="inline-flex min-h-11 items-center text-sm text-primary underline" to="/arsip">Kembali ke daftar arsip</Link>
        </section>
    }
    return children
}
