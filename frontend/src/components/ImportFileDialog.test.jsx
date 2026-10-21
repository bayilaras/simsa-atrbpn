import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImportFileDialog from './ImportFileDialog'

const mocks = vi.hoisted(() => ({ post: vi.fn(), mode: 'full' }))
vi.mock('@/services/api', () => ({ default: { post: mocks.post } }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ mode: mocks.mode }) }))

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const workbook = (name = 'register.xlsx') => new File(['PK'], name, { type: XLSX })
const csv = () => new File(['Nomor Surat;Hal'], 'register.csv', { type: 'text/csv' })
const headers = ['SURAT KELUAR 2026 No', 'Nomor Surat', 'Tanggal Surat', 'Tanggal TTE', 'Hal', 'Sifat Surat', 'Posisi', 'Get link', 'Get link']
const preview = (fields = {}) => ({
    format: 'xlsx', sheets: [], sheet: '2026', importType: 'surat-keluar', headerRow: 2, totalRows: 3, headers,
    rows: [['1', '87/SK-600/I/2026', '2026-01-05', '2026-01-05', 'Tim peneliti', 'Segera', 'Halaman Ke 3', '', 'https://drive.google.com/file/d/synthetic-a/view']],
    mapping: [
        { field: 'nomorSurat', label: 'Nomor surat', columnIndex: 1, header: 'Nomor Surat' },
        { field: 'perihal', label: 'Perihal', columnIndex: 4, header: 'Hal' },
        { field: 'linkDokumen', label: 'Tautan dokumen', columnIndex: 8, header: 'Get link' },
    ],
    ...fields,
})
const tabs = { format: 'xlsx', sheets: [{ name: 'Rekap lama', hidden: true }, { name: '2026', hidden: false }, { name: '2025', hidden: false }] }
const part = fields => ({ success: true, totalRows: 3, importedRows: 0, duplicateRows: 0, skippedRows: 0, errors: [], ...fields })
const fields = call => Object.fromEntries([...call[1].entries()].filter(([name]) => name !== 'file'))

