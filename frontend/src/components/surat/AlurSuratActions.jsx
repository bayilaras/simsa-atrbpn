import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useLacakSearch } from '@/hooks/use-lacak-search'
import rangkaianService from '@/services/rangkaian.service'
import { ReferensiSection } from '@/components/surat-keluar/ReferensiSection'
import { JENIS_RELASI_LABEL } from '@/lib/tindak-lanjut'
import { pesanGalat } from '@/lib/pesan-galat'
import { AlasanDialog } from './AlasanDialog'
import { BerkaskanDialog } from './BerkaskanDialog'

const MIN_ALASAN = 10

/**
 * Aksi tingkat rangkaian di panel Alur Surat. Setiap tombol mengikuti `aksiDiizinkan` dari server
 * (otoritatif); server tetap memeriksa ulang wewenang pada setiap permintaan.
 */
export function AlurSuratActions({ detail, onChanged }) {
    const { toast } = useToast()
    const [dialog, setDialog] = useState(null)
    if (!detail?.rangkaian) return null
    const r = detail.rangkaian
    const aksi = new Set(detail.aksiDiizinkan || [])
    const tampil = ['tandai_selesai', 'buka_kembali', 'berkaskan', 'ubah_unit_pengolah', 'gabung'].some((kode) => aksi.has(kode))
    if (!tampil) return null
    const tutup = (value) => { if (!value) setDialog(null) }
    const berhasil = (pesan) => { toast({ title: 'Berhasil', description: pesan }); onChanged?.() }
    return (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Aksi rangkaian">
            {aksi.has('tandai_selesai') && <Button type="button" size="sm" variant="outline" onClick={() => setDialog('selesai')}>Tandai Selesai</Button>}
            {aksi.has('buka_kembali') && <Button type="button" size="sm" variant="outline" onClick={() => setDialog('buka')}>Buka Kembali</Button>}
            {aksi.has('berkaskan') && <Button type="button" size="sm" onClick={() => setDialog('berkaskan')}>Berkaskan ke Direktorat (Unit Pengolah)</Button>}
            {aksi.has('ubah_unit_pengolah') && <Button type="button" size="sm" variant="outline" onClick={() => setDialog('pengolah')}>Ubah Unit Pengolah</Button>}
            {aksi.has('gabung') && <Button type="button" size="sm" variant="outline" onClick={() => setDialog('gabung')}>Gabungkan Rangkaian</Button>}
            {aksi.has('tandai_selesai') && (
                <AlasanDialog open={dialog === 'selesai'} onOpenChange={tutup} title="Tandai Selesai" label="Catatan penyelesaian"
                    description="Menandai rangkaian selesai secara manual. Tidak boleh ada disposisi terbuka atau surat keluar draft."
                    onSubmit={async (catatan) => { await rangkaianService.tandaiSelesai(r.id, catatan); berhasil('Rangkaian ditandai selesai') }} />
            )}
            {aksi.has('buka_kembali') && (
                <AlasanDialog open={dialog === 'buka'} onOpenChange={tutup} title="Buka Kembali Rangkaian"
                    description={`Rangkaian ${r.kode} kembali berstatus aktif.`}
                    onSubmit={async (alasan) => { await rangkaianService.bukaKembali(r.id, alasan); berhasil('Rangkaian dibuka kembali') }} />
            )}
            {dialog === 'berkaskan' && (
                <BerkaskanDialog open onOpenChange={tutup} rangkaian={r} onBerhasil={() => berhasil(`Rangkaian ${r.kode} diberkaskan`)} />
            )}
            {dialog === 'pengolah' && (
                <UbahUnitPengolahDialog onOpenChange={tutup} rangkaian={r} peserta={detail.peserta ?? []}
                    onBerhasil={() => berhasil('Unit pengolah diubah')} />
            )}
            {dialog === 'gabung' && (
                <GabungDialog onOpenChange={tutup} target={r} peserta={detail.peserta ?? []} onBerhasil={() => berhasil('Rangkaian digabungkan')} />
            )}
        </div>
    )
}

