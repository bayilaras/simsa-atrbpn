import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ post: vi.fn(), upload: vi.fn(), provider: 'vercel-blob' }))
vi.mock('./api', () => ({ api: { post: state.post } }))
vi.mock('./blob-upload.service', () => ({ uploadFileToBlob: state.upload }))
vi.mock('../lib/cloud-provider-config', () => ({ get STORAGE_PROVIDER() { return state.provider } }))
import { uploadArsipAttachment } from './arsip-attachment-upload.service'

const id = '20000000-0000-4000-8000-000000000001'
const file = () => new File(['%PDF-1.7'], 'arsip.pdf', { type: 'application/pdf' })
beforeEach(() => {
    vi.clearAllMocks(); state.provider = 'vercel-blob'
    state.upload.mockResolvedValue({ url: `https://store.private.blob.vercel-storage.com/arsip-attachments/${id}/arsip-random.pdf` })
    state.post.mockResolvedValue({ data: { id: 'attachment', malwareScanStatus: 'not_scanned' } })
})
describe('archive attachment upload transport', () => {
    it('uploads exactly 10 MiB directly and sends only JSON metadata to the application', async () => {
        const pdf = new File([new Uint8Array(10 * 1024 * 1024)], 'arsip.pdf', { type: 'application/pdf' })
        const result = await uploadArsipAttachment(id, pdf)
        expect(state.upload).toHaveBeenCalledWith(pdf, { folder: `arsip-attachments/${id}` })
        expect(state.post).toHaveBeenCalledWith(`/api/upload/arsip/${id}`, { blobUrl: expect.stringContaining('/arsip-attachments/'), fileName: 'arsip.pdf' }, { timeoutMs: 60_000 })
        expect(result.data.malwareScanStatus).toBe('not_scanned')
    })
    it('retries only pending callback finalization with the same object and no duplicate upload', async () => {
        state.post.mockRejectedValueOnce(Object.assign(new Error('pending'), { status: 409, data: { code: 'UPLOAD_COMPLETION_PENDING' } }))
        const sleep = vi.fn().mockResolvedValue(undefined)
        await uploadArsipAttachment(id, file(), { sleep })
        expect(state.upload).toHaveBeenCalledOnce(); expect(state.post).toHaveBeenCalledTimes(2)
        expect(state.post.mock.calls[0]).toEqual(state.post.mock.calls[1]); expect(sleep).toHaveBeenCalledOnce()
    })
    it('bounds delayed callback retries and retains the server failure', async () => {
        const failure = Object.assign(new Error('pending'), { status: 409, data: { code: 'UPLOAD_COMPLETION_PENDING' } })
        state.post.mockRejectedValue(failure)
        await expect(uploadArsipAttachment(id, file(), { sleep: vi.fn().mockResolvedValue(undefined) })).rejects.toBe(failure)
        expect(state.post).toHaveBeenCalledTimes(5); expect(state.upload).toHaveBeenCalledOnce()
    })
    it('does not retry a revoked grant or another user\'s lease conflict', async () => {
        const failure = Object.assign(new Error('forbidden'), { status: 403 })
        state.post.mockRejectedValue(failure)
        await expect(uploadArsipAttachment(id, file())).rejects.toBe(failure)
        expect(state.post).toHaveBeenCalledOnce()
    })
    it('preserves GCS multipart and never starts a Vercel upload', async () => {
        state.provider = 'gcs'; const pdf = file(); await uploadArsipAttachment(id, pdf)
        expect(state.upload).not.toHaveBeenCalled()
        const body = state.post.mock.calls[0][1]; expect(body).toBeInstanceOf(FormData); expect(body.get('file')).toEqual(pdf)
        expect(state.post).toHaveBeenCalledWith(`/api/upload/arsip/${id}`, body)
    })
    it('does not repeat registration when a timeout leaves the mutation outcome unknown', async () => {
        const failure = Object.assign(new Error('Periksa catatan sebelum menyimpan kembali.'), { code: 'REQUEST_TIMEOUT', mutationOutcomeUnknown: true })
        state.post.mockRejectedValueOnce(failure)
        const sleep = vi.fn()
        await expect(uploadArsipAttachment(id, file(), { sleep })).rejects.toBe(failure)
        expect(state.post).toHaveBeenCalledOnce()
        expect(state.post).toHaveBeenCalledWith(`/api/upload/arsip/${id}`, {
            blobUrl: `https://store.private.blob.vercel-storage.com/arsip-attachments/${id}/arsip-random.pdf`, fileName: 'arsip.pdf',
        }, { timeoutMs: 60_000 })
        expect(state.upload).toHaveBeenCalledOnce()
        expect(sleep).not.toHaveBeenCalled()
    })
    it.each(['disabled', 'unknown'])('fails closed for %s storage', async provider => {
        state.provider = provider
        await expect(uploadArsipAttachment(id, file())).rejects.toThrow()
        expect(state.upload).not.toHaveBeenCalled(); expect(state.post).not.toHaveBeenCalled()
    })
    it('rejects oversize PDF before either network request', async () => {
        const pdf = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'arsip.pdf', { type: 'application/pdf' })
        await expect(uploadArsipAttachment(id, pdf)).rejects.toThrow(/10 MiB/)
        expect(state.upload).not.toHaveBeenCalled(); expect(state.post).not.toHaveBeenCalled()
    })
})