async function open(type = 'surat-keluar', onImportComplete = vi.fn()) {
    render(<ImportFileDialog type={type} unitKerjaId="unit-a" onImportComplete={onImportComplete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Impor CSV/XLSX' }))
    return onImportComplete
}
const choose = async file => fireEvent.change(await screen.findByLabelText('Berkas CSV atau XLSX'), { target: { files: [file] } })
const click = name => fireEvent.click(screen.getByRole('button', { name }))

describe('CSV/XLSX import dialog', () => {
    beforeEach(() => { mocks.post.mockReset(); mocks.mode = 'full' })
    afterEach(cleanup)

    it('lists the workbook tabs, previews the chosen one and imports it with the same file', async () => {
        const onImportComplete = await open()
        const file = workbook()
        await choose(file)
        mocks.post.mockResolvedValueOnce(tabs).mockResolvedValueOnce(preview({ sheet: '2025' }))
        click('Pratinjau')
        // The first visible tab is chosen; hidden tabs are marked.
        expect(await screen.findByRole('radio', { name: '2026' })).toBeChecked()
        expect(screen.getByRole('radio', { name: 'Rekap lama (tersembunyi)' })).not.toBeChecked()
        fireEvent.click(screen.getByRole('radio', { name: '2025' }))
        click('Pratinjau')
        expect(await screen.findByRole('table', { name: 'Pemetaan kolom ke data SIMSA' })).toHaveTextContent('Kolom 9: Get link')
        expect(screen.getByText('Tautan dokumen')).toBeInTheDocument()
        expect(screen.getByText('Tim peneliti')).toBeInTheDocument()
        const [listCall, previewCall] = mocks.post.mock.calls
        expect(listCall[0]).toBe('/api/import/berkas/lembar')
        expect(fields(listCall)).toEqual({})
        expect(previewCall[0]).toBe('/api/import/berkas/preview')
        expect(fields(previewCall)).toEqual({ type: 'surat-keluar', sheet: '2025', maxRows: '10' })
        expect(previewCall[1].get('file')).toBe(file)

        mocks.post.mockResolvedValueOnce(part({ importedRows: 3, nextRow: null, startRow: 0 }))
        click('Impor 3 baris')
        expect(await screen.findByText('Impor berhasil!')).toBeInTheDocument()
        expect(screen.getByText('3 dari 3 baris berhasil diimpor')).toBeInTheDocument()
        const importCall = mocks.post.mock.calls[2]
        expect(importCall[0]).toBe('/api/import/berkas/surat-keluar')
        expect(fields(importCall)).toEqual({ sheet: '2025', unitKerjaId: 'unit-a', startRow: '0' })
        expect(importCall[1].get('file')).toBe(file)
        expect(importCall[2]).toEqual({ timeoutMs: 120_000 })
        expect(onImportComplete).toHaveBeenCalledOnce()
    })

    it('shows the outcome of every row across parts', async () => {
        await open()
        await choose(csv())
        mocks.post.mockResolvedValueOnce(preview({ format: 'csv', sheet: undefined }))
        click('Pratinjau')
        await screen.findByRole('table', { name: 'Pemetaan kolom ke data SIMSA' })
        const row = (n, status, reason) => ({ row: n, no: String(n), nomorSurat: `${n}/SK/2026`, tanggal: '2026-01-05', perihal: `Hal ${n}`, status, reason })
        mocks.post.mockResolvedValueOnce(part({ importedRows: 1, duplicateRows: 1, startRow: 0, nextRow: 2, prefixHash: 'a'.repeat(64),
            rows: [row(1, 'imported'), row(2, 'duplicate', 'Nomor surat dan tahun sama dengan baris data ke-1 pada sumber ini.')] }))
            .mockResolvedValueOnce(part({ skippedRows: 1, startRow: 2, nextRow: null, errors: ['Row 3: x'],
                rows: [row(3, 'invalid', 'Tanggal surat yang valid wajib diisi untuk identitas impor yang stabil.')] }))
        click('Impor 3 baris')
        const report = await screen.findByRole('table', { name: 'Rincian hasil impor per baris' })
        expect(screen.getByLabelText('Tampilkan')).toHaveDisplayValue('Perlu dicek (2)')
        expect(report).toHaveTextContent('sama dengan baris data ke-1')
        expect(report).toHaveTextContent('Tanggal surat yang valid wajib diisi')
        // The row report replaces the 20-line error list.
        expect(screen.queryByText('Row 3: x')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Unduh laporan (CSV)' })).toBeInTheDocument()
    })

    it('sends sinkron only when chosen, and never offers the sifat of incoming letters', async () => {
        const onImportComplete = await open('surat-masuk')
        await choose(csv())
        mocks.post.mockResolvedValueOnce(preview({ format: 'csv', sheet: undefined, importType: 'surat-masuk' }))
        click('Pratinjau')
        const checkbox = await screen.findByRole('checkbox', { name: /Sinkronkan surat yang sudah tercatat/ })
        expect(checkbox).toHaveAccessibleDescription(/perihal, tanggal, dan jenis surat/)
        expect(checkbox).toHaveAccessibleDescription(/Sifat surat masuk tidak diubah/)
        fireEvent.click(checkbox)
        mocks.post.mockResolvedValueOnce(part({ updatedRows: 1, duplicateRows: 2, nextRow: null, startRow: 0 }))
        click('Impor 3 baris')
        expect(await screen.findByText('1 baris diperbarui dari sumber')).toBeInTheDocument()
        expect(fields(mocks.post.mock.calls[1])).toEqual({ unitKerjaId: 'unit-a', startRow: '0', sinkron: 'true' })
        expect(onImportComplete).toHaveBeenCalledOnce()
    })

    it('does not call a sinkron whose changes were all refused a success', async () => {
        await open()
        await choose(csv())
        mocks.post.mockResolvedValueOnce(preview({ format: 'csv', sheet: undefined }))
        click('Pratinjau')
        fireEvent.click(await screen.findByRole('checkbox', { name: /Sinkronkan surat yang sudah tercatat/ }))
        mocks.post.mockResolvedValueOnce(part({ duplicateRows: 3, nextRow: null, startRow: 0, rows: [
            { row: 1, status: 'duplicate', reason: 'Sudah tercatat; tidak ada perubahan.' },
            { row: 2, status: 'locked', reason: 'Tidak diperbarui: surat sedang atau telah disetujui.' },
            { row: 3, status: 'duplicate', reason: 'Sudah tercatat; tidak ada perubahan.' }] }))
        click('Impor 3 baris')
        expect(await screen.findByText('Perubahan belum diterapkan')).toBeInTheDocument()
        expect(screen.getByText('1 baris tidak diperbarui; lihat rincian di bawah.')).toBeInTheDocument()
        expect(screen.queryByText('Semua data sudah ada')).not.toBeInTheDocument()
        // The long table stays out of the announced summary.
        expect(screen.getByRole('table', { name: 'Rincian hasil impor per baris' }).closest('[aria-live]')).toBeNull()
        expect(screen.getByRole('status')).toHaveTextContent('Perubahan belum diterapkan')
    })

    it('previews a single-tab workbook without asking for a tab', async () => {
        await open()
        await choose(workbook())
        mocks.post.mockResolvedValueOnce({ format: 'xlsx', sheets: [{ name: 'Data', hidden: false }] }).mockResolvedValueOnce(preview({ sheet: 'Data' }))
        click('Pratinjau')
        expect(await screen.findByRole('table', { name: 'Pemetaan kolom ke data SIMSA' })).toBeInTheDocument()
        expect(fields(mocks.post.mock.calls[1])).toEqual({ type: 'surat-keluar', sheet: 'Data', maxRows: '10' })
        expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    })

    it('previews and imports a CSV file without a tab', async () => {
        await open('surat-masuk')
        await choose(csv())
        mocks.post.mockResolvedValueOnce(preview({ format: 'csv', sheet: null, importType: 'surat-masuk' }))
        click('Pratinjau')
        await screen.findByRole('table', { name: 'Pemetaan kolom ke data SIMSA' })
        expect(mocks.post.mock.calls[0][0]).toBe('/api/import/berkas/preview')
        expect(fields(mocks.post.mock.calls[0])).toEqual({ type: 'surat-masuk', maxRows: '10' })
        mocks.post.mockResolvedValueOnce(part({ importedRows: 1, duplicateRows: 2, nextRow: null }))
        click('Impor 3 baris')
        await screen.findByText('Impor berhasil!')
        expect(mocks.post.mock.calls[1][0]).toBe('/api/import/berkas/surat-masuk')
        expect(fields(mocks.post.mock.calls[1])).toEqual({ unitKerjaId: 'unit-a', startRow: '0' })
        expect(screen.getByText('2 baris duplikat dilewati (sudah ada di sistem)')).toBeInTheDocument()
    })

    async function previewed() {
        const onImportComplete = await open()
        await choose(csv())
        mocks.post.mockResolvedValueOnce(preview({ format: 'csv', sheet: null }))
        click('Pratinjau')
        await screen.findByRole('button', { name: 'Impor 3 baris' })
        return onImportComplete
    }

    it('sends the same file part by part and shows progress', async () => {
        await previewed()
        let finishFirst
        mocks.post.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
            .mockResolvedValueOnce(part({ importedRows: 1, startRow: 2, nextRow: null }))
        click('Impor 3 baris')
        expect(await screen.findByRole('progressbar', { name: 'Kemajuan impor' })).toHaveAttribute('aria-valuenow', '0')
        await act(async () => finishFirst(part({ importedRows: 2, startRow: 0, nextRow: 2, prefixHash: 'h1' })))
        expect(await screen.findByText('Impor berhasil!')).toBeInTheDocument()
        const [, first, second] = mocks.post.mock.calls
        expect(fields(second)).toEqual({ unitKerjaId: 'unit-a', startRow: '2', prefixHash: 'h1' })
        expect(second[1].get('file')).toBe(first[1].get('file'))
        expect(screen.getByText('3 dari 3 baris berhasil diimpor')).toBeInTheDocument()
    })

    it('keeps the saved rows and says how to continue when a later part cannot be confirmed', async () => {
        const onImportComplete = await previewed()
        mocks.post.mockResolvedValueOnce(part({ importedRows: 2, startRow: 0, nextRow: 2, prefixHash: 'h1' }))
            .mockRejectedValueOnce(Object.assign(new Error('Waktu tunggu permintaan habis.'), { code: 'REQUEST_TIMEOUT', mutationOutcomeUnknown: true }))
        click('Impor 3 baris')
        expect(await screen.findByText('Impor belum selesai')).toBeInTheDocument()
        expect(screen.getByText(/Bagian mulai baris data ke-3 belum terkonfirmasi/)).toHaveTextContent('2 baris dari bagian sebelumnya sudah tersimpan')
        expect(onImportComplete).toHaveBeenCalledOnce()
    })

    it('stops after the current part on request', async () => {
        await previewed()
        let finishFirst
        mocks.post.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
        click('Impor 3 baris')
        fireEvent.click(await screen.findByRole('button', { name: 'Hentikan setelah bagian ini' }))
        await act(async () => finishFirst(part({ importedRows: 2, startRow: 0, nextRow: 2, prefixHash: 'h1' })))
        expect(await screen.findByText(/Impor dihentikan sebelum baris data ke-3/)).toBeInTheDocument()
        expect(mocks.post).toHaveBeenCalledTimes(2)
    })

    it('shows a first-part failure on the preview so the import can be retried', async () => {
        await previewed()
        mocks.post.mockRejectedValueOnce(Object.assign(new Error('Terlalu banyak permintaan impor. Coba lagi setelah 40 detik.'), { status: 429 }))
        click('Impor 3 baris')
        expect(await screen.findByRole('alert')).toHaveTextContent('Coba lagi setelah 40 detik')
        expect(screen.getByRole('button', { name: 'Impor 3 baris' })).toBeEnabled()
    })

    it('keeps the tab choice when the chosen tab has no recognisable header', async () => {
        await open()
        await choose(workbook())
        mocks.post.mockResolvedValueOnce(tabs).mockRejectedValueOnce(new Error('Header sheet tidak dikenali.'))
        click('Pratinjau')
        await screen.findByRole('radio', { name: '2026' })
        click('Pratinjau')
        expect(await screen.findByRole('alert')).toHaveTextContent('Header sheet tidak dikenali.')
        expect(screen.getByRole('radio', { name: '2025' })).toBeEnabled()
    })

    it('rejects other file types and files over 4 MiB before sending them', async () => {
        await open()
        await choose(new File(['x'], 'register.xlsm'))
        expect(screen.getByRole('alert')).toHaveTextContent('.csv atau .xlsx')
        expect(screen.getByRole('button', { name: 'Pratinjau' })).toBeDisabled()
        await choose(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'register.csv', { type: 'text/csv' }))
        expect(screen.getByRole('alert')).toHaveTextContent('4 MiB')
        expect(mocks.post).not.toHaveBeenCalled()
    })

    it('forgets the tabs and preview of a previous file', async () => {
        await open()
        await choose(workbook())
        mocks.post.mockResolvedValueOnce(tabs)
        click('Pratinjau')
        await screen.findByRole('radio', { name: '2026' })
        await choose(csv())
        expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    })

    it('is not offered in mode metadata-demo', () => {
        mocks.mode = 'metadata-demo'
        render(<ImportFileDialog type="surat-masuk" unitKerjaId="unit-a" />)
        expect(screen.queryByRole('button', { name: 'Impor CSV/XLSX' })).not.toBeInTheDocument()
    })

    it.each(['all', '', undefined])('asks for a concrete unit before opening for unit %j', unit => {
        render(<ImportFileDialog type="surat-masuk" unitKerjaId={unit} />)
        const button = screen.getByRole('button', { name: 'Impor CSV/XLSX' })
        expect(button).toHaveAttribute('aria-disabled', 'true')
        expect(button).toHaveAccessibleDescription('Pilih unit kerja terlebih dahulu')
        fireEvent.click(button)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('is not offered for archives, which keep the CSV import', () => {
        render(<ImportFileDialog type="arsip" unitKerjaId="unit-a" />)
        expect(screen.queryByRole('button', { name: 'Impor CSV/XLSX' })).not.toBeInTheDocument()
    })
})
