import { useEffect, useRef, useState } from 'react'
import { penyusutanService } from '@/services/penyusutan.service'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

const selectClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

export default function PenyusutanExecutionForm({ batch, unitKerjaId, onComplete }) {
    const mounted = useRef(true)
    const [options, setOptions] = useState({ attachments: [], witnesses: [] })
    const [revision, setRevision] = useState(0)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [file, setFile] = useState(null)
    const [uploadArchiveId, setUploadArchiveId] = useState(batch.items?.[0]?.arsipId || '')
    const [form, setForm] = useState({ beritaAcaraAttachmentId: '', decisionAttachmentId: '', executionProofAttachmentId: '',
        performedAt: '', method: '', copiesStatement: '', witnesses: [{ userId: '', authorityAttachmentId: '' }, { userId: '', authorityAttachmentId: '' }] })
    useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

    useEffect(() => {
        let active = true
        setLoading(true)
        penyusutanService.getExecutionOptions(batch.id, unitKerjaId).then(result => {
            if (active) { setOptions(result); setError('') }
        }).catch(err => { if (active) setError(err.message || 'Pilihan bukti gagal dimuat.') })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [batch.id, unitKerjaId, revision])

    const change = (field, value) => setForm(previous => ({ ...previous, [field]: value }))
    const changeWitness = (index, field, value) => setForm(previous => ({ ...previous,
        witnesses: previous.witnesses.map((witness, i) => i === index ? { ...witness, [field]: value } : witness) }))
    const attachmentOptions = options.attachments.map(item => <option key={item.id} value={item.id}>{item.fileName}</option>)
    const attachmentSelect = (label, value, onChange, id) => <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <select id={id} className={selectClass} required value={value} disabled={busy || loading} onChange={event => onChange(event.target.value)}>
            <option value="">Pilih lampiran terverifikasi</option>{attachmentOptions}
        </select>
    </div>

    const upload = async () => {
        if (!file || busy) return
        setBusy(true); setError(''); setNotice('')
        try {
            await penyusutanService.uploadExecutionEvidence(batch.id, unitKerjaId, uploadArchiveId, file)
            setNotice('Bukti diunggah ke karantina. Pilih Perbarui bukti setelah pemeriksaan malware dan integritas selesai.')
            setRevision(value => value + 1)
        } catch (err) { setError(err.message || 'Unggah bukti gagal.') }
        finally { setBusy(false) }
    }
    const submit = async event => {
        event.preventDefault()
        if (busy) return
        setBusy(true); setError('')
        try {
            await penyusutanService.updateStatus(batch.id, unitKerjaId, { executionEvidence: {
                ...form, performedAt: new Date(form.performedAt).toISOString(),
            } })
            if (mounted.current) onComplete()
        } catch (err) { setError(err.message || 'Bukti belum dapat dicatat.') }
        finally { setBusy(false) }
    }

    return <section aria-labelledby="execution-evidence-title" className="mt-6 space-y-4 rounded-lg border p-4">
        <div>
            <h4 id="execution-evidence-title" className="font-semibold">Catat pelaksanaan pemusnahan</h4>
            <p className="mt-1 text-sm text-muted-foreground">Catat setelah kegiatan dilaksanakan sesuai keputusan yang sah. Sistem memeriksa lampiran dan identitas pengguna; pejabat tetap menilai keabsahan kewenangan serta isi bukti. Pencatatan ini tidak menghapus objek atau backup secara otomatis.</p>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        <div className="space-y-3 rounded-md bg-muted/40 p-3">
            <Label htmlFor="evidence-archive">Arsip tempat bukti dilampirkan</Label>
            <select id="evidence-archive" className={selectClass} value={uploadArchiveId} disabled={busy} onChange={event => setUploadArchiveId(event.target.value)}>
                {(batch.items || []).map(item => <option key={item.arsipId} value={item.arsipId}>{item.arsip?.nomorBerkas || item.arsip?.uraianBerkas || `Arsip ${item.nomorUrut || ''}`}</option>)}
            </select>
            <Label htmlFor="execution-file">Unggah dokumen bukti (PDF, JPEG, PNG; maksimal 10 MB)</Label>
            <Input id="execution-file" type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy}
                onChange={event => setFile(event.target.files?.[0] || null)} />
            <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={busy || !file || !uploadArchiveId} onClick={upload}>Unggah bukti</Button>
                <Button type="button" variant="outline" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>Perbarui bukti</Button>
            </div>
        </div>
        {loading && <p role="status" className="text-sm">Memuat pilihan bukti…</p>}
        {!loading && !options.attachments.length && <p className="text-sm text-muted-foreground">Belum ada lampiran yang lolos pemeriksaan. Lengkapi penyimpanan privat dan layanan pemeriksaan jika lampiran tetap dalam karantina.</p>}
        <form onSubmit={submit} className="space-y-4">
            {attachmentSelect('Berita acara selesai', form.beritaAcaraAttachmentId, value => change('beritaAcaraAttachmentId', value), 'execution-ba')}
            {attachmentSelect('Keputusan/persetujuan pemusnahan', form.decisionAttachmentId, value => change('decisionAttachmentId', value), 'execution-decision')}
            {attachmentSelect('Bukti pelaksanaan', form.executionProofAttachmentId, value => change('executionProofAttachmentId', value), 'execution-proof')}
            <div className="space-y-1.5"><Label htmlFor="execution-time">Waktu pelaksanaan (waktu perangkat)</Label>
                <Input id="execution-time" type="datetime-local" required value={form.performedAt} disabled={busy} onChange={event => change('performedAt', event.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="execution-method">Metode dan uraian pelaksanaan</Label>
                <Textarea id="execution-method" required minLength={10} maxLength={2000} value={form.method} disabled={busy} onChange={event => change('method', event.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="execution-copies">Penanganan media, salinan, replika, dan backup</Label>
                <Textarea id="execution-copies" required minLength={20} maxLength={4000} value={form.copiesStatement} disabled={busy} onChange={event => change('copiesStatement', event.target.value)} /></div>
            {form.witnesses.map((witness, index) => <fieldset key={index} className="space-y-3 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">Saksi {index + 1}</legend>
                <Label htmlFor={`execution-witness-${index}`}>Pengguna saksi {index + 1}</Label>
                <select id={`execution-witness-${index}`} className={selectClass} required value={witness.userId} disabled={busy || loading}
                    onChange={event => changeWitness(index, 'userId', event.target.value)}>
                    <option value="">Pilih saksi</option>{options.witnesses.map(person => <option key={person.id} value={person.id}>{person.name}{person.jabatan ? ` — ${person.jabatan}` : ''}</option>)}
                </select>
                {attachmentSelect(`Dokumen penugasan saksi ${index + 1}`, witness.authorityAttachmentId,
                    value => changeWitness(index, 'authorityAttachmentId', value), `execution-authority-${index}`)}
            </fieldset>)}
            <Button type="submit" disabled={busy || loading || !options.attachments.length}>{busy ? 'Menyimpan…' : 'Simpan bukti dan catat selesai'}</Button>
        </form>
    </section>
}
