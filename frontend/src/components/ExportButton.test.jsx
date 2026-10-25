import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ExportButton from './ExportButton'

vi.mock('@/lib/cloud-provider-config', () => ({ USE_FIREBASE_AUTH: true }))
vi.mock('@/lib/firebase-client', () => ({
    getFirebaseAppCheckToken: vi.fn().mockResolvedValue('test-app-check'),
    getFirebaseLimitedUseAppCheckToken: vi.fn(),
}))

describe('ExportButton authenticated download', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('shows an actionable limit error and does not download a partial file', async () => {
        const message = 'Hasil filter berisi 10.001 rekod, melebihi batas ekspor 10.000. Persempit filter tahun, unit kerja, atau pencarian lalu ekspor kembali.'
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false, status: 422, headers: new Headers(),
            json: vi.fn().mockResolvedValue({ error: 'EXPORT_LIMIT_EXCEEDED', message, total: 10001, limit: 10000 }),
        }))
        vi.spyOn(window, 'alert').mockImplementation(() => {})
        const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
        render(<ExportButton type="surat-masuk" />)
        fireEvent.click(screen.getByRole('button', { name: 'Export' }))
        fireEvent.click(screen.getByRole('button', { name: 'Export Excel (.xlsx)' }))
        expect(await screen.findByRole('alert')).toHaveTextContent(message)
        expect(download).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
    })

    it('sends App Check, keeps filters, and preserves the server-provided filename', async () => {
        const blob = new Blob(['pdf'], { type: 'application/pdf' })
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers({ 'Content-Disposition': 'attachment; filename="daftar-arsip-2026.pdf"' }),
            blob: vi.fn().mockResolvedValue(blob),
        })
        vi.stubGlobal('fetch', fetchMock)
        const createObjectURL = vi.fn().mockReturnValue('blob:local-export')
        const revokeObjectURL = vi.fn()
        vi.stubGlobal('URL', class extends URL {
            static createObjectURL = createObjectURL
            static revokeObjectURL = revokeObjectURL
        })
        let download
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
            download = { href: this.href, filename: this.download }
        })

        render(<ExportButton type="arsip" filters={{ unitKerjaId: 'unit/a', search: 'berkas tanah', status: 'all', blank: '' }} />)
        fireEvent.click(screen.getByRole('button', { name: 'Export' }))
        fireEvent.click(screen.getAllByRole('button', { name: 'PDF' })[0])

        await waitFor(() => expect(download).toEqual({
            href: 'blob:local-export', filename: 'daftar-arsip-2026.pdf',
        }))
        const [url, options] = fetchMock.mock.calls[0]
        expect(url).toBe('/api/export/arsip/pdf?unitKerjaId=unit%2Fa&search=berkas+tanah&formulirType=formulir4')
        expect(options).toMatchObject({
            method: 'GET',
            credentials: 'include',
            headers: { 'X-Firebase-AppCheck': 'test-app-check' },
        })
        expect(createObjectURL).toHaveBeenCalledWith(blob)
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-export')
    })
})
