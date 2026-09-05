import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KlasifikasiPicker } from './KlasifikasiPicker'

vi.mock('@/lib/cloud-provider-config', () => ({ USE_FIREBASE_AUTH: true }))
vi.mock('@/lib/firebase-client', () => ({
    getFirebaseAppCheckToken: vi.fn().mockResolvedValue('test-app-check'),
    getFirebaseLimitedUseAppCheckToken: vi.fn(),
}))

function classification(index) {
    const suffix = String(index).padStart(4, '0')
    return {
        id: `distractor-${index}`,
        kode: `XX.${suffix}`,
        sourceCode: `XX.${suffix}`,
        jenis: `Administrasi Struktural ${index}`,
        kategori: 'Umum',
        tipe: 'fasilitatif',
        isSelectable: true,
    }
}

describe('KlasifikasiPicker search rendering', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('renders results in bounded pages and narrows a classification code to its real match', async () => {
        const target = {
            id: 'target',
            kode: 'TU.02.01',
            sourceCode: 'TU.02.01',
            jenis: 'Pengelolaan Kearsipan',
            kategori: 'Ketatausahaan',
            tipe: 'fasilitatif',
            isSelectable: true,
        }
        const data = [target, ...Array.from({ length: 250 }, (_, index) => classification(index))]
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ success: true, data }),
        }))

        render(<KlasifikasiPicker value="" onChange={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: /Pilih Klasifikasi Arsip/i }))

        expect(await screen.findByText('Menampilkan 100 dari 251 hasil.')).toBeInTheDocument()

        fireEvent.change(screen.getByRole('textbox', { name: 'Cari klasifikasi arsip' }), {
            target: { value: 'TU.02.01' },
        })

        expect(await screen.findByText('Pengelolaan Kearsipan')).toBeInTheDocument()
        await waitFor(() => {
            expect(screen.queryByText('Administrasi Struktural 0')).not.toBeInTheDocument()
            expect(screen.queryByText(/Menampilkan 100 dari/)).not.toBeInTheDocument()
        })
    })

    it('authenticates classification, mapping, and JRA reads through Firebase App Check', async () => {
        const item = classification(1)
        const fetchMock = vi.fn().mockImplementation(async (url) => ({
            ok: true,
            status: 200,
            json: async () => url.includes('/mapping/')
                ? { success: true, suggestedJRA: [], mappings: [] }
                : { success: true, data: url.endsWith('/klasifikasi') ? [item] : [] },
        }))
        vi.stubGlobal('fetch', fetchMock)

        render(<KlasifikasiPicker value="" onChange={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: /Pilih Klasifikasi Arsip/i }))
        fireEvent.click(await screen.findByRole('button', { name: /Administrasi Struktural 1/ }))

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            '/api/klasifikasi',
            '/api/mapping/suggest-jra/XX.0001',
            '/api/jra',
        ])
        for (const [, options] of fetchMock.mock.calls) {
            expect(options).toMatchObject({
                credentials: 'include',
                headers: { 'X-Firebase-AppCheck': 'test-app-check' },
            })
        }
    })
})
