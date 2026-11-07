import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ExportButton from './ExportButton'

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

    it('describes both archive forms in the menu', () => {
        render(<ExportButton type="arsip" />)
        fireEvent.click(screen.getByRole('button', { name: 'Export' }))
        const formulir4 = screen.getByRole('group', { name: 'Formulir 4 — Arsip Aktif' })
        const formulir6 = screen.getByRole('group', { name: 'Formulir 6 — Arsip Inaktif' })
        expect(formulir4).toHaveTextContent('Arsip yang belum tercatat inaktif, termasuk yang JRA atau pemicu retensinya belum terverifikasi.')
        expect(formulir6).toHaveTextContent('Arsip yang masa aktifnya sudah berakhir menurut JRA terverifikasi, atau yang pemindahannya sudah dicatat di SIMSA.')
        expect(within(formulir6).getByRole('button', { name: 'PDF' })).toBeInTheDocument()
    })

    it('shows the server explanation when Formulir 6 has no inactive archives', async () => {
        const message = 'Belum ada arsip inaktif untuk filter ini. Arsip masuk Formulir 6 setelah masa aktifnya berakhir menurut JRA yang terverifikasi, atau setelah dipindahkan ke penyimpanan inaktif.'
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false, status: 422, headers: new Headers({ 'Content-Type': 'application/json' }),
            json: vi.fn().mockResolvedValue({ error: 'EXPORT_FORMULIR6_EMPTY', message }),
            blob: vi.fn(),
        })
        vi.stubGlobal('fetch', fetchMock)
        const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
        const view = render(<ExportButton type="arsip" filters={{ tahun: '2026' }} />)
        // Live region sudah terpasang sebelum pesan masuk agar pembaca layar mengumumkannya.
        expect(screen.getByRole('status')).toBeEmptyDOMElement()
        fireEvent.click(screen.getByRole('button', { name: 'Export' }))
        const formulir6 = screen.getByRole('group', { name: 'Formulir 6 — Arsip Inaktif' })
        fireEvent.click(within(formulir6).getByRole('button', { name: 'Excel (.xlsx)' }))

        expect(await screen.findByRole('status')).toHaveTextContent(message)
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(download).not.toHaveBeenCalled()
        expect(fetchMock.mock.calls[0][0]).toBe('/api/export/arsip/excel?tahun=2026&formulirType=formulir6')
        expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()

        // Keterangan menyangkut filter lama; hilang begitu filter diganti.
        view.rerender(<ExportButton type="arsip" filters={{ tahun: '2019' }} />)
        expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('shows the Indonesian rate-limit text instead of the raw server body', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false, status: 429, headers: new Headers({ 'Retry-After': '60' }),
            json: vi.fn().mockResolvedValue({
                error: 'Too Many Requests',
                message: 'Too many requests from this IP, please try again after 15 minutes',
            }),
        }))
        render(<ExportButton type="arsip" />)
        fireEvent.click(screen.getByRole('button', { name: 'Export' }))
        fireEvent.click(screen.getAllByRole('button', { name: 'PDF' })[0])
        expect(await screen.findByRole('alert')).toHaveTextContent('Terlalu banyak permintaan. Coba lagi setelah 60 detik.')
        expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('keeps the menu inside a narrow screen when the button sits on the left', () => {
        // Ponsel 375px: tombol Export berada di x=128..250, menu arsip selebar 288px.
        Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 375 })
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(288)
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
            left: 128, right: 250, top: 0, bottom: 36, width: 122, height: 36, x: 128, y: 0,
        })
        try {
            render(<ExportButton type="arsip" />)
            fireEvent.click(screen.getByRole('button', { name: 'Export' }))
            const menu = screen.getByRole('group', { name: 'Formulir 4 — Arsip Aktif' }).parentElement
            // Rata kanan akan mulai di x=-38; menu digeser ke x=16 (gutter halaman).
            expect(menu.style.left).toBe(`${16 - 128}px`)
            expect(menu.style.right).toBe('auto')
        } finally {
            delete document.documentElement.clientWidth
        }
    })

    it('keeps the menu right-aligned with the button when there is room', () => {
        Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1280 })
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(288)
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
            left: 878, right: 1000, top: 0, bottom: 36, width: 122, height: 36, x: 878, y: 0,
        })
        try {
            render(<ExportButton type="arsip" />)
            fireEvent.click(screen.getByRole('button', { name: 'Export' }))
            const menu = screen.getByRole('group', { name: 'Formulir 4 — Arsip Aktif' }).parentElement
            expect(menu.style.left).toBe(`${1000 - 288 - 878}px`)
        } finally {
            delete document.documentElement.clientWidth
        }
    })

    it('keeps filters and preserves the server-provided filename', async () => {
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
        })
        expect(createObjectURL).toHaveBeenCalledWith(blob)
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-export')
    })
})
