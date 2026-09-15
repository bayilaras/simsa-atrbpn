import { api } from './api'
import { uploadFileToBlob } from './blob-upload.service'
import { STORAGE_PROVIDER } from '../lib/cloud-provider-config'
import { archiveUploadError } from '../lib/archive-upload'

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/** Existing-archive attachments use a target-bound lease; bytes bypass Vercel Functions. */
export async function uploadArsipAttachment(arsipId, file, { sleep = delay } = {}) {
    const invalid = archiveUploadError(file)
    if (invalid) throw new Error(invalid)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(arsipId || '')) {
        throw new Error('Pilih arsip induk yang valid sebelum mengunggah lampiran.')
    }
    const endpoint = `/api/upload/arsip/${arsipId}`
    if (STORAGE_PROVIDER === 'gcs') {
        const body = new FormData(); body.append('file', file)
        return api.post(endpoint, body)
    }
    if (STORAGE_PROVIDER !== 'vercel-blob') throw new Error('Penyimpanan lampiran belum tersedia.')
    const blob = await uploadFileToBlob(file, { folder: `arsip-attachments/${arsipId}` })
    const metadata = { blobUrl: blob.url, fileName: file.name }
    // Completion callbacks may arrive just after upload() returns. Retry only
    // this known state, always against the same object; no second upload/delete.
    for (let attempt = 0; ; attempt += 1) {
        // Allow the server's 30s file inspection plus its database transaction.
        try { return await api.post(endpoint, metadata, { timeoutMs: 60_000 }) }
        catch (failure) {
            if (failure?.status !== 409 || failure?.data?.code !== 'UPLOAD_COMPLETION_PENDING' || attempt >= 4) throw failure
            await sleep(250 * 2 ** attempt)
        }
    }
}
