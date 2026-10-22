import { useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import ImportRowReport from '@/components/ImportRowReport'
import ImportSyncOption from '@/components/ImportSyncOption'
import ImportUnitRequiredButton from '@/components/ImportUnitRequiredButton'
import { importResultSummary } from '@/lib/import-report'
import { useAppConfig } from '@/context/app-config-context'
import api from '@/services/api'
import { addImportPart, emptyImportTotals, IMPORT_PART_TIMEOUT_MS } from '@/lib/google-sheets-import'
import { runResumableImport, unfinishedImportNotice } from '@/lib/resumable-import'

/**
 * ImportFileDialog — imports surat masuk/keluar from an uploaded CSV or XLSX
 * file. The server maps columns exactly like the Google Sheets import and
 * imports long files in parts; every part re-sends the same file, which the
 * server reads in memory and never stores.
 */
const labels = { 'surat-masuk': 'Surat Masuk', 'surat-keluar': 'Surat Keluar' }
const MAX_FILE_BYTES = 4 * 1024 * 1024
const PREVIEW_ROWS = 10
const ACCEPT = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function formData(file, fields) {
    const form = new FormData()
    form.append('file', file)
    for (const [name, value] of Object.entries(fields)) if (value !== undefined && value !== '') form.append(name, String(value))
    return form
}

function ImportFileFlow({ type, unitKerjaId, onImportComplete, onBusyChange, onDone }) {
    const inputId = useId()
    const [file, setFile] = useState(null)
    // XLSX tabs once listed; null before that and for CSV.
    const [sheets, setSheets] = useState(null)
    const [sheet, setSheet] = useState('')
    const [preview, setPreview] = useState(null)
    const [step, setStep] = useState('file') // file, preview, importing, result
    const [busy, setBusyState] = useState(false)
    const [error, setError] = useState('')
    const [progress, setProgress] = useState(null)
    const [result, setResult] = useState(null)
    // When a rate-limited later part is sent again automatically.
    const [continueAt, setContinueAt] = useState(0)
    const [now, setNow] = useState(() => Date.now())
    const [stopping, setStopping] = useState(false)
    const stopRef = useRef(false)
    const [sinkron, setSinkron] = useState(false)
    const version = useRef(0)
    useEffect(() => () => { version.current++; onBusyChange(false) }, [onBusyChange])
    useEffect(() => {
        if (continueAt <= Date.now()) return
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
    }, [continueAt])

    const label = labels[type]
    const xlsx = Boolean(file && /\.xlsx$/i.test(file.name))
    const continueSeconds = Math.max(0, Math.ceil((continueAt - now) / 1000))
    const setBusy = value => { setBusyState(value); onBusyChange(value) }

    const chooseFile = event => {
        version.current++
        const chosen = event.target.files?.[0] || null
        setSheets(null); setSheet(''); setPreview(null); setResult(null); setError(''); setStep('file')
        if (chosen && !/\.(csv|xlsx)$/i.test(chosen.name)) {
            setFile(null)
            setError('Pilih berkas .csv atau .xlsx. Simpan berkas .xls atau .xlsm sebagai Excel Workbook (.xlsx) terlebih dahulu.')
        } else if (chosen && chosen.size > MAX_FILE_BYTES) {
            setFile(null)
            setError('Berkas melebihi batas 4 MiB. Pecah data menjadi beberapa berkas.')
        } else setFile(chosen)
    }
    const chooseSheet = name => { version.current++; setPreview(null); setError(''); setSheet(name) }

    const showPreview = async (isCurrent, chosenSheet) => {
        const data = await api.post('/api/import/berkas/preview', formData(file, { type, sheet: chosenSheet, maxRows: PREVIEW_ROWS }))
        if (!isCurrent()) return
        if (data?.importType !== type || !Array.isArray(data.mapping) || !data.mapping.length
            || !Number.isInteger(data.headerRow) || data.headerRow < 1) {
            throw new Error('Pemetaan kolom belum dapat diverifikasi. Periksa pratinjau kembali.')
        }
        setPreview(data)
        setStep('preview')
    }

    const handlePreview = async () => {
        if (!file || busy) return
        const current = ++version.current
        const isCurrent = () => current === version.current
        setBusy(true)
        setError('')
        try {
            if (xlsx && !sheets) {
                const data = await api.post('/api/import/berkas/lembar', formData(file, {}))
                if (!isCurrent()) return
                const listed = Array.isArray(data?.sheets) ? data.sheets : []
                const first = listed.find(item => !item.hidden) || listed[0]
                setSheets(listed)
                setSheet(first?.name || '')
                // A workbook with a single tab needs no choice.
                if (listed.length === 1) await showPreview(isCurrent, first.name)
                return
            }
            await showPreview(isCurrent, xlsx ? sheet : undefined)
        } catch (failure) {
            if (isCurrent()) setError(failure?.message || 'Berkas tidak dapat dibaca. Periksa berkas dan coba lagi.')
        } finally {
            if (isCurrent()) setBusy(false)
        }
    }

    const handleImport = async () => {
        if (!preview || busy) return
        const current = ++version.current
        const isCurrent = () => current === version.current
        stopRef.current = false
        setStopping(false)
        setBusy(true)
        setError('')
        setStep('importing')
        // Sent only when chosen, so a backend without sinkron still accepts the request.
        const source = { sheet: xlsx ? sheet : undefined, unitKerjaId, sinkron: sinkron ? 'true' : undefined }
        let totals = emptyImportTotals(preview.totalRows)
        setProgress(totals)
        try {
            const outcome = await runResumableImport({
                sendPart: position => api.post(`/api/import/berkas/${type}`, formData(file, { ...source, ...position }),
                    { timeoutMs: IMPORT_PART_TIMEOUT_MS }),
                onPart: part => { totals = addImportPart(totals, part); setProgress(totals) },
                onWait: until => { setNow(Date.now()); setContinueAt(until) },
                shouldStop: () => stopRef.current,
                isCurrent,
            })
            if (outcome.cancelled) return
            const notice = unfinishedImportNotice(outcome, totals)
            setResult(notice ? { ...totals, notice } : totals)
            setStep('result')
            if (totals.importedRows > 0 || totals.updatedRows > 0) onImportComplete?.()
        } catch (failure) {
            if (isCurrent()) {
                setError(failure?.message || 'Impor gagal. Periksa koneksi dan coba kembali.')
                setStep('preview')
            }
        } finally {
            if (isCurrent()) {
                setBusy(false)
                setContinueAt(0)
            }
        }
    }

    const summary = result ? importResultSummary(result) : null

    return <div className="min-w-0 space-y-4">
        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
            <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><p className="break-words">{error}</p>
        </div>}

        {/* Kept mounted so the chosen file stays shown after going back from the preview. */}
        <div hidden={step !== 'file'} className="space-y-4">
            <p className="text-sm text-muted-foreground">
                CSV (pemisah koma atau titik koma, sebaiknya &quot;CSV UTF-8&quot;) atau Excel Workbook (.xlsx) tanpa makro dan kata sandi.
                Maksimal 4 MiB, 1.000 baris data, dan 64 kolom per berkas.
            </p>
            <p className="break-words rounded-md bg-muted p-3 text-sm">
                Judul kolom pada lima baris pertama dikenali seperti impor Google Sheets, misalnya Hal → Perihal, Sifat Surat → Sifat surat,
                dan Get link → Tautan dokumen. Tanggal Excel dibaca sebagai tanggal; sel bertautan dibaca sebagai teksnya, kecuali pada kolom tautan dokumen yang memakai alamat tautannya.
            </p>
            <div className="space-y-2">
                <label htmlFor={inputId} className="text-sm font-medium">Berkas CSV atau XLSX</label>
                <input id={inputId} type="file" accept={ACCEPT} disabled={busy} onChange={chooseFile}
                    className="block w-full min-w-0 rounded-md border p-2 text-sm" />
            </div>
            {sheets?.length > 1 && <fieldset disabled={busy}>
                <legend className="mb-2 text-sm font-medium">Pilih lembar kerja</legend>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                    {sheets.map(item => <label key={item.name} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2 text-sm ${sheet === item.name ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
                        <input type="radio" name={`${inputId}-sheet`} value={item.name} checked={sheet === item.name} onChange={() => chooseSheet(item.name)} />
                        <span>{item.name}{item.hidden ? ' (tersembunyi)' : ''}</span>
                    </label>)}
                </div>
            </fieldset>}
            <div className="flex justify-end">
                <Button onClick={handlePreview} disabled={!file || busy || (sheets?.length > 1 && !sheet)}>
                    {busy ? 'Membaca berkas…' : 'Pratinjau'}
                </Button>
            </div>
        </div>

        {step === 'preview' && preview && <div className="space-y-4">
            <div className="space-y-1">
                <p className="text-sm font-medium">Tujuan: {label}</p>
                <p className="break-words text-xs text-muted-foreground">
                    Berkas: {file?.name}{preview.sheet ? ` · Lembar: ${preview.sheet}` : ''} · judul pada baris berisi ke-{preview.headerRow} (baris kosong tidak dihitung)
                </p>
            </div>
            <p className="text-sm text-muted-foreground">Setiap baris perlu tanggal surat yang valid (YYYY-MM-DD atau DD/MM/YYYY). Jika nomor surat kosong atau “-”, isi perihal serta pengirim atau tujuan (untuk surat keluar, tautan dokumen juga cukup) agar data dapat dikenali saat impor ulang.</p>
            <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                    <caption className="p-2 text-left font-medium">Pemetaan kolom ke data SIMSA</caption>
                    <thead><tr className="border-b bg-muted/50">
                        <th scope="col" className="px-3 py-2 text-left">Kolom berkas</th>
                        <th scope="col" className="px-3 py-2 text-left">Data SIMSA</th>
                    </tr></thead>
                    <tbody>{preview.mapping.map(item => <tr key={item.field} className="border-b last:border-0">
                        <td className="px-3 py-2">Kolom {item.columnIndex + 1}: {item.header}</td>
                        <td className="px-3 py-2">{item.label}</td>
                    </tr>)}</tbody>
                </table>
            </div>
            <p className="text-sm text-muted-foreground">Menampilkan <strong>{preview.rows.length}</strong> dari <strong>{preview.totalRows}</strong> baris</p>
            <div className="max-h-64 overflow-auto rounded-lg border">
                <table className="w-full text-xs">
                    <caption className="sr-only">Pratinjau data yang akan diimpor</caption>
                    <thead><tr className="border-b bg-muted/50">{preview.headers.map((header, index) =>
                        <th key={index} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">{header}</th>)}</tr></thead>
                    <tbody>{preview.rows.map((row, rowIndex) => <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-card' : 'bg-muted/50'}>
                        {row.map((cell, cellIndex) => <td key={cellIndex} className="max-w-[200px] truncate whitespace-nowrap px-3 py-2">{cell}</td>)}
                    </tr>)}</tbody>
                </table>
            </div>
            <ImportSyncOption type={type} checked={sinkron} onChange={setSinkron} disabled={busy} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => { version.current++; setPreview(null); setError(''); setStep('file') }} disabled={busy}>Kembali</Button>
                <Button onClick={handleImport} disabled={busy || preview.totalRows < 1}>
                    <Upload aria-hidden="true" className="mr-2 h-4 w-4" />Impor {preview.totalRows} baris
                </Button>
            </div>
        </div>}

        {step === 'importing' && progress && <div className="flex flex-col items-center py-6 text-center">
            <div role="status" aria-live="polite" className="flex w-full flex-col items-center">
                <p className="text-sm font-medium text-muted-foreground">Mengimpor data…</p>
                <div role="progressbar" aria-label="Kemajuan impor" aria-valuemin={0} aria-valuemax={progress.totalRows} aria-valuenow={progress.processedRows}
                    className="mt-4 h-2 w-full max-w-sm overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-[width]"
                        style={{ width: `${progress.totalRows ? Math.round(progress.processedRows / progress.totalRows * 100) : 0}%` }} />
                </div>
                <p className="mt-2 text-sm">{`${progress.processedRows} dari ${progress.totalRows} baris diproses`}</p>
                <p className="text-xs text-muted-foreground">{`Tersimpan ${progress.importedRows}${sinkron ? ` · diperbarui ${progress.updatedRows}` : ''} · duplikat ${progress.duplicateRows} · dilewati ${progress.skippedRows}`}</p>
                {continueSeconds > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    Batas permintaan impor tercapai; dilanjutkan otomatis dalam {continueSeconds} detik.
                </p>}
            </div>
            <p className="mt-3 max-w-sm text-xs text-muted-foreground">
                Biarkan jendela ini terbuka. Berkas yang panjang diimpor per bagian; baris yang sudah tersimpan tetap tercatat bila impor dihentikan.
            </p>
            <Button variant="outline" className="mt-4" onClick={() => { stopRef.current = true; setStopping(true) }} disabled={stopping}>
                {stopping ? 'Menghentikan setelah bagian ini…' : 'Hentikan setelah bagian ini'}
            </Button>
        </div>}

        {step === 'result' && result && <div className="space-y-4">
            {/* Only the summary is announced; the row table below is not a live region. */}
            <div role="status" aria-live="polite" className={`flex items-start gap-3 rounded-lg border p-4 ${summary.tone === 'warning' ? 'border-amber-200 bg-amber-50 dark:bg-amber-500/15'
                : summary.tone === 'success' ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-500/15' : 'border-red-200 bg-red-50 dark:bg-red-500/15'}`}>
                {summary.tone === 'success'
                    ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    : <AlertCircle aria-hidden="true" className={`mt-0.5 h-5 w-5 ${summary.tone === 'warning' ? 'text-amber-600' : 'text-red-600'}`} />}
                <div>
                    <p className="font-medium">{summary.title}</p>
                    {result.notice && <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">{result.notice}</p>}
                    <p className="mt-1 text-sm text-muted-foreground">{summary.duplicateOnly ? 'Seluruh baris sudah tercatat; tidak ada data baru yang ditambahkan.'
                        : `${result.importedRows} dari ${result.totalRows} baris berhasil diimpor`}</p>
                    {result.updatedRows > 0 && <p className="mt-1 text-sm text-blue-600">{`${result.updatedRows} baris diperbarui dari sumber`}</p>}
                    {summary.lockedRows > 0 && <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">{`${summary.lockedRows} baris tidak diperbarui; lihat rincian di bawah.`}</p>}
                    {result.skippedRows > 0 && <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">{result.skippedRows} baris dilewati (data tidak valid/kosong)</p>}
                    {summary.duplicateLines.map(line => <p key={line} className="mt-1 text-sm text-blue-600">{line}</p>)}
                </div>
            </div>
            {result.rows?.length > 0 ? <ImportRowReport rows={result.rows} type={type} /> : result.errors?.length > 0 && <div className="max-h-40 overflow-y-auto rounded-lg border bg-muted/50 p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Rincian kesalahan (nomor baris menghitung baris data):</p>
                {result.errors.map((message, index) => <p key={index} className="text-xs leading-relaxed text-red-600">{message}</p>)}
            </div>}
            <div className="flex justify-end"><Button variant="outline" onClick={onDone}>Tutup</Button></div>
        </div>}
    </div>
}

export default function ImportFileDialog({ type, unitKerjaId, onImportComplete }) {
    const { mode } = useAppConfig()
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    if (mode === 'metadata-demo' || !labels[type]) return null
    if (!unitKerjaId || unitKerjaId === 'all') return <ImportUnitRequiredButton className={`${buttonVariants({ variant: 'outline', size: 'sm' })} h-9`}>
        <FileSpreadsheet aria-hidden="true" className="mr-2 h-3.5 w-3.5" />Impor CSV/XLSX
    </ImportUnitRequiredButton>
    const keepOpen = event => { if (busy) event.preventDefault() }
    return <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value) }}>
        <Button variant="outline" size="sm" className="h-9" onClick={() => setOpen(true)}>
            <FileSpreadsheet aria-hidden="true" className="mr-2 h-3.5 w-3.5" />Impor CSV/XLSX
        </Button>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" showCloseButton={!busy} onEscapeKeyDown={keepOpen} onInteractOutside={keepOpen}>
            <DialogHeader>
                <DialogTitle>Impor {labels[type]} dari CSV/XLSX</DialogTitle>
                <DialogDescription>Kolom dikenali dengan aturan yang sama seperti impor Google Sheets, lalu disimpan pada unit kerja yang dipilih.</DialogDescription>
            </DialogHeader>
            <ImportFileFlow key={`${type}:${unitKerjaId}`} type={type} unitKerjaId={unitKerjaId}
                onImportComplete={onImportComplete} onBusyChange={setBusy} onDone={() => setOpen(false)} />
        </DialogContent>
    </Dialog>
}
