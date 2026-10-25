import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { KlasifikasiPicker } from '@/components/KlasifikasiPicker'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/hooks/use-toast'
import { pesanGalat } from '@/lib/pesan-galat'
import { rangkaianService } from '@/services/rangkaian.service'

const STATUS_LABEL = { pending: 'Menunggu keputusan', approved: 'Disetujui', applied: 'Diterapkan', denied: 'Ditolak' }
const MIN_ALASAN = 10
const FORM_AWAL = { unitPengolahBaru: '', klasifikasiBaru: null, alasan: '' }

/** P5-T9-1: operator melihat nama unit dan "kode – jenis", bukan id mentah. */
const namaUnit = (unit) => unit?.nama ?? unit?.id ?? '-'
function labelKlasifikasi(klasifikasi) {
    if (!klasifikasi) return '-'
    if (klasifikasi.kode && klasifikasi.jenis) return `${klasifikasi.kode} – ${klasifikasi.jenis}`
    return klasifikasi.kode ?? klasifikasi.jenis ?? String(klasifikasi.id)
}

/**
 * Koreksi Berkas (§9) untuk rangkaian `diberkaskan`: satu super_admin mengajukan,
 * super_admin lain memutuskan. Hak mengajukan/memutuskan diambil dari server
 * (`dapatMengajukan`, `dapatDiputuskan`); cek peran di klien hanya menghindari
 * permintaan yang pasti ditolak, tidak pernah memberi hak.
 *
 * Bila `onChanged` diberikan (panel Alur Surat), panel memuat ulang dan membongkar
 * bagian ini, jadi bagian ini tidak memuat ulang sendiri dan memakai toast (P5-C-13).
 */
