import { useCallback, useEffect, useRef, useState } from 'react'
import { arsipTerjagaService } from '@/services/arsip-terjaga.service'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useAppConfig } from '@/context/app-config-context'
import { FileAvailabilityNotice } from '@/components/FileAvailabilityNotice'
import { archiveUploadError } from '@/lib/archive-upload'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

const LABELS = { draft: 'Draf tercatat', sent: 'Bukti pengiriman tercatat', received: 'Bukti penerimaan tercatat', verified: 'Bukti diverifikasi internal', cancelled: 'Dibatalkan' }
const today = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

export default function ReportingDialog({ open, onOpenChange, item, onSaved }) {
    const { capabilities } = useAppConfig()
    const [ledger, setLedger] = useState(null)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [busy, setBusy] = useState(false)
    const [loading, setLoading] = useState(false)
    const [number, setNumber] = useState('')
    const [date, setDate] = useState(today)
    const [occurredOn, setOccurredOn] = useState(today)
    const [attachmentId, setAttachmentId] = useState('')
    const [notes, setNotes] = useState('')
    const generation = useRef(null)

    const load = useCallback(async () => {
        if (!item?.id) return
        const request = Symbol('report request')
        generation.current = request
        setLoading(true)
        try {
            const result = await arsipTerjagaService.getReports(item.id)
            if (request === generation.current) { setLedger(result.data); setError('') }
        } catch (failure) { if (request === generation.current) { setError(failure.message); setLedger(null) } }
        finally { if (request === generation.current) setLoading(false) }
    }, [item?.id])

    useEffect(() => {
        setLedger(null); setNumber(''); setNotes(''); setAttachmentId(''); setMessage('')
        if (open) load()
        return () => { generation.current = null }
    }, [open, load])

    const run = async (action, success) => {
        setBusy(true); setError(''); setMessage('')
        try {
            await action()
            setMessage(success); setAttachmentId(''); setNotes('')
            await load(); onSaved?.()
        } catch (failure) { setError(failure.message) }
        finally { setBusy(false) }
    }
    const current = ledger?.reports.find(report => ['draft', 'sent', 'received'].includes(report.status))
    const transition = (action) => run(() => arsipTerjagaService.transitionReport(item.id, current.id, {
        action, notes, ...(['send', 'receive'].includes(action) ? { attachmentId, occurredOn } : {}),
    }), 'Catatan dan bukti pelaporan tersimpan.')
    const download = async (evidence) => {
        try {
            const blob = await arsipTerjagaService.downloadEvidence(evidence.attachmentId)
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a'); link.href = url; link.download = evidence.fileName || 'bukti-pelaporan'
            document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
        } catch (failure) { setError(failure.message) }
    }

    return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
                <DialogTitle>Catatan pelaporan arsip terjaga</DialogTitle>
                <DialogDescription>Pencatatan dan pemeriksaan bukti internal. Pengiriman melalui kanal resmi dilakukan oleh petugas; catatan ini tidak menyatakan kepatuhan atau verifikasi oleh ANRI.</DialogDescription>
            </DialogHeader>
            <p className="font-medium">{item?.nomorBerkas || 'Arsip terjaga'} — {item?.uraianBerkas}</p>
            {error && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">{error}</div>}
            {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
            <Button variant="outline" disabled={busy || loading} onClick={load}>{loading ? 'Memuat…' : 'Muat ulang bukti'}</Button>
            {ledger && <>
                {ledger.legacyReporting && <p className="rounded border p-3 text-sm">Catatan lama dipertahankan untuk penelusuran. Nomor/tanggal dan status lama belum membuktikan pengiriman, penerimaan, atau kepatuhan. Catat ulang siklus dengan bukti terkendali.</p>}
                <div className="space-y-3">
                    {ledger.reports.map(report => <article key={report.id} className="rounded border p-4 space-y-2">
                        <div className="flex flex-wrap justify-between gap-2"><strong>{report.nomorLaporan}</strong><Badge variant="outline">{LABELS[report.status] || report.status}</Badge></div>
                        <p className="text-sm text-muted-foreground">Tanggal laporan: {report.tanggalPelaporan || '—'}</p>
                        {report.createdByName && <p className="text-sm text-muted-foreground">Dicatat oleh {report.createdByName}</p>}
                        {[[report.sentEvidence, 'Bukti pengiriman'], [report.receivedEvidence, 'Bukti penerimaan']].map(([proof, label]) => proof && <div key={label} className="space-y-1">
                            <Button variant="link" className="h-auto p-0" disabled={!capabilities.files} onClick={() => download(proof)}>{label}: {proof.fileName || 'Lampiran'}</Button>
                            <p className="text-xs break-all text-muted-foreground">SHA-256: {proof.sha256}</p>
                        </div>)}
                        {report.verificationNotes && <p className="text-sm">Hasil pemeriksaan{report.verifiedByName ? ` oleh ${report.verifiedByName}` : ''}: {report.verificationNotes}</p>}
                        {report.cancellationNotes && <p className="text-sm">Alasan pembatalan: {report.cancellationNotes}</p>}
                    </article>)}
                </div>
                {ledger.canManage && !current && <section className="rounded border p-4 space-y-3">
                    <h3 className="font-semibold">Catat draf laporan baru</h3>
                    <div className="space-y-1"><Label htmlFor="report-number">Nomor laporan</Label><Input id="report-number" value={number} onChange={event => setNumber(event.target.value)} maxLength={100} /></div>
                    <div className="space-y-1"><Label htmlFor="report-date">Tanggal laporan</Label><Input id="report-date" type="date" value={date} onChange={event => setDate(event.target.value)} /></div>
                    <Button disabled={busy || !number.trim() || !date} onClick={() => run(() => arsipTerjagaService.createReport(item.id, { nomorLaporan: number.trim(), tanggalPelaporan: date }), 'Draf tersimpan. Lengkapi bukti pengiriman dan penerimaan sebelum pemeriksaan.')}>Simpan draf laporan</Button>
                </section>}
                {ledger.canManage && current && <section className="rounded border p-4 space-y-3">
                    <h3 className="font-semibold">Lengkapi catatan: {current.nomorLaporan}</h3>
                    <FileAvailabilityNotice />
                    {['draft', 'sent'].includes(current.status) && <>
                        <div className="space-y-1"><Label htmlFor="report-file">Unggah lampiran bukti</Label>
                            <Input id="report-file" type="file" accept=".pdf,application/pdf" disabled={busy || !capabilities.fileUploads} onChange={event => {
                                const file = event.target.files?.[0]
                                event.target.value = ''
                                if (!file || busy || !capabilities.fileUploads) return
                                const invalid = archiveUploadError(file)
                                if (invalid) { setError(invalid); setMessage(''); return }
                                run(() => arsipTerjagaService.uploadEvidence(item.arsipId, file), 'Lampiran diunggah. Tunggu pemeriksaan antivirus lalu muat ulang bukti.')
                            }} />
                            <p className="text-sm text-muted-foreground">PDF, maksimal 10 MiB per berkas.</p>
                        </div>
                        <p className="text-sm text-muted-foreground">Hanya lampiran arsip ini yang privat, bersih dari malware, dan sudah diperiksa integritasnya yang dapat dipakai.</p>
                        <div className="space-y-1"><Label htmlFor="report-attachment">Lampiran bukti</Label>
                            <select id="report-attachment" value={attachmentId} onChange={event => setAttachmentId(event.target.value)} className="w-full rounded-md border bg-background p-2">
                                <option value="">Pilih dokumen bukti</option>
                                {ledger.attachments.map(file => <option key={file.id} value={file.id} disabled={!file.released}>{file.fileName || 'Lampiran tanpa nama'}{file.released ? '' : ' — belum lolos pemeriksaan'}</option>)}
                            </select>
                        </div>
                        <div className="space-y-1"><Label htmlFor="report-occurred">Tanggal {current.status === 'draft' ? 'pengiriman' : 'penerimaan'}</Label><Input id="report-occurred" type="date" max={today()} value={occurredOn} onChange={event => setOccurredOn(event.target.value)} /></div>
                    </>}
                    <div className="space-y-1"><Label htmlFor="report-notes">Catatan pemeriksaan atau tindakan</Label><Textarea id="report-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000} placeholder="Jelaskan bukti atau alasan tindakan, minimal 10 karakter." /></div>
                    <div className="flex flex-wrap gap-2">
                        {['draft', 'sent'].includes(current.status) && <Button disabled={busy || !capabilities.files || !attachmentId || !occurredOn || notes.trim().length < 10} onClick={() => transition(current.status === 'draft' ? 'send' : 'receive')}>{current.status === 'draft' ? 'Catat bukti pengiriman' : 'Catat bukti penerimaan'}</Button>}
                        {current.canVerify && <Button disabled={busy || !capabilities.files || notes.trim().length < 10} onClick={() => transition('verify')}>Verifikasi bukti internal</Button>}
                        <Button variant="outline" disabled={busy || notes.trim().length < 10} onClick={() => transition('cancel')}>Batalkan catatan</Button>
                    </div>
                    {current.status === 'received' && !current.canVerify && <p className="text-sm text-muted-foreground">Minta pemeriksa independen yang berwenang membuka bukti dan memverifikasi catatan ini.</p>}
                </section>}
            </>}
        </DialogContent>
    </Dialog>
}
