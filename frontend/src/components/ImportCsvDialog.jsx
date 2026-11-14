import { useEffect, useId, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import api from '@/services/api'
import { IMPORT_FILE_MAX_BYTES, IMPORT_FILE_TOO_LARGE, IMPORT_PART_TIMEOUT_MS } from '@/lib/google-sheets-import'
import { outcomeUnknown, runResumableImport } from '@/lib/resumable-import'

const labels = { 'surat-masuk': 'Surat Masuk', 'surat-keluar': 'Surat Keluar', arsip: 'Arsip' }
// Arsip tidak dapat dihapus dari aplikasi (DELETE /api/arsip/:id dinonaktifkan)
// dan impor tidak punya jalur pembatalan; surat hasil impor masih dapat dihapus.
const PESAN_IMPOR_ARSIP_PERMANEN =
    'Arsip yang diimpor tidak dapat dihapus dari aplikasi, dan impor tidak dapat dibatalkan. Periksa hasil pratinjau sebelum mengimpor.'
const PERNYATAAN_IMPOR_ARSIP = 'Saya sudah memeriksa pratinjau dan memahami bahwa impor ini permanen.'
const statuses = { valid: 'Valid', imported: 'Diimpor', duplicate: 'Duplikat', invalid: 'Perlu koreksi' }
const NOT_CSV = 'Pilih berkas CSV (.csv).'

/** Why a chosen file cannot be sent, checked before anything is uploaded. */
function fileProblem(file) {
    if (!file.name.toLowerCase().endsWith('.csv')) return NOT_CSV
    return file.size > IMPORT_FILE_MAX_BYTES ? IMPORT_FILE_TOO_LARGE : ''
}

/** Join the parts of a resumable CSV import into one result. */
function addCsvPart(total, part) {
    if (!total) return part
    return { ...part, success: total.success && part.success,
        valid: total.valid + part.valid, imported: total.imported + part.imported,
        duplicates: total.duplicates + part.duplicates, skipped: total.skipped + part.skipped,
        errors: [...total.errors, ...(part.errors || [])], rows: [...total.rows, ...(part.rows || [])] }
}

/** A later part failed; records of earlier parts are saved. Row numbers count the header as row 1, like the table. */
function interruptedCsvNotice({ interruptedAt, error }, saved) {
    const part = `Bagian mulai baris ${interruptedAt + 2}`
    const result = outcomeUnknown(error)
        ? `${part} belum terkonfirmasi; sebagian rekodnya mungkin sudah tersimpan.`
        : `${part} gagal: ${error?.message || 'permintaan tidak berhasil.'}`
    return `${result} ${saved} rekod dari bagian sebelumnya sudah tersimpan. Jalankan pratinjau lalu impor lagi; rekod yang sudah tersimpan akan dikenali sebagai duplikat.`
}

function CsvImportForm({ type, unitKerjaId, onImportComplete, onBusyChange }) {
    const inputId = useId()
    const pernyataanId = useId()
    const perluPernyataan = type === 'arsip'
    const [paham, setPaham] = useState(false)
    const [file, setFile] = useState(null)
    const [result, setResult] = useState(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    // Records processed so far by a resumable import, of the previewed total.
    const [progress, setProgress] = useState(null)
    const [waiting, setWaiting] = useState(false)
    const requestVersion = useRef(0)
    useEffect(() => () => { requestVersion.current++; onBusyChange(false) }, [onBusyChange])

    const chooseFile = event => {
        requestVersion.current++
        const chosen = event.target.files?.[0] || null
        const problem = chosen ? fileProblem(chosen) : ''
        setFile(problem ? null : chosen)
        setResult(null)
        setError(problem)
        setPaham(false)
    }
    const canImport = result?.dryRun === true && result.success && result.valid > 0
    const run = async dryRun => {
        if (!file || !unitKerjaId || unitKerjaId === 'all' || (!dryRun && (!canImport || (perluPernyataan && !paham)))) return
        const problem = fileProblem(file)
        if (problem) {
            setError(problem)
            return
        }
        const version = ++requestVersion.current
        const previewed = result?.rows?.length || 0
        setBusy(true)
        onBusyChange(true)
        setError('')
        setResult(null)
        setProgress(null)
        const body = (position = {}) => {
            const form = new FormData()
            form.append('file', file)
            form.append('unitKerjaId', unitKerjaId)
            form.append('dryRun', String(dryRun))
            for (const [name, value] of Object.entries(position)) if (value !== undefined) form.append(name, String(value))
            return form
        }
        const send = position => api.post(`/api/migration/${type}`, body(position), { timeoutMs: IMPORT_PART_TIMEOUT_MS })
        try {
            if (dryRun) {
                const response = await send()
                if (version === requestVersion.current) setResult(response.data)
                return
            }
            // A long file is imported in time-bounded parts; each part re-sends the same file.
            let imported = null
            const outcome = await runResumableImport({
                sendPart: async position => (await send(position)).data,
                onPart: part => {
                    imported = addCsvPart(imported, part)
                    setProgress({ processed: imported.rows.length, total: previewed })
                },
                onWait: until => setWaiting(until > 0),
                isCurrent: () => version === requestVersion.current,
            })
            if (outcome.cancelled) return
            setResult(imported)
            if (outcome.interruptedAt !== undefined) setError(interruptedCsvNotice(outcome, imported.imported))
            if (imported?.imported > 0) onImportComplete?.()
        } catch (failure) {
            if (version === requestVersion.current) setError(failure.message || 'Impor gagal. Periksa koneksi dan coba kembali.')
        } finally {
            if (version === requestVersion.current) {
                setBusy(false)
                setWaiting(false)
                onBusyChange(false)
            }
        }
    }

    return <div className="min-w-0 space-y-4">
        <p className="text-sm text-muted-foreground">
            Tanggal wajib diisi dengan urutan hari, bulan, tahun, misalnya 03/11/2026, 3-11-2026, atau 3 November 2026; penulisan 2026-11-03 juga diterima.
            Tanggal yang tidak dapat dibaca ditolak, tidak ditebak atau diganti dengan tanggal hari ini; koreksi pada CSV sumber.
        </p>
        <p className="text-sm text-muted-foreground">
            Pemisah kolom boleh koma, titik koma, atau tab dan dibaca dari baris judul. Sebaiknya simpan sebagai &quot;CSV UTF-8&quot;; CSV biasa dari Excel juga dapat dibaca.
            Maksimal 1.000 rekod dan 4 MiB per berkas. Gunakan satu header unik untuk setiap kolom; pecah berkas besar sebelum diimpor.
        </p>
        <p className="break-words rounded-md bg-muted p-3 text-sm">
            Kolom utama: {type === 'arsip' ? 'Nomor Berkas, Tanggal, Uraian, Jenis Arsip (masuk/keluar)' : 'Nomor Surat, Tanggal Surat, Perihal, Dari, Kepada'}.
        </p>
        <div className="space-y-2">
            <label htmlFor={inputId} className="text-sm font-medium">Berkas CSV</label>
            <input id={inputId} type="file" accept=".csv,text/csv" disabled={busy} onChange={chooseFile}
                className="block min-w-0 w-full rounded-md border p-2 text-sm" />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {result && <div className="space-y-3" aria-live="polite">
            <p className="text-sm font-medium">
                {result.dryRun ? 'Pratinjau' : 'Hasil impor'}: {result.valid} valid, {result.imported} diimpor, {result.duplicates} duplikat, {result.skipped} perlu koreksi.
            </p>
            {result.errors?.length > 0 && <p role="alert" className="text-sm text-destructive">{result.errors.join(' ')}</p>}
            <div className="max-h-64 overflow-auto rounded-md border">
                <table className="w-full text-left text-sm">
                    <caption className="sr-only">Hasil pemeriksaan setiap baris CSV; nomor menghitung header sebagai baris pertama</caption>
                    <thead className="bg-muted"><tr>{['Baris', 'Tanggal sumber', 'Tanggal hasil', 'Status', 'Catatan'].map(label => <th key={label} className="p-2" scope="col">{label}</th>)}</tr></thead>
                    <tbody>{result.rows?.map(row => <tr key={row.row} className="border-t">
                        <td className="p-2">{row.row}</td><td className="p-2 break-words">{row.sourceDate || '(kosong)'}</td>
                        <td className="p-2">{row.normalizedDate || '—'}</td><td className="p-2">{statuses[row.status] || row.status}</td>
                        <td className="p-2 break-words">{row.message || '—'}</td>
                    </tr>)}</tbody>
                </table>
            </div>
        </div>}
        <p className="text-sm text-muted-foreground">
            Pratinjau memeriksa tanggal dan duplikasi tanpa menyimpan. Impor memeriksa ulang hak akses, aturan, dan data terbaru; perubahan bersamaan dapat mengubah hasil. Baris yang berhasil tetap tersimpan bila baris lain gagal.
        </p>
        {perluPernyataan && <div role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <p><strong>Impor arsip bersifat permanen.</strong> {PESAN_IMPOR_ARSIP_PERMANEN}</p>
            <label htmlFor={pernyataanId} className="mt-2 flex items-start gap-2 font-medium">
                <input id={pernyataanId} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={paham} disabled={busy}
                    aria-required="true" onChange={event => setPaham(event.target.checked)} />
                <span>{PERNYATAAN_IMPOR_ARSIP}</span>
            </label>
        </div>}
        <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => run(true)} disabled={!file || busy}>Pratinjau</Button>
            <Button onClick={() => run(false)} disabled={!canImport || busy || (perluPernyataan && !paham)}>Impor data valid</Button>
        </div>
        {busy && <p role="status" className="text-sm">
            {progress?.total ? `Memproses CSV… ${progress.processed} dari ${progress.total} rekod diproses.` : 'Memproses CSV…'}
            {waiting && ' Batas permintaan impor tercapai; dilanjutkan otomatis.'}
        </p>}
    </div>
}

export default function ImportCsvDialog({ type, unitKerjaId, onImportComplete }) {
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    if (!labels[type] || !unitKerjaId || unitKerjaId === 'all') return null
    return <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value) }}>
        <Button variant="outline" size="sm" className="h-9" onClick={() => setOpen(true)}><Upload aria-hidden="true" className="mr-2 h-3.5 w-3.5" />Impor CSV</Button>
        <DialogContent className="sm:max-w-3xl" showCloseButton={!busy}>
            <DialogHeader><DialogTitle>Impor CSV {labels[type]}</DialogTitle>
                <DialogDescription>Periksa data sumber sebelum menyimpannya pada unit kerja yang dipilih.</DialogDescription>
            </DialogHeader>
            <CsvImportForm key={`${type}:${unitKerjaId}`} type={type} unitKerjaId={unitKerjaId} onImportComplete={onImportComplete} onBusyChange={setBusy} />
        </DialogContent>
    </Dialog>
}
