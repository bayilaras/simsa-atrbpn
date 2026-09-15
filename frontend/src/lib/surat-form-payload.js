import { omitSuratArchivePreviews } from './surat-archive-selection'

export function buildSuratFormPayload(formData, unitKerjaId, fileUploadsEnabled) {
    return {
        ...omitSuratArchivePreviews(formData),
        unitKerjaId,
        // An unavailable document editor cannot clear an existing server value.
        linkDokumen: fileUploadsEnabled ? formData.linkDokumen : undefined,
    }
}
