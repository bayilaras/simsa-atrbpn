import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import approvalService from '@/services/approval.service'

const LABEL_PERAN = {
    super_admin: 'Super Admin',
    admin_unit: 'Admin Unit',
    admin_dirjen: 'Admin Unit',
    admin_sesditjen: 'Admin Unit',
}

const KATA = {
    ajukan: { judul: 'Ajukan Persetujuan', selesai: 'diajukan', ditolak: 'tidak dapat diajukan' },
    setujui: { judul: 'Setujui Surat', selesai: 'disetujui', ditolak: 'tidak dapat disetujui' },
}

/**
 * Bilah tindakan massal daftar Surat Keluar. `dapatDiajukan` dan
 * `dapatDisetujui` adalah baris terpilih yang memenuhi syarat tampilan; server
 * memeriksa ulang tiap surat dan melaporkan hasilnya satu per satu.
 */
export default function PersetujuanMassal({ jumlahDipilih, dapatDiajukan, dapatDisetujui, onBatalPilih, onSelesai }) {
    const [aksi, setAksi] = useState(null)
    const [penyetuju, setPenyetuju] = useState([])
    const [memuatPenyetuju, setMemuatPenyetuju] = useState(false)
    const [penyetujuId, setPenyetujuId] = useState('')
    const [catatan, setCatatan] = useState('')
    const [sibuk, setSibuk] = useState(false)
    const [galat, setGalat] = useState('')
    const [ringkasan, setRingkasan] = useState(null)

    const suratPertamaId = dapatDiajukan[0]?.id
    useEffect(() => {
        if (aksi !== 'ajukan' || !suratPertamaId) return undefined
        let batal = false
        approvalService.getEligibleApprovers(suratPertamaId)
            .then((daftar) => { if (!batal) setPenyetuju(Array.isArray(daftar) ? daftar : []) })
            .catch(() => { if (!batal) setPenyetuju([]) })
            .finally(() => { if (!batal) setMemuatPenyetuju(false) })
        return () => { batal = true }
    }, [aksi, suratPertamaId])

    const buka = (jenis) => {
        setAksi(jenis)
        setPenyetujuId('')
        setCatatan('')
        setGalat('')
        setPenyetuju([])
        setMemuatPenyetuju(jenis === 'ajukan')
    }

    const jalankan = async () => {
        const baris = aksi === 'ajukan' ? dapatDiajukan : dapatDisetujui
        const ids = baris.map(item => item.id)
        setSibuk(true)
        setGalat('')
        try {
            const data = aksi === 'ajukan'
                ? await approvalService.submitBulk(ids, penyetujuId, catatan)
                : await approvalService.approveBulk(ids, catatan)
            const nomor = new Map(baris.map(item => [item.id, item.nomorSurat || item.perihal || 'Surat tanpa nomor']))
            const hasil = Array.isArray(data?.hasil) ? data.hasil : []
            setRingkasan({
                aksi,
                berhasil: hasil.filter(item => item.berhasil).length,
                ditolak: hasil.filter(item => !item.berhasil).map(item => ({
                    id: item.suratId,
                    nomor: nomor.get(item.suratId) || 'Surat',
                    pesan: item.pesan || 'Surat tidak dapat diproses.',
                })),
            })
            setAksi(null)
            onSelesai?.()
        } catch (error) {
            setGalat(error?.message || 'Permintaan tidak dapat diproses. Periksa koneksi lalu coba lagi.')
        } finally {
            setSibuk(false)
        }
    }

    const jumlahAksi = aksi === 'ajukan' ? dapatDiajukan.length : dapatDisetujui.length

    return (
        <>
            {ringkasan && (
                <div role="status" className="border-b border-border/60 bg-muted/30 px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                            <p className="flex items-center gap-2 font-medium">
                                <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-600" />
                                {ringkasan.berhasil} surat berhasil {KATA[ringkasan.aksi].selesai}.
                            </p>
                            {ringkasan.ditolak.length > 0 && (
                                <>
                                    <p className="text-destructive">{ringkasan.ditolak.length} surat {KATA[ringkasan.aksi].ditolak}:</p>
                                    <ul className="list-disc space-y-0.5 pl-5">
                                        {ringkasan.ditolak.map(item => (
                                            <li key={item.id}><span className="font-medium">{item.nomor}</span>: {item.pesan}</li>
                                        ))}
                                    </ul>
                                </>
                            )}
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setRingkasan(null)}>Tutup</Button>
                    </div>
                </div>
            )}

            {jumlahDipilih > 0 && (
                <div role="region" aria-label="Tindakan untuk surat terpilih" className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-primary/5 px-4 py-2 text-sm">
                    <span className="font-medium">{jumlahDipilih} surat dipilih</span>
                    {dapatDiajukan.length > 0 && (
                        <Button size="sm" onClick={() => buka('ajukan')}>
                            <Send aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
                            Ajukan Persetujuan ({dapatDiajukan.length})
                        </Button>
                    )}
                    {dapatDisetujui.length > 0 && (
                        <Button size="sm" onClick={() => buka('setujui')}>
                            <CheckCircle2 aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
                            Setujui ({dapatDisetujui.length})
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={onBatalPilih}>
                        <X aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
                        Batalkan pilihan
                    </Button>
                </div>
            )}

            <Dialog open={Boolean(aksi)} onOpenChange={(open) => { if (!open && !sibuk) setAksi(null) }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{aksi ? `${KATA[aksi].judul} (${jumlahAksi} surat)` : ''}</DialogTitle>
                        <DialogDescription>
                            {aksi === 'ajukan'
                                ? 'Semua surat terpilih dikirim ke satu penyetuju. Setiap surat tetap diperiksa satu per satu.'
                                : 'Setiap surat diperiksa satu per satu. Surat yang tidak menunggu keputusan Anda dilewati.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {aksi === 'ajukan' && (
                            <div className="space-y-2">
                                <Label htmlFor="persetujuan-massal-penyetuju">Penyetuju</Label>
                                <select
                                    id="persetujuan-massal-penyetuju"
                                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                                    value={penyetujuId}
                                    onChange={(event) => setPenyetujuId(event.target.value)}
                                    disabled={sibuk || memuatPenyetuju}
                                >
                                    <option value="">{memuatPenyetuju ? 'Memuat daftar penyetuju…' : 'Pilih administrator aktif'}</option>
                                    {penyetuju.map(item => (
                                        <option key={item.id} value={item.id}>
                                            {item.name || 'Tanpa nama'}{LABEL_PERAN[item.role] ? ` (${LABEL_PERAN[item.role]})` : ''}
                                        </option>
                                    ))}
                                </select>
                                {!memuatPenyetuju && penyetuju.length === 0 && (
                                    <p className="text-xs text-amber-700 dark:text-amber-300">
                                        Belum ada administrator aktif lain yang dapat menjadi penyetuju pada unit ini.
                                    </p>
                                )}
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="persetujuan-massal-catatan">Catatan (opsional)</Label>
                            <Textarea
                                id="persetujuan-massal-catatan"
                                rows={3}
                                maxLength={2000}
                                value={catatan}
                                onChange={(event) => setCatatan(event.target.value)}
                                disabled={sibuk}
                                placeholder="Catatan yang sama dicatat pada setiap surat."
                            />
                        </div>
                        {galat && <p role="alert" className="text-sm text-destructive">{galat}</p>}
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" disabled={sibuk} onClick={() => setAksi(null)}>Batal</Button>
                        <Button type="button" disabled={sibuk || (aksi === 'ajukan' && !penyetujuId)} onClick={jalankan}>
                            {sibuk && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />}
                            {aksi === 'setujui' ? 'Setujui' : 'Ajukan'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
