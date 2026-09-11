import { useEffect, useState } from 'react'
import { api } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ExternalPreservationFields({ electronicId, data, onChange, disabled }) {
    const [options, setOptions] = useState({ attachments: [], arsipId: '' })
    const [revision, setRevision] = useState(0)
    const [loading, setLoading] = useState(true)
    const [uploading, setUploading] = useState(false)
    const [file, setFile] = useState(null)
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    useEffect(() => {
        let active = true
        setLoading(true)
        api.get(`/api/arsip-elektronik/${electronicId}/preservasi/options`).then(result => {
            if (active) { setOptions(result); setError('') }
        }).catch(err => { if (active) setError(err.message) })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [electronicId, revision])
    const upload = async () => {
        if (!file || !options.arsipId || uploading) return
        const body = new FormData(); body.append('file', file)
        setUploading(true); setError('')
        try {
            await api.post(`/api/upload/arsip/${options.arsipId}`, body)
            setMessage('Lampiran masuk karantina. Perbarui pilihan setelah pemeriksaan malware dan integritas selesai.')
            setRevision(value => value + 1)
        } catch (err) { setError(err.message) }
        finally { setUploading(false) }
    }
    return <div className="space-y-4 rounded-md border p-3">
        <p className="text-sm text-muted-foreground">SIMSA mencatat tindakan yang dilakukan dengan perangkat lain. Hasil dan bukti dibaca ulang untuk memeriksa hash; validasi format, mutu hasil, dan pelaksanaan tetap ditinjau petugas.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="text-sm">{message}</p>}
        {['outputAttachmentId', 'evidenceAttachmentId'].map((field, index) => <div key={field} className="space-y-1.5">
            <Label htmlFor={field}>{index === 0 ? 'Berkas hasil tindakan eksternal' : 'Dokumen bukti pelaksanaan / kendali mutu'}</Label>
            <select id={field} required disabled={disabled || loading || uploading} value={data[field] || ''}
                onChange={event => onChange(field, event.target.value)} className="w-full rounded-md border bg-background p-2 text-sm">
                <option value="">Pilih lampiran terverifikasi</option>
                {options.attachments.map(item => <option key={item.id} value={item.id}>{item.fileName}</option>)}
            </select>
        </div>)}
        <div className="space-y-2">
            <Label htmlFor="preservation-file">Unggah hasil atau bukti baru (maksimal 10 MB)</Label>
            <Input id="preservation-file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif" disabled={disabled || uploading}
                onChange={event => setFile(event.target.files?.[0] || null)} />
            <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={disabled || uploading || !file || !options.arsipId} onClick={upload}>Unggah lampiran</Button>
                <Button type="button" variant="outline" disabled={disabled || loading || uploading} onClick={() => setRevision(value => value + 1)}>Perbarui pilihan</Button>
            </div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="toolName">Perangkat yang digunakan petugas</Label>
            <Input id="toolName" required maxLength={200} value={data.toolName || ''} disabled={disabled} onChange={event => onChange('toolName', event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="toolVersion">Versi perangkat</Label>
            <Input id="toolVersion" required maxLength={100} value={data.toolVersion || ''} disabled={disabled} onChange={event => onChange('toolVersion', event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="activityAt">Waktu tindakan (waktu perangkat)</Label>
            <Input id="activityAt" type="datetime-local" required value={data.activityAt || ''} disabled={disabled} onChange={event => onChange('activityAt', event.target.value)} /></div>
    </div>
}
