import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StorageLocations from './StorageLocations'

const mocks = vi.hoisted(() => ({ getTree: vi.fn(), generateQR: vi.fn(), toast: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin_unit', unitKerjaId: 'ditjen' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/storage-location.service', () => ({ default: mocks }))
const location = { id: 'location-a', code: 'G1', name: 'Gedung sintetis', level: 'gedung', children: [] }
const qrDataUrl = 'data:image/png;base64,c3ludGhldGlj'
beforeEach(() => {
    vi.clearAllMocks()
    mocks.getTree.mockResolvedValue({ success: true, data: [location] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function openQR() { render(<StorageLocations />); await screen.findByText(location.name); fireEvent.click(screen.getByTitle('QR Code')) }

describe('storage QR generation', () => {
    it('finishes loading and displays/downloads the actual qrDataUrl returned by the API', async () => {
        let finish
        mocks.generateQR.mockReturnValue(new Promise(resolve => { finish = resolve }))
        await openQR()
        expect(screen.getByText('Membuat QR Code...')).toBeVisible()
        await act(async () => finish({ success: true, data: { qrDataUrl, location } }))
        const image = await screen.findByRole('img', { name: 'QR Code' })
        expect(image).toHaveAttribute('src', qrDataUrl)
        expect(screen.queryByText('Membuat QR Code...')).not.toBeInTheDocument()
        let download
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { download = { href: this.href, file: this.download } })
        fireEvent.click(screen.getByRole('button', { name: 'Download QR Code' }))
        expect(download).toEqual({ href: qrDataUrl, file: 'qr-G1.png' })
        expect(mocks.generateQR).toHaveBeenCalledWith('location-a', 'ditjen')
    })

    it('ends loading on API failure and lets the user retry the same location', async () => {
        mocks.generateQR.mockRejectedValueOnce(new Error('Layanan QR sementara tidak tersedia'))
            .mockResolvedValue({ success: true, data: { qrDataUrl, location } })
        await openQR()
        expect(await screen.findByRole('alert')).toHaveTextContent('Layanan QR sementara tidak tersedia')
        expect(screen.queryByText('Membuat QR Code...')).not.toBeInTheDocument()
        expect(screen.queryByRole('img', { name: 'QR Code' })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        expect(await screen.findByRole('img', { name: 'QR Code' })).toHaveAttribute('src', qrDataUrl)
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(mocks.generateQR).toHaveBeenCalledTimes(2)
    })

    it('reports an incomplete success response instead of spinning indefinitely', async () => {
        mocks.generateQR.mockResolvedValue({ success: true, data: {} })
        await openQR()
        expect(await screen.findByRole('alert')).toHaveTextContent('QR Code tidak tersedia')
        await waitFor(() => expect(screen.queryByText('Membuat QR Code...')).not.toBeInTheDocument())
    })

    it('cannot label a late QR response as a different location after reopening the dialog', async () => {
        const second = { ...location, id: 'location-b', code: 'G2', name: 'Gedung kedua' }
        const secondQr = 'data:image/png;base64,c2Vjb25k'
        let finishFirst
        mocks.getTree.mockResolvedValue({ success: true, data: [location, second] })
        mocks.generateQR.mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve }))
            .mockResolvedValue({ success: true, data: { qrDataUrl: secondQr, location: second } })
        render(<StorageLocations />)
        await screen.findByText(location.name)
        fireEvent.click(screen.getAllByTitle('QR Code')[0])
        fireEvent.click(screen.getByRole('button', { name: 'Tutup' }))
        fireEvent.click(screen.getAllByTitle('QR Code')[1])
        expect(await screen.findByRole('img', { name: 'QR Code' })).toHaveAttribute('src', secondQr)
        await act(async () => finishFirst({ success: true, data: { qrDataUrl, location } }))
        expect(screen.getByRole('dialog')).toHaveTextContent('QR Code - G2')
        expect(screen.getByRole('img', { name: 'QR Code' })).toHaveAttribute('src', secondQr)
    })
})
