import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImportCsvDialog from './ImportCsvDialog'

const mocks = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/services/api', () => ({ default: { post: mocks.post } }))
const preview = { success: true, dryRun: true, valid: 1, imported: 0, skipped: 0, duplicates: 0, errors: [], rows: [
    { row: 2, status: 'valid', sourceDate: '29/02/2024', normalizedDate: '2024-02-29' },
] }
const source = () => new File(['Nomor Surat,Tanggal Surat\nSM-1,29/02/2024'], 'sumber.csv', { type: 'text/csv' })
async function openWithFile() {
    fireEvent.click(screen.getByRole('button', { name: 'Impor CSV' }))
    fireEvent.change(await screen.findByLabelText('Berkas CSV'), { target: { files: [source()] } })
}

describe('CSV preview before import', () => {
    beforeEach(() => mocks.post.mockReset())
    afterEach(cleanup)
    it('requires a successful preview and sends the same source and unit for actual import', async () => {
        mocks.post.mockResolvedValueOnce({ data: preview }).mockResolvedValueOnce({ data: { ...preview, dryRun: false, imported: 1, rows: [{ ...preview.rows[0], status: 'imported' }] } })
        const onImportComplete = vi.fn()
        render(<ImportCsvDialog type="surat-masuk" unitKerjaId="unit-a" onImportComplete={onImportComplete} />)
        await openWithFile()
        expect(screen.getByRole('button', { name: 'Impor data valid' })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'Pratinjau' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Impor data valid' })).toBeEnabled())
        expect(screen.getByText('29/02/2024')).toBeInTheDocument()
        expect(screen.getByText('2024-02-29')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Impor data valid' }))
        await waitFor(() => expect(onImportComplete).toHaveBeenCalledOnce())
        const [previewCall, importCall] = mocks.post.mock.calls
        expect(previewCall[0]).toBe('/api/migration/surat-masuk')
        expect(previewCall[1].get('dryRun')).toBe('true')
        expect(previewCall[1].get('startRow')).toBeNull()
        expect(importCall[1].get('dryRun')).toBe('false')
        expect(importCall[1].get('unitKerjaId')).toBe('unit-a')
        expect(importCall[1].get('file')).toBe(previewCall[1].get('file'))
        expect(importCall[1].get('startRow')).toBe('0')
        expect(importCall[2]).toEqual({ timeoutMs: 120_000 })
        expect(screen.getByRole('button', { name: 'Impor data valid' })).toBeDisabled()
    })

    describe('a long file imported in parts', () => {
        const row = (number, status) => ({ row: number, status, sourceDate: '2026-09-11', normalizedDate: '2026-09-11' })
        const fivePreview = { ...preview, valid: 5, rows: [2, 3, 4, 5, 6].map(number => row(number, 'valid')) }
        const part = fields => ({ data: { success: true, dryRun: false, valid: 0, imported: 0, skipped: 0, duplicates: 0, errors: [], rows: [], ...fields } })
        const previewed = async (onImportComplete = vi.fn()) => {
            mocks.post.mockResolvedValueOnce({ data: fivePreview })
            render(<ImportCsvDialog type="surat-keluar" unitKerjaId="unit-a" onImportComplete={onImportComplete} />)
            await openWithFile()
            fireEvent.click(screen.getByRole('button', { name: 'Pratinjau' }))
            await waitFor(() => expect(screen.getByRole('button', { name: 'Impor data valid' })).toBeEnabled())
            return onImportComplete
        }

        it('sends the same file part by part and shows every processed record', async () => {
            const onImportComplete = await previewed()
            let finishFirst
            mocks.post.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
                .mockResolvedValueOnce(part({ valid: 2, imported: 2, rows: [row(5, 'imported'), row(6, 'imported')], startRow: 3, nextRow: null }))
            fireEvent.click(screen.getByRole('button', { name: 'Impor data valid' }))
            await act(async () => finishFirst(part({ valid: 3, imported: 3, rows: [2, 3, 4].map(number => row(number, 'imported')), startRow: 0, nextRow: 3, prefixHash: 'h1' })))
            await waitFor(() => expect(onImportComplete).toHaveBeenCalledOnce())
            const [, first, second] = mocks.post.mock.calls
            expect([first[1].get('startRow'), first[1].get('prefixHash')]).toEqual(['0', null])
            expect([second[1].get('startRow'), second[1].get('prefixHash')]).toEqual(['3', 'h1'])
            expect(second[1].get('file')).toBe(first[1].get('file'))
            expect(screen.getByText('Hasil impor: 5 valid, 5 diimpor, 0 duplikat, 0 perlu koreksi.')).toBeInTheDocument()
            expect(screen.getAllByText('Diimpor')).toHaveLength(5)
        })

        it('keeps the saved records and says what to do when a later part cannot be confirmed', async () => {
            const onImportComplete = await previewed()
            mocks.post.mockResolvedValueOnce(part({ valid: 3, imported: 3, rows: [2, 3, 4].map(number => row(number, 'imported')), startRow: 0, nextRow: 3, prefixHash: 'h1' }))
                .mockRejectedValueOnce(Object.assign(new Error('Waktu tunggu permintaan habis.'), { code: 'REQUEST_TIMEOUT', mutationOutcomeUnknown: true }))
            fireEvent.click(screen.getByRole('button', { name: 'Impor data valid' }))
            const alert = await screen.findByText(/belum terkonfirmasi/)
            expect(alert).toHaveTextContent('Bagian mulai baris 5 belum terkonfirmasi')
            expect(alert).toHaveTextContent('3 rekod dari bagian sebelumnya sudah tersimpan')
            expect(alert).toHaveTextContent('Jalankan pratinjau lalu impor lagi')
            expect(screen.getByText('Hasil impor: 3 valid, 3 diimpor, 0 duplikat, 0 perlu koreksi.')).toBeInTheDocument()
            expect(onImportComplete).toHaveBeenCalledOnce()
        })
    })

    it.each(['file', 'type', 'unit'])('invalidates the preview after changing %s', async change => {
        mocks.post.mockResolvedValue({ data: preview })
        const view = render(<ImportCsvDialog type="surat-masuk" unitKerjaId="unit-a" />)
        await openWithFile()
        fireEvent.click(screen.getByRole('button', { name: 'Pratinjau' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Impor data valid' })).toBeEnabled())
        if (change === 'file') fireEvent.change(screen.getByLabelText('Berkas CSV'), { target: { files: [source()] } })
        else view.rerender(<ImportCsvDialog type={change === 'type' ? 'arsip' : 'surat-masuk'} unitKerjaId={change === 'unit' ? 'unit-b' : 'unit-a'} />)
        expect(screen.getByRole('button', { name: 'Impor data valid' })).toBeDisabled()
        expect(screen.queryByText('2024-02-29')).not.toBeInTheDocument()
    })

    it('ignores a late preview for a previous unit', async () => {
        let resolvePreview
        mocks.post.mockReturnValue(new Promise(resolve => { resolvePreview = resolve }))
        const view = render(<ImportCsvDialog type="surat-masuk" unitKerjaId="unit-a" />)
        await openWithFile()
        fireEvent.click(screen.getByRole('button', { name: 'Pratinjau' }))
        view.rerender(<ImportCsvDialog type="surat-masuk" unitKerjaId="unit-b" />)
        await act(async () => resolvePreview({ data: preview }))
        expect(screen.getByRole('button', { name: 'Impor data valid' })).toBeDisabled()
        expect(screen.queryByText('2024-02-29')).not.toBeInTheDocument()
    })

    it('shows rejected source dates and requires correction before importing', async () => {
        mocks.post.mockResolvedValue({ data: { ...preview, success: false, valid: 0, skipped: 1, errors: ['Tanggal tidak valid'], rows: [{ row: 2, status: 'invalid', sourceDate: '31/02/2026', message: 'Tanggal tidak valid' }] } })
        render(<ImportCsvDialog type="arsip" unitKerjaId="unit-a" />)
        await openWithFile()
        fireEvent.click(screen.getByRole('button', { name: 'Pratinjau' }))
        expect(await screen.findByText('31/02/2026')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Impor data valid' })).toBeDisabled()
    })
})
