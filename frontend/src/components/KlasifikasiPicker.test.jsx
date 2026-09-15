import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { KlasifikasiPicker } from './KlasifikasiPicker'

const auth = vi.hoisted(() => ({ user: { role: 'staff' } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }))

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
    beforeEach(() => {
        auth.user = { role: 'staff' }
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
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

const unavailableMessage = 'Katalog klasifikasi dan jadwal retensi arsip belum tersedia. Hubungi administrator untuk mengaktifkan katalog.'
function response(body, status = 200) {
    return { ok: status < 400, status, headers: new Headers(), json: async () => body }
}
function unavailableResponse() {
    return response({ success: false, code: 'CATALOG_NOT_READY', error: unavailableMessage }, 503)
}
function retention(overrides = {}) {
    return { id: 'jra-active', kode: 'TU.01', uraian: 'Retensi administrasi', retensiAktif: '2 tahun', retensiInaktif: '3 tahun', keterangan: 'Musnah', isSelectable: true, ...overrides }
}

const savedClassification = { id: 82, kode: 'BP.02.02', jenis: 'Bimbingan Teknis dan Supervisi', tipe: 'substantif', organizationalScope: 'kementerian', isSelectable: true }
const savedRetention = retention({ id: 97, kode: 'S.III.01', uraian: 'Retensi bimbingan teknis', retensiAktif: 0 })
const changedClassification = { ...classification(2), id: 83 }
const changedRetention = retention({ id: 98, kode: 'F.VI.03', uraian: 'Retensi pilihan baru' })
function catalogueResponse(url) {
    if (url.endsWith('/klasifikasi')) return response({ success: true, data: [savedClassification, changedClassification] })
    if (url.endsWith('/jra')) return response({ success: true, data: [savedRetention, changedRetention] })
    return response({ success: true, suggestedJRA: [url.includes('BP.02.02') ? savedRetention : changedRetention], mappings: [] })
}
function SavedPicker({ onChange, disabled = false, onlyValue = false }) {
    const [selection, setSelection] = useState({ classification: savedClassification, retention: savedRetention })
    return <KlasifikasiPicker value={selection.classification?.kode || ''}
        selectedClassification={onlyValue ? undefined : selection.classification}
        selectedRetention={onlyValue ? undefined : selection.retention}
        disabled={disabled}
        onChange={(kode, item, jra) => { onChange(kode, item, jra); setSelection({ classification: item, retention: jra }) }} />
}

describe('KlasifikasiPicker saved selection contract', () => {
    beforeEach(() => {
        auth.user = { role: 'admin_unit' }
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async url => catalogueResponse(url)))
    })
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

    it('renders saved labels and zero retention immediately, updates props and clears explicitly', () => {
        const onChange = vi.fn()
        const view = render(<KlasifikasiPicker value={savedClassification.kode} selectedClassification={savedClassification} selectedRetention={savedRetention} onChange={onChange} />)
        const trigger = screen.getByRole('button', { name: /BP.02.02 Bimbingan Teknis dan Supervisi/ })
        expect(trigger).toHaveTextContent('JRA: S.III.01 — Aktif: 0')
        expect(screen.queryByText('Klasifikasi terpilih')).not.toBeInTheDocument()
        expect(fetch).not.toHaveBeenCalled()
        view.rerender(<KlasifikasiPicker value={changedClassification.kode} selectedClassification={changedClassification} selectedRetention={changedRetention} onChange={onChange} />)
        expect(screen.getByRole('button', { name: /Administrasi Struktural 2/ })).toHaveTextContent('F.VI.03')
        expect(screen.queryByText('Bimbingan Teknis dan Supervisi')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Hapus klasifikasi yang dipilih' }))
        expect(onChange).toHaveBeenCalledWith('', null, null)
        view.rerender(<KlasifikasiPicker value="" selectedClassification={null} selectedRetention={null} onChange={onChange} />)
        expect(screen.getByRole('button', { name: 'Pilih Klasifikasi Arsip' })).toBeInTheDocument()
        expect(screen.queryByText(/JRA:/)).not.toBeInTheDocument()
    })

    it('does not open or clear a disabled saved selection', () => {
        const onChange = vi.fn()
        render(<SavedPicker disabled onChange={onChange} />)
        const trigger = screen.getByRole('button', { name: /BP.02.02 Bimbingan Teknis/ })
        const clear = screen.getByRole('button', { name: 'Hapus klasifikasi yang dipilih' })
        expect(trigger).toBeDisabled()
        expect(clear).toBeDisabled()
        fireEvent.click(trigger)
        fireEvent.click(clear)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(fetch).not.toHaveBeenCalled()
        expect(onChange).not.toHaveBeenCalled()
    })

    it('keeps the saved JRA draft selected across suggestion and all-JRA tab loads', async () => {
        const onChange = vi.fn()
        render(<SavedPicker onChange={onChange} />)
        fireEvent.click(screen.getByRole('button', { name: /BP.02.02 Bimbingan Teknis/ }))
        expect(await screen.findByRole('button', { name: /Retensi bimbingan teknis/ })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: /Semua \(/ }))
        expect(await screen.findByRole('button', { name: /Retensi bimbingan teknis/ })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: /Disarankan \(/ }))
        expect(screen.getByRole('button', { name: /Retensi bimbingan teknis/ })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'Pilih', exact: true }))
        expect(onChange).toHaveBeenCalledWith(savedClassification.kode, savedClassification, savedRetention)
    })

    it('clears JRA on classification change and restores the confirmed draft after cancel and reopen', async () => {
        const onChange = vi.fn()
        render(<SavedPicker onChange={onChange} />)
        fireEvent.click(screen.getByRole('button', { name: /BP.02.02 Bimbingan Teknis/ }))
        fireEvent.click(await screen.findByRole('button', { name: /XX.0002.*Administrasi Struktural 2/ }))
        expect(await screen.findByRole('button', { name: /Retensi pilihan baru/ })).toHaveAttribute('aria-pressed', 'false')
        expect(screen.getByRole('button', { name: 'Pilih', exact: true })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: /Retensi pilihan baru/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
        expect(onChange).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: /BP.02.02 Bimbingan Teknis/ }))
        expect(await screen.findByRole('button', { name: /Retensi bimbingan teknis/ })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: /BP.02.02/, pressed: true })).toBeInTheDocument()
    })

    it.each([undefined, ''])('resolves a legacy code with missing ID=%s before selecting its first JRA', async missingId => {
        const onChange = vi.fn()
        render(<KlasifikasiPicker value={savedClassification.kode} selectedClassification={{ ...savedClassification, id: missingId }} selectedRetention={{ ...savedRetention, id: missingId }} onChange={onChange} />)
        fireEvent.click(screen.getByRole('button', { name: /BP.02.02 Bimbingan Teknis/ }))
        const retentionChoice = await screen.findByRole('button', { name: /Retensi bimbingan teknis/ })
        expect(screen.getByRole('button', { name: 'Pilih', exact: true })).toBeDisabled()
        fireEvent.click(retentionChoice)
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pilih', exact: true })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Pilih', exact: true }))
        expect(onChange).toHaveBeenCalledWith(savedClassification.kode, expect.objectContaining({ id: 82 }), expect.objectContaining({ id: 97 }))
    })

    it('keeps confirmed labels for existing consumers that pass only the selected code', async () => {
        const onChange = vi.fn()
        render(<SavedPicker onlyValue onChange={onChange} />)
        fireEvent.click(screen.getByRole('button', { name: /BP.02.02 Klasifikasi terpilih/ }))
        fireEvent.click(await screen.findByRole('button', { name: /Administrasi Struktural 2/ }))
        fireEvent.click(await screen.findByRole('button', { name: /Retensi pilihan baru/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Pilih', exact: true }))
        expect(screen.getByRole('button', { name: /XX.0002 Administrasi Struktural 2/ })).toHaveTextContent('JRA: F.VI.03')
        expect(onChange).toHaveBeenCalledWith(changedClassification.kode, changedClassification, changedRetention)
    })

    it('ignores an earlier catalogue response after cancel and reopening another saved record', async () => {
        let resolveOld
        let reads = 0
        vi.mocked(fetch).mockImplementation(url => {
            if (url.endsWith('/klasifikasi')) {
                reads += 1
                if (reads === 1) return new Promise(resolve => { resolveOld = resolve })
                return Promise.resolve(response({ success: true, data: [changedClassification] }))
            }
            return Promise.resolve(catalogueResponse(url))
        })
        const onChange = vi.fn()
        const view = render(<KlasifikasiPicker value={savedClassification.kode} selectedClassification={savedClassification} selectedRetention={savedRetention} onChange={onChange} />)
        fireEvent.click(screen.getByRole('button', { name: /BP.02.02 Bimbingan Teknis/ }))
        await waitFor(() => expect(resolveOld).toBeTypeOf('function'))
        fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
        view.rerender(<KlasifikasiPicker value={changedClassification.kode} selectedClassification={changedClassification} selectedRetention={changedRetention} onChange={onChange} />)
        fireEvent.click(screen.getByRole('button', { name: /XX.0002 Administrasi Struktural 2/ }))
        expect(await screen.findByRole('button', { name: /Administrasi Struktural 2/, pressed: true })).toBeInTheDocument()
        await act(async () => resolveOld(response({ success: true, data: [savedClassification] })))
        expect(screen.queryByRole('button', { name: /Bimbingan Teknis dan Supervisi/ })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Administrasi Struktural 2/, pressed: true })).toBeInTheDocument()
        expect(onChange).not.toHaveBeenCalled()
    })

    it('ignores suggestions from the previous classification after selecting another pair', async () => {
        let resolveOld
        let oldRequested = false
        vi.mocked(fetch).mockImplementation(url => {
            if (url.includes('/mapping/') && url.includes('BP.02.02')) {
                oldRequested = true
                return new Promise(resolve => { resolveOld = resolve })
            }
            return Promise.resolve(catalogueResponse(url))
        })
        const onChange = vi.fn()
        render(<SavedPicker onChange={onChange} />)
        fireEvent.click(screen.getByRole('button', { name: /BP.02.02 Bimbingan Teknis/ }))
        await waitFor(() => expect(oldRequested).toBe(true))
        fireEvent.click(await screen.findByRole('button', { name: /Administrasi Struktural 2/ }))
        fireEvent.click(await screen.findByRole('button', { name: /Retensi pilihan baru/ }))
        await act(async () => resolveOld(response({ success: true, suggestedJRA: [savedRetention], mappings: [] })))
        expect(screen.queryByRole('button', { name: /Retensi bimbingan teknis/ })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Retensi pilihan baru/ })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'Pilih', exact: true }))
        expect(onChange).toHaveBeenCalledWith(changedClassification.kode, changedClassification, changedRetention)
    })

    it('ignores an old all-JRA failure after switching classification and preserving its new draft', async () => {
        let resolveAll
        vi.mocked(fetch).mockImplementation(url => url.endsWith('/jra')
            ? new Promise(resolve => { resolveAll = resolve })
            : Promise.resolve(catalogueResponse(url)))
        const onChange = vi.fn()
        render(<SavedPicker onChange={onChange} />)
        fireEvent.click(screen.getByRole('button', { name: /BP.02.02 Bimbingan Teknis/ }))
        await screen.findByRole('button', { name: /Retensi bimbingan teknis/ })
        fireEvent.click(screen.getByRole('button', { name: /Semua \(/ }))
        await waitFor(() => expect(resolveAll).toBeTypeOf('function'))
        fireEvent.click(screen.getByRole('button', { name: /Administrasi Struktural 2/ }))
        fireEvent.click(await screen.findByRole('button', { name: /Retensi pilihan baru/ }))
        await act(async () => resolveAll(unavailableResponse()))
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Retensi pilihan baru/ })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'Pilih', exact: true }))
        expect(onChange).toHaveBeenCalledWith(changedClassification.kode, changedClassification, changedRetention)
    })
})