/** Gabungkan Rangkaian: sumber dicari lewat Lacak, pratinjau unit yang mendapat akses baru, alasan wajib. */
function GabungDialog({ onOpenChange, target, peserta, onBerhasil }) {
    const [term, setTerm] = useState('')
    const [sumber, setSumber] = useState(null)
    const [pratinjau, setPratinjau] = useState(null)
    const [memuatPratinjau, setMemuatPratinjau] = useState(false)
    const [alasan, setAlasan] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const { loading: mencari, data } = useLacakSearch(term, { mode: 'lacak', enabled: !sumber })
    const pilihan = (data?.kelompok || []).filter((k) => k.rangkaian && k.rangkaian.id !== target.id && ['aktif', 'selesai'].includes(k.rangkaian.status))
    const namaUnit = new Map(peserta.map((p) => [p.unitKerjaId, p.nama]))

    const pilih = async (rangkaian) => {
        setSumber(rangkaian)
        setPratinjau(null)
        setError(null)
        setMemuatPratinjau(true)
        try {
            setPratinjau(await rangkaianService.pratinjauGabung(target.id, rangkaian.id))
        } catch (err) {
            setError(pesanGalat(err, 'Pratinjau penggabungan gagal dimuat'))
        } finally {
            setMemuatPratinjau(false)
        }
    }
    const gantiSumber = () => {
        setSumber(null)
        setPratinjau(null)
        setError(null)
    }
    const gabung = async () => {
        setLoading(true)
        setError(null)
        try {
            await rangkaianService.gabung(target.id, { sumberId: sumber.id, alasan: alasan.trim() })
            setLoading(false)
            onOpenChange(false)
            onBerhasil?.()
        } catch (err) {
            setLoading(false)
            setError(pesanGalat(err, 'Gagal menggabungkan'))
        }
    }
    const unitBaru = [...(pratinjau?.unitBaruDiTarget || []), ...(pratinjau?.unitBaruDiSumber || [])].map((id) => namaUnit.get(id) ?? id)
    return (
        <Dialog open onOpenChange={(value) => !loading && onOpenChange(value)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Gabungkan Rangkaian ke {target.kode}</DialogTitle>
                    <DialogDescription>Rangkaian sumber beserta disposisinya dipindahkan ke rangkaian ini. Tindakan ini diaudit.</DialogDescription>
                </DialogHeader>
                {!sumber ? (
                    <div className="space-y-2">
                        <Label htmlFor="cari-rangkaian-sumber">Cari rangkaian sumber</Label>
                        <Input id="cari-rangkaian-sumber" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Nomor atau perihal surat (min. 3 karakter)" />
                        {mencari && (
                            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Mencari…
                            </p>
                        )}
                        <ul className="space-y-1">
                            {pilihan.map((k) => (
                                <li key={k.kunci}>
                                    <Button type="button" variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => pilih(k.rangkaian)}>
                                        <span className="font-mono">{k.rangkaian.kode}</span>&nbsp;· {k.rangkaian.judul}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <div className="space-y-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                            <p>Sumber: <strong className="font-mono">{sumber.kode}</strong></p>
                            <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={gantiSumber} disabled={loading}>Ganti sumber</Button>
                        </div>
                        {memuatPratinjau ? (
                            <p role="status" className="text-muted-foreground">Memuat pratinjau akses…</p>
                        ) : pratinjau && (
                            <p>Unit yang mendapat akses baru: {unitBaru.length > 0 ? unitBaru.join(', ') : 'tidak ada'}</p>
                        )}
                        <Label htmlFor="alasan-gabung">Alasan</Label>
                        <Textarea id="alasan-gabung" value={alasan} onChange={(event) => setAlasan(event.target.value)} rows={3} disabled={loading} />
                        <p className="text-xs text-muted-foreground">Minimal {MIN_ALASAN} karakter.</p>
                    </div>
                )}
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Batal</Button>
                    <Button type="button" onClick={gabung} disabled={!sumber || !pratinjau || alasan.trim().length < MIN_ALASAN || loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                        Gabungkan
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** Ubah Unit Pengolah (spec:475, T25-5): unit hanya dari jangkauan, dengan pratinjau selisih akses. */
function UbahUnitPengolahDialog({ onOpenChange, rangkaian, peserta, onBerhasil }) {
    const [opsi, setOpsi] = useState(null)
    const [unit, setUnit] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    useEffect(() => {
        let aktif = true
        rangkaianService.opsiBerkas(rangkaian.id).then((data) => {
            if (!aktif) return
            setOpsi(data)
            setUnit(data.unitPengolahId ?? '')
        }).catch((err) => {
            if (aktif) setError(pesanGalat(err, 'Gagal memuat daftar unit'))
        })
        return () => { aktif = false }
    }, [rangkaian.id])

    const pesertaIds = new Set(peserta.map((p) => p.unitKerjaId))
    const berubah = Boolean(opsi && unit && unit !== opsi.unitPengolahId)
    const namaTerpilih = opsi?.unitDalamJangkauan.find((item) => item.id === unit)?.name ?? unit

    const simpan = async () => {
        setLoading(true)
        setError(null)
        try {
            await rangkaianService.ubahUnitPengolah(rangkaian.id, unit)
            setLoading(false)
            onOpenChange(false)
            onBerhasil?.()
        } catch (err) {
            setLoading(false)
            setError(pesanGalat(err, 'Gagal mengubah unit pengolah'))
        }
    }

    return (
        <Dialog open onOpenChange={(value) => !loading && onOpenChange(value)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Ubah Unit Pengolah</DialogTitle>
                    <DialogDescription>Rangkaian {rangkaian.kode}</DialogDescription>
                </DialogHeader>
                <p className="text-sm">Unit pengolah menentukan retensi berkas.</p>
                {!opsi && !error && (
                    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Memuat daftar unit…
                    </p>
                )}
                {opsi && (
                    <fieldset className="space-y-2">
                        <legend className="text-sm font-medium">Unit Pengolah (hanya unit dalam jangkauan)</legend>
                        {opsi.unitDalamJangkauan.map((item) => (
                            <label key={item.id} className="flex items-center gap-2 text-sm">
                                <input type="radio" name="ubah-unit-pengolah" value={item.id} checked={unit === item.id} onChange={() => setUnit(item.id)} disabled={loading} />
                                {item.name}
                            </label>
                        ))}
                    </fieldset>
                )}
                {berubah && (
                    <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-500/10">
                        {pesertaIds.has(unit)
                            ? `${namaTerpilih} sudah menjadi peserta rangkaian; tidak ada unit yang mendapat akses baru.`
                            : `${namaTerpilih} akan mendapat akses baca ke rangkaian ini sebagai unit pengolah.`}
                    </p>
                )}
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Batal</Button>
                    <Button type="button" onClick={simpan} disabled={!berubah || loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                        Simpan
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** Tutup Disposisi oleh admin pengawas (spec:478); server tetap memeriksa wewenang per baris (C-7). */
export function TutupDisposisiButton({ distribusi, onChanged }) {
    const { toast } = useToast()
    const [open, setOpen] = useState(false)
    return (
        <>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Tutup Disposisi</Button>
            <AlasanDialog open={open} onOpenChange={setOpen} title="Tutup Disposisi" submitLabel="Tutup Disposisi" destructive
                description="Menutup disposisi yang tidak dapat diproses unit tujuan agar rangkaian tidak macet."
                onSubmit={async (alasan) => {
                    await rangkaianService.tutupDisposisi(distribusi.id, alasan)
                    toast({ title: 'Berhasil', description: 'Disposisi ditutup' })
                    onChanged?.()
                }} />
        </>
    )
}

/** Ajukan Akses untuk node tersamar (hanya bila server menandai dapatAjukanAkses). */
export function AjukanAksesButton({ anggotaId, onChanged }) {
    const { toast } = useToast()
    const [open, setOpen] = useState(false)
    return (
        <>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Ajukan Akses</Button>
            <AlasanDialog open={open} onOpenChange={setOpen} title="Ajukan Akses" label="Tujuan akses" minLength={20} submitLabel="Ajukan"
                description="Permohonan akses baca akan ditinjau super admin."
                onSubmit={async (purpose) => {
                    await rangkaianService.ajukanAkses(anggotaId, purpose)
                    toast({ title: 'Berhasil', description: 'Permohonan akses diajukan' })
                    onChanged?.()
                }} />
        </>
    )
}

/** Batalkan satu relasi aktif (ditawarkan server hanya kepada pengawas, T16-6). */
export function BatalRelasiButton({ relasi, onChanged }) {
    const { toast } = useToast()
    const [open, setOpen] = useState(false)
    const label = JENIS_RELASI_LABEL[relasi.jenisRelasi] ?? relasi.jenisRelasi
    return (
        <>
            <Button type="button" size="sm" variant="ghost" aria-label={label ? `Batalkan Relasi ${label}` : undefined} onClick={() => setOpen(true)}>
                Batalkan Relasi
            </Button>
            <AlasanDialog open={open} onOpenChange={setOpen} title="Batalkan Relasi" submitLabel="Batalkan" destructive
                description={label ? `Relasi "${label}" dibatalkan. Surat tetap menjadi anggota rangkaian.` : undefined}
                onSubmit={async (alasan) => {
                    await rangkaianService.batalRelasi(relasi.id, alasan)
                    toast({ title: 'Berhasil', description: 'Relasi dibatalkan' })
                    onChanged?.()
                }} />
        </>
    )
}

/** Tautkan ke Rangkaian (§2b.3) dari detail surat: target boleh surat tunggal maupun anggota rangkaian. */
export function TautkanDialog({ open, onOpenChange, jenis, surat, onBerhasil }) {
    const [loading, setLoading] = useState(false)
    return (
        <Dialog open={open} onOpenChange={(value) => !loading && onOpenChange(value)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Tautkan ke Rangkaian</DialogTitle>
                    <DialogDescription>Pilih surat yang dirujuk surat ini.</DialogDescription>
                </DialogHeader>
                <TautkanIsi jenis={jenis} surat={surat} loading={loading} setLoading={setLoading} onOpenChange={onOpenChange} onBerhasil={onBerhasil} />
            </DialogContent>
        </Dialog>
    )
}

function TautkanIsi({ jenis, surat, loading, setLoading, onOpenChange, onBerhasil }) {
    const [tujuan, setTujuan] = useState(null)
    const [error, setError] = useState(null)
    const simpan = async () => {
        setLoading(true)
        setError(null)
        try {
            await rangkaianService.tautkanKeSurat({ jenis, suratId: surat.id, keJenis: tujuan.jenis, keSuratId: tujuan.suratId, jenisRelasi: tujuan.jenisRelasi })
            setLoading(false)
            onOpenChange(false)
            onBerhasil?.()
        } catch (err) {
            setLoading(false)
            setError(pesanGalat(err, 'Gagal menautkan'))
        }
    }
    return (
        <>
            <ReferensiSection referensi={tujuan} onPilih={setTujuan} onHapus={() => setTujuan(null)} disabled={loading}
                onUbahRelasi={(jenisRelasi) => setTujuan((prev) => (prev ? { ...prev, jenisRelasi } : prev))} label="Surat tujuan" />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Batal</Button>
                <Button type="button" onClick={simpan} disabled={!tujuan || loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    Tautkan
                </Button>
            </DialogFooter>
        </>
    )
}