export default function KoreksiBerkasSection({ rangkaianId, status, onChanged }) {
    const { user } = useAuth()
    const { toast } = useToast()
    const aktif = user?.role === 'super_admin' && status === 'diberkaskan'
    const [data, setData] = useState(null)
    const [tersembunyi, setTersembunyi] = useState(false)
    const [error, setError] = useState('')
    const [form, setForm] = useState(FORM_AWAL)
    const [konfirmasi, setKonfirmasi] = useState(false)
    const [akanDisetujui, setAkanDisetujui] = useState(null)
    const [busy, setBusy] = useState(false)
    const terpasang = useRef(true)

    useEffect(() => {
        terpasang.current = true
        return () => { terpasang.current = false }
    }, [])

    const muat = useCallback(async () => {
        try {
            const hasil = await rangkaianService.getKoreksiBerkas(rangkaianId)
            if (!terpasang.current) return
            setData(hasil)
            setError('')
        } catch (err) {
            if (!terpasang.current) return
            // Server otoritatif: 403/404 berarti bagian ini bukan untuk pengguna ini.
            const kode = err?.status ?? err?.response?.status
            if (kode === 403 || kode === 404) setTersembunyi(true)
            else setError(pesanGalat(err, 'Koreksi Berkas belum dapat dimuat.'))
        }
    }, [rangkaianId])

    useEffect(() => { if (aktif) muat() }, [aktif, muat])

    if (!aktif || tersembunyi) return null
    if (!data) return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null

    const lama = data.rangkaian
    const unitLamaId = lama.unitPengolah?.id ?? ''
    const opsiUnit = [...(data.kandidatUnit ?? [])]
    if (lama.unitPengolah && !opsiUnit.some((unit) => unit.id === unitLamaId)) {
        opsiUnit.unshift({ id: unitLamaId, name: namaUnit(lama.unitPengolah) })
    }
    const namaPerId = new Map(opsiUnit.map((unit) => [unit.id, unit.name]))
    for (const item of data.koreksi) {
        for (const unit of [item.unitPengolahLama, item.unitPengolahBaru]) {
            if (unit?.nama && !namaPerId.has(unit.id)) namaPerId.set(unit.id, unit.nama)
        }
    }
    const unitBaruId = form.unitPengolahBaru || unitLamaId
    const unitBaru = { id: unitBaruId, nama: namaPerId.get(unitBaruId) }
    const klasBaru = form.klasifikasiBaru ?? lama.klasifikasi
    const berubah = unitBaruId !== unitLamaId || (klasBaru?.id ?? null) !== (lama.klasifikasi?.id ?? null)
    const siap = berubah && Boolean(unitBaruId) && Boolean(klasBaru) && form.alasan.trim().length >= MIN_ALASAN

    const kirim = async (aksi, pesan) => {
        setBusy(true)
        setError('')
        try {
            await aksi()
            if (!terpasang.current) return
            setForm(FORM_AWAL)
            setKonfirmasi(false)
            setAkanDisetujui(null)
            toast({ title: 'Berhasil', description: pesan })
            if (onChanged) onChanged()
            else await muat()
        } catch (err) {
            if (terpasang.current) setError(pesanGalat(err, 'Permintaan Koreksi Berkas gagal.'))
        } finally {
            if (terpasang.current) setBusy(false)
        }
    }

    const daftarNama = (ids) => ids.map((id) => namaPerId.get(id) ?? id).join(', ')

    return (
        <section aria-labelledby={`koreksi-berkas-judul-${rangkaianId}`} className="space-y-3 rounded-md border p-3">
            <h3 id={`koreksi-berkas-judul-${rangkaianId}`} className="text-sm font-semibold">Koreksi Berkas</h3>
            <p className="text-xs text-muted-foreground">
                Status diberkaskan tidak dapat dibuka kembali. Koreksi unit pengolah atau klasifikasi diajukan satu super_admin
                dan diputuskan super_admin lain.
            </p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            {data.koreksi.length > 0 && (
                <ul className="space-y-2" aria-label="Riwayat Koreksi Berkas">
                    {data.koreksi.map((item) => (
                        <li key={item.id} className="rounded border p-2 text-sm">
                            <div className="font-medium">{STATUS_LABEL[item.status] ?? item.status}</div>
                            <div>Unit pengolah: {namaUnit(item.unitPengolahLama)} → {namaUnit(item.unitPengolahBaru)}</div>
                            <div>Klasifikasi: {labelKlasifikasi(item.klasifikasiLama)} → {labelKlasifikasi(item.klasifikasiBaru)}</div>
                            <div className="text-muted-foreground">Alasan: {item.alasan}</div>
                            {item.status === 'applied' && item.unitKehilanganAkses?.length > 0 && (
                                <div className="text-muted-foreground">Unit yang kehilangan akses: {daftarNama(item.unitKehilanganAkses)}</div>
                            )}
                            {item.dapatDiputuskan === true && (akanDisetujui === item.id ? (
                                <div className="mt-2 space-y-2 rounded border border-amber-300 bg-amber-50 p-2 dark:bg-amber-500/10">
                                    <p>
                                        {item.unitKehilanganAkses?.length > 0
                                            ? `Unit yang kehilangan akses: ${daftarNama(item.unitKehilanganAkses)}`
                                            : 'Tidak ada unit yang kehilangan akses.'}
                                    </p>
                                    <div className="flex gap-2">
                                        <Button type="button" size="sm" disabled={busy}
                                            onClick={() => kirim(() => rangkaianService.putuskanKoreksiBerkas(item.id, { keputusan: 'setuju' }), 'Koreksi Berkas diterapkan')}>
                                            Ya, terapkan koreksi
                                        </Button>
                                        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setAkanDisetujui(null)}>Batal</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-2 flex gap-2">
                                    <Button type="button" size="sm" disabled={busy} onClick={() => setAkanDisetujui(item.id)}>Setujui</Button>
                                    <Button type="button" size="sm" variant="outline" disabled={busy}
                                        onClick={() => kirim(() => rangkaianService.putuskanKoreksiBerkas(item.id, { keputusan: 'tolak' }), 'Koreksi Berkas ditolak')}>
                                        Tolak
                                    </Button>
                                </div>
                            ))}
                        </li>
                    ))}
                </ul>
            )}

            {data.dapatMengajukan === true && (konfirmasi ? (
                <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm dark:bg-amber-500/10">
                    <p>Unit pengolah: {namaUnit(lama.unitPengolah)} → {namaUnit(unitBaru)}</p>
                    <p>Klasifikasi: {labelKlasifikasi(lama.klasifikasi)} → {labelKlasifikasi(klasBaru)}</p>
                    <p className="text-muted-foreground">Keduanya menentukan retensi. Periksa kembali sebelum mengajukan.</p>
                    <div className="flex gap-2">
                        <Button type="button" disabled={busy} onClick={() => kirim(() => rangkaianService.ajukanKoreksiBerkas(rangkaianId, {
                            unitPengolahBaru: unitBaruId, klasifikasiBaru: klasBaru.id, alasan: form.alasan.trim(),
                        }), 'Koreksi Berkas diajukan')}>Ajukan Koreksi Berkas</Button>
                        <Button type="button" variant="outline" disabled={busy} onClick={() => setKonfirmasi(false)}>Kembali</Button>
                    </div>
                </div>
            ) : (
                <div className="space-y-2">
                    <Label htmlFor={`koreksi-unit-${rangkaianId}`}>Unit pengolah baru</Label>
                    <select id={`koreksi-unit-${rangkaianId}`} className="w-full rounded border bg-background p-2 text-sm" value={unitBaruId}
                        onChange={(event) => setForm((prev) => ({ ...prev, unitPengolahBaru: event.target.value }))}>
                        {opsiUnit.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                    </select>
                    <p className="text-sm text-muted-foreground">Klasifikasi dipilih: {labelKlasifikasi(klasBaru)}</p>
                    <KlasifikasiPicker id={`koreksi-klasifikasi-${rangkaianId}`} label="Klasifikasi berkas baru" value={klasBaru?.kode ?? ''}
                        onChange={(kode, item) => setForm((prev) => ({
                            ...prev, klasifikasiBaru: item ? { id: item.id, kode: item.kode, jenis: item.jenis } : null,
                        }))} />
                    <Label htmlFor={`koreksi-alasan-${rangkaianId}`}>Alasan koreksi</Label>
                    <Textarea id={`koreksi-alasan-${rangkaianId}`} value={form.alasan} maxLength={2000}
                        onChange={(event) => setForm((prev) => ({ ...prev, alasan: event.target.value }))} />
                    <p className="text-xs text-muted-foreground">Minimal {MIN_ALASAN} karakter.</p>
                    <Button type="button" disabled={!siap} onClick={() => setKonfirmasi(true)}>Lanjutkan</Button>
                </div>
            ))}
        </section>
    )
}
