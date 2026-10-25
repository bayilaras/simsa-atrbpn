import { FlaskConical } from 'lucide-react'
import { useAppConfig } from '@/context/app-config-context'
import { FileAvailabilityNotice } from './FileAvailabilityNotice'

// Render within each page layout so fixed navigation cannot cover the message.
export function AppServiceNotice() {
    const { mode, loading, capabilities, configurationError } = useAppConfig()
    if (loading) return null
    if (configurationError) return <FileAvailabilityNotice />
    if (mode === 'metadata-demo') {
        return <aside role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 print:hidden">
            <FlaskConical className="mr-2 inline h-4 w-4" aria-hidden="true" />
            Demo — hanya gunakan data contoh. Unggah, impor, dan akses dokumen asli dinonaktifkan.
        </aside>
    }
    return mode === 'full' && capabilities?.fileUploads === false ? <FileAvailabilityNotice /> : null
}
