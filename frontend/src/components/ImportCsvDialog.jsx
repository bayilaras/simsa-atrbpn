import { useEffect, useId, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppConfig } from '@/context/app-config-context'
import api from '@/services/api'

const labels = { 'surat-masuk': 'Surat Masuk', 'surat-keluar': 'Surat Keluar', arsip: 'Arsip' }
const statuses = { valid: 'Valid', imported: 'Diimpor', duplicate: 'Duplikat', invalid: 'Perlu koreksi' }

function CsvImportForm({ type, unitKerjaId, onImportComplete, onBusyChange }) {
    const inputId = useId()
    const [file, setFile] = useState(null)
    const [result, setResult] = useState(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const requestVersion = useRef(0)
    useEffect(() => () => { requestVersion.current++; onBusyChange(false) }, [onBusyChange])

    const chooseFile = event => {
        requestVersion.current++
        setFile(event.target.files?.[0] || null)
        setResult(null)
        setError('')
    }
    const canImport = result?.dryRun === true && result.success && result.valid > 0
    const run = async dryRun => {
        if (!file || !unitKerjaId || unitKerjaId === 'all' || (!dryRun && !canImport)) return
        if (!file.name.toLowerCase().endsWith('.csv') || file.size > 10 * 1024 * 1024) {
            setError('Pilih berkas CSV dengan ukuran maksimal 10 MiB.')
            return
        }
        const version = ++requestVersion.current
        setBusy(true)
        onBusyChange(true)
        setError('')
        setResult(null)
        const body = new FormData()
        body.append('file', file)
        body.append('unitKerjaId', unitKerjaId)
        body.append('dryRun', String(dryRun))
        try {
            const response = await api.post(`/api/migration/${type}`, body)
            if (version !== requestVersion.current) return
            setResult(response.data)
            if (!dryRun && response.data?.imported > 0) onImportComplete?.()
        } catch (failure) {
            if (version === requestVersion.current) setError(failure.message || 'Impor gagal. Periksa koneksi dan coba kembali.')
        } finally {
            if (version === requestVersion.current) {
                setBusy(false)
                onBusyChange(false)
            }
        }
    }

    return <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
            Tanggal wajib diisi sebagai YYYY-MM-DD atau DD/MM/YYYY. Koreksi tanggal yang ditolak pada CSV sumber; aplikasi tidak menggantinya dengan tanggal hari ini.
        </p>
        <p className="text-sm text-muted-foreground">Maksimal 1.000 rekod dan 10 MiB per berkas. Gunakan satu header unik untuk setiap kolom; pecah berkas besar sebelum diimpor.</p>
        <p className="break-words rounded-md bg-muted p-3 text-sm">
            Kolom utama: {type === 'arsip' ? 'Nomor Berkas, Tanggal, Uraian, Jenis Arsip (masuk/keluar)' : 'Nomor Surat, Tanggal Surat, Perihal, Dari, Kepada'}.
        </p>
        <div className="space-y-2">
            <label htmlFor={inputId} className="text-sm font-medium">Berkas CSV</label>
            <input id={inputId} type="file" accept=".csv,text/csv" disabled={busy} onChange={chooseFile}
                className="block w-full rounded-md border p-2 text-sm" />
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
        <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => run(true)} disabled={!file || busy}>Pratinjau</Button>
            <Button onClick={() => run(false)} disabled={!canImport || busy}>Impor data valid</Button>
        </div>
        {busy && <p role="status" className="text-sm">Memproses CSV…</p>}
    </div>
}

export default function ImportCsvDialog({ type, unitKerjaId, onImportComplete }) {
    const { mode } = useAppConfig()
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    if (mode === 'metadata-demo' || !labels[type] || !unitKerjaId || unitKerjaId === 'all') return null
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
