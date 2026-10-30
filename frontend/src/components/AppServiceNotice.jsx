import { useAppConfig } from '@/context/app-config-context'
import { FileAvailabilityNotice } from './FileAvailabilityNotice'

// Render within each page layout so fixed navigation cannot cover the message.
export function AppServiceNotice() {
    const { loading, capabilities, configurationError } = useAppConfig()
    if (loading) return null
    if (configurationError) return <FileAvailabilityNotice />
    return capabilities?.fileUploads === false ? <FileAvailabilityNotice /> : null
}