describe('KlasifikasiPicker catalogue availability', () => {
    beforeEach(() => {
        auth.user = { role: 'staff' }
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('explains an unavailable catalogue to staff without an administrator action', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unavailableResponse()))
        render(<KlasifikasiPicker value="" onChange={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: 'Pilih Klasifikasi Arsip' }))

        expect(await screen.findByRole('alert')).toHaveTextContent(unavailableMessage)
        expect(screen.queryByText('Gagal terhubung ke server')).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: /Kelola katalog/ })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Pilih', exact: true })).toBeDisabled()
    })

    it('opens catalogue governance in another tab for an administrator and recovers on retry', async () => {
        auth.user = { role: 'super_admin' }
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(unavailableResponse())
            .mockResolvedValueOnce(response({ success: true, data: [classification(1)] }))
        vi.stubGlobal('fetch', fetchMock)
        render(<KlasifikasiPicker value="" onChange={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: 'Pilih Klasifikasi Arsip' }))

        const governance = await screen.findByRole('link', { name: 'Kelola katalog (tab baru)' })
        expect(governance).toHaveAttribute('href', '/master/regulatory-rules')
        expect(governance).toHaveAttribute('target', '_blank')
        expect(governance).toHaveAttribute('rel', 'noopener noreferrer')
        fireEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }))

        expect(await screen.findByRole('button', { name: /Administrasi Struktural 1/ })).toBeEnabled()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('preserves network failure feedback and a working retry', async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(response({ success: true, data: [classification(1)] }))
        vi.stubGlobal('fetch', fetchMock)
        render(<KlasifikasiPicker value="" onChange={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: 'Pilih Klasifikasi Arsip' }))

        expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent('Gagal terhubung ke server')
        fireEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }))
        expect(await screen.findByRole('button', { name: /Administrasi Struktural 1/ })).toBeEnabled()
    })

    it('does not label an unexpected server failure as catalogue absence or a network outage', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'Internal server error' }, 500)))
        render(<KlasifikasiPicker value="" onChange={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: 'Pilih Klasifikasi Arsip' }))

        expect(await screen.findByRole('alert')).toHaveTextContent('Data klasifikasi belum dapat dimuat. Silakan coba lagi.')
        expect(screen.queryByText(unavailableMessage)).not.toBeInTheDocument()
        expect(screen.queryByText('Gagal terhubung ke server')).not.toBeInTheDocument()
    })

    it('shows failed JRA suggestions and retries before allowing a confirmed active pair', async () => {
        let mappingReads = 0
        const jra = retention()
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
            if (url === '/api/klasifikasi') return response({ success: true, data: [classification(1)] })
            mappingReads += 1
            return mappingReads === 1 ? unavailableResponse() : response({ success: true, suggestedJRA: [jra], mappings: [] })
        }))
        const onChange = vi.fn()
        render(<KlasifikasiPicker value="" onChange={onChange} />)
        fireEvent.click(screen.getByRole('button', { name: 'Pilih Klasifikasi Arsip' }))
        fireEvent.click(await screen.findByRole('button', { name: /Administrasi Struktural 1/ }))

        expect(await screen.findByRole('alert')).toHaveTextContent(unavailableMessage)
        expect(screen.getByRole('button', { name: 'Pilih', exact: true })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }))
        fireEvent.click(await screen.findByRole('button', { name: /Retensi administrasi/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Pilih', exact: true }))
        expect(onChange).toHaveBeenCalledWith('XX.0001', classification(1), jra)
    })

    it('shows all-JRA load failure, then keeps nonselectable rules visible but disabled', async () => {
        let jraReads = 0
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
            if (url === '/api/klasifikasi') return response({ success: true, data: [classification(1)] })
            if (url.includes('/mapping/')) return response({ success: true, suggestedJRA: [], mappings: [] })
            jraReads += 1
            return jraReads === 1 ? unavailableResponse() : response({ success: true, data: [retention({ isSelectable: false })] })
        }))
        const onChange = vi.fn()
        render(<KlasifikasiPicker value="" onChange={onChange} />)
        fireEvent.click(screen.getByRole('button', { name: 'Pilih Klasifikasi Arsip' }))
        fireEvent.click(await screen.findByRole('button', { name: /Administrasi Struktural 1/ }))

        expect(await screen.findByRole('alert')).toHaveTextContent(unavailableMessage)
        expect(screen.queryByText('Tidak ditemukan')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }))
        const parentRule = await screen.findByRole('button', { name: /Retensi administrasi/ })
        expect(parentRule).toBeVisible()
        expect(parentRule).toBeDisabled()
        fireEvent.click(parentRule)
        expect(parentRule).toHaveAttribute('aria-pressed', 'false')
        expect(screen.queryByText('Tidak ditemukan')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Pilih', exact: true })).toBeDisabled()
        expect(onChange).not.toHaveBeenCalled()
    })

    it('clears a previously selected pair when refreshing the catalogue fails', async () => {
        let classificationReads = 0
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
            if (url === '/api/klasifikasi') {
                classificationReads += 1
                return classificationReads === 1 ? response({ success: true, data: [classification(1)] }) : unavailableResponse()
            }
            return response({ success: true, suggestedJRA: [retention()], mappings: [] })
        }))
        const onChange = vi.fn()
        render(<KlasifikasiPicker value="" onChange={onChange} />)
        fireEvent.click(screen.getByRole('button', { name: 'Pilih Klasifikasi Arsip' }))
        fireEvent.click(await screen.findByRole('button', { name: /Administrasi Struktural 1/ }))
        fireEvent.click(await screen.findByRole('button', { name: /Retensi administrasi/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Pilih', exact: true }))
        expect(onChange).toHaveBeenCalledTimes(1)

        fireEvent.click(screen.getByRole('button', { name: 'Pilih Klasifikasi Arsip' }))
        expect(await screen.findByRole('alert')).toHaveTextContent(unavailableMessage)
        expect(screen.getByRole('button', { name: 'Pilih', exact: true })).toBeDisabled()
        expect(onChange).toHaveBeenCalledTimes(1)
    })
})
