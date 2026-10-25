import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ResourcePagination } from '@/components/ResourcePagination'
import { DistributeDialog } from '@/components/DistributeDialog'
import { BerkaskanDialog } from '@/components/surat/BerkaskanDialog'
import { TautkanDialog } from '@/components/surat/AlurSuratActions'
import { usePaginatedResource } from '@/hooks/use-paginated-resource'
import { useToast } from '@/hooks/use-toast'
import { buildTindakLanjutState } from '@/lib/tindak-lanjut'
import { lacakHref } from '@/lib/lacak-link'
import {
    KATEGORI_PERLU_DILENGKAPI, LABEL_KATEGORI_PERLU_DILENGKAPI, LABEL_STATUS_DISPOSISI, umumkanRingkasanPerluDilengkapi,
} from '@/lib/perlu-dilengkapi'
import rangkaianService from '@/services/rangkaian.service'

const hrefSurat = surat => `/surat/${surat.jenis === 'surat_masuk' ? 'masuk' : 'keluar'}/${surat.id}`

function judulBaris(item) {
    if (item.masked) return item.label || 'Dikecualikan'
    if (item.jenis === 'rangkaian') return item.rangkaian?.judul || item.rangkaian?.kode || ''
    return [item.surat?.nomorSurat, item.surat?.perihal].filter(Boolean).join(' — ') || '(tanpa nomor dan perihal)'
}

function InfoBaris({ item }) {
    return (
        <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{LABEL_KATEGORI_PERLU_DILENGKAPI[item.kategori] ?? item.kategori}</Badge>
                {item.dataLama && <Badge variant="secondary">Data lama</Badge>}
                {item.disposisi?.lewatBatas && (
                    <Badge variant="destructive"><AlertTriangle aria-hidden="true" />Lewat batas waktu</Badge>
                )}
            </div>
            <p className={item.masked ? 'text-sm italic text-muted-foreground' : 'truncate text-sm font-medium'}>{judulBaris(item)}</p>
            <p className="text-xs text-muted-foreground">
                {item.unitNama}
                {item.rangkaian?.kode && (
                    // FR:35: tautan hanya bila server menyatakan GET /api/rangkaian/:id akan 200 (sama dengan Berkas Rangkaian).
                    <> · {item.rangkaian.dapatDibuka === true
                        ? <Link to={lacakHref({ rangkaianId: item.rangkaian.id })} className="underline-offset-2 hover:underline">{item.rangkaian.kode}</Link>
                        : <span title="Rangkaian ini tidak dapat Anda buka">{item.rangkaian.kode}</span>}</>
                )}
                {item.disposisi && (
                    <> · Disposisi ke {item.disposisi.targetUnitNama} · {LABEL_STATUS_DISPOSISI[item.disposisi.status] ?? item.disposisi.status}
                        {item.disposisi.batasWaktu ? ` · batas ${item.disposisi.batasWaktu}` : ''}</>
                )}
                {item.kategori === 'tindak_lanjut_tertahan' && item.surat?.approvalStatus && <> · Status persetujuan: {item.surat.approvalStatus}</>}
            </p>
        </div>
    )
}

/** Tombol hanya dari aksiDiizinkan server (§7); klien tidak menebak hak dari unit. */
function AksiBaris({ item, onAksi }) {
    const aksi = new Set(item.aksiDiizinkan || [])
    return (
        <div className="flex shrink-0 flex-wrap gap-2">
            {aksi.has('tindak_lanjut') && <Button type="button" size="sm" onClick={() => onAksi('tindak_lanjut', item)}>Tindak Lanjut</Button>}
            {aksi.has('disposisi') && <Button type="button" size="sm" variant="outline" onClick={() => onAksi('disposisi', item)}>Disposisi</Button>}
            {aksi.has('buka_kotak_disposisi') && <Button size="sm" variant="outline" asChild><Link to="/distribusi">Buka Kotak Disposisi</Link></Button>}
            {aksi.has('buat_nd_penjelas') && <Button type="button" size="sm" onClick={() => onAksi('buat_nd_penjelas', item)}>Buat ND Penjelas</Button>}
            {aksi.has('berkaskan') && <Button type="button" size="sm" onClick={() => onAksi('berkaskan', item)}>Berkaskan ke Direktorat</Button>}
            {aksi.has('tandai_inisiatif') && <Button type="button" size="sm" variant="outline" onClick={() => onAksi('inisiatif', item)}>Tandai Inisiatif</Button>}
            {aksi.has('tautkan') && <Button type="button" size="sm" variant="outline" onClick={() => onAksi('tautkan', item)}>Tautkan</Button>}
            {aksi.has('buka_surat') && item.surat && <Button size="sm" variant="ghost" asChild><Link to={hrefSurat(item.surat)}>Buka surat</Link></Button>}
        </div>
    )
}

export function PerluDilengkapiTab() {
    const navigate = useNavigate()
    const { toast } = useToast()
    const [kategori, setKategori] = useState('')
    const [tampilkanDataLama, setTampilkanDataLama] = useState(false)
    const [revisiRingkasan, setRevisiRingkasan] = useState(0)
    const [ringkasan, setRingkasan] = useState(null)
    const [dialog, setDialog] = useState(null)
    const [menyimpan, setMenyimpan] = useState(false)
    const [galat, setGalat] = useState(null)

    useEffect(() => {
        let aktif = true
        rangkaianService.ringkasanPerluDilengkapi({ tampilkanDataLama })
            .then((data) => {
                if (!aktif) return
                setRingkasan(data)
                // Badge sidebar hanya menghitung data tanpa data lama; bagikan tanpa request tambahan.
                if (!tampilkanDataLama) umumkanRingkasanPerluDilengkapi(data)
            })
            .catch(() => { if (aktif) setRingkasan(null) })
        return () => { aktif = false }
    }, [tampilkanDataLama, revisiRingkasan])

    const fetchPage = useCallback(({ page, limit }) => rangkaianService.perluDilengkapi({
        kategori: kategori || undefined, tampilkanDataLama, page, limit,
    }), [kategori, tampilkanDataLama])
    const resource = usePaginatedResource(fetchPage, { queryKey: JSON.stringify({ kategori, tampilkanDataLama }), pageSize: 20 })
    const { reload } = resource

    const tutup = useCallback(() => { setDialog(null); setGalat(null) }, [])
    const berhasil = useCallback((pesan) => {
        tutup()
        // DistributeDialog P3 sudah menampilkan toast sendiri; hanya dialog tanpa toast yang memberi pesan [P4-T20-1].
        if (pesan) toast({ title: pesan })
        reload()
        setRevisiRingkasan(nilai => nilai + 1)
    }, [reload, toast, tutup])
    const tutupBila = (buka) => { if (!buka && !menyimpan) tutup() }

    const onAksi = (jenis, item) => {
        const surat = item.surat ? { ...item.surat, rangkaian: item.rangkaian } : null
        if (jenis === 'tindak_lanjut') {
            navigate('/surat/keluar/tambah', { state: buildTindakLanjutState('surat_masuk', surat, 'saya_balas') })
        } else if (jenis === 'buat_nd_penjelas') {
            navigate('/surat/keluar/tambah', { state: buildTindakLanjutState('surat_keluar', surat, 'buat_nd_penjelas') })
        } else {
            setGalat(null)
            setDialog({ jenis, item })
        }
    }

    const tandaiInisiatif = async () => {
        setMenyimpan(true)
        setGalat(null)
        try {
            await rangkaianService.tandaiInisiatif(dialog.item.surat.id)
            berhasil('Surat ditandai sebagai Surat Inisiatif')
        } catch (error) {
            setGalat(error?.message || 'Gagal menandai surat')
        } finally {
            setMenyimpan(false)
        }
    }

    const item = dialog?.item
    return (
        <section aria-label="Perlu Dilengkapi" className="space-y-4">
            <p className="text-sm text-muted-foreground">
                Surat dan rangkaian dalam jangkauan Anda yang rantainya belum lengkap. Surat yang tidak boleh Anda baca tampil sebagai “Dikecualikan”.
            </p>
            <div role="group" aria-label="Kategori" className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={kategori === '' ? 'default' : 'outline'} aria-pressed={kategori === ''} onClick={() => setKategori('')}>
                    {ringkasan ? `Semua (${ringkasan.total})` : 'Semua'}
                </Button>
                {KATEGORI_PERLU_DILENGKAPI.map(kode => (
                    <Button key={kode} type="button" size="sm" variant={kategori === kode ? 'default' : 'outline'} aria-pressed={kategori === kode} onClick={() => setKategori(kode)}>
                        {ringkasan ? `${LABEL_KATEGORI_PERLU_DILENGKAPI[kode]} (${ringkasan.perKategori?.[kode] ?? 0})` : LABEL_KATEGORI_PERLU_DILENGKAPI[kode]}
                    </Button>
                ))}
            </div>
            <label className="flex w-fit items-center gap-2 text-sm">
                <input type="checkbox" checked={tampilkanDataLama} onChange={event => setTampilkanDataLama(event.target.checked)} />
                Tampilkan data lama
            </label>

            {resource.error && <p role="alert" className="text-sm text-destructive">{resource.error.message || 'Gagal memuat daftar.'}</p>}
            <ul aria-label="Daftar perlu dilengkapi" className="divide-y rounded-md border">
                {resource.rows.map(baris => (
                    <li key={baris.kunci} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <InfoBaris item={baris} />
                        <AksiBaris item={baris} onAksi={onAksi} />
                    </li>
                ))}
            </ul>
            {!resource.loading && !resource.error && resource.rows.length === 0 && (
                <p role="status" className="text-sm text-muted-foreground">Tidak ada yang perlu dilengkapi untuk filter ini.</p>
            )}
            <ResourcePagination resource={resource} label="perlu dilengkapi" />

            {dialog?.jenis === 'disposisi' && (
                <DistributeDialog
                    open
                    onOpenChange={tutupBila}
                    suratData={{ id: item.surat.id, nomorSurat: item.surat.nomorSurat, perihal: item.surat.perihal, sifatSurat: item.surat.sifatSurat }}
                    sourceUnitId={item.surat.unitKerjaId}
                    onSuccess={() => berhasil()}
                />
            )}
            {dialog?.jenis === 'berkaskan' && (
                <BerkaskanDialog
                    open
                    onOpenChange={tutupBila}
                    rangkaian={{ id: item.rangkaian.id, kode: item.rangkaian.kode }}
                    onBerhasil={() => berhasil(`Rangkaian ${item.rangkaian.kode} diberkaskan`)}
                />
            )}
            {dialog?.jenis === 'tautkan' && (
                <TautkanDialog
                    open
                    onOpenChange={tutupBila}
                    jenis="surat_keluar"
                    surat={{ id: item.surat.id, nomorSurat: item.surat.nomorSurat, perihal: item.surat.perihal }}
                    onBerhasil={() => berhasil('Surat ditautkan ke rangkaian')}
                />
            )}
            <Dialog open={dialog?.jenis === 'inisiatif'} onOpenChange={tutupBila}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Tandai sebagai Surat Inisiatif?</DialogTitle>
                        <DialogDescription>
                            Surat {item?.surat?.nomorSurat || 'ini'} dicatat sebagai surat atas prakarsa sendiri (tidak menindaklanjuti surat lain).
                            Perubahan ini diaudit dan tidak mengubah isi surat.
                        </DialogDescription>
                    </DialogHeader>
                    {galat && <p role="alert" className="text-sm text-destructive">{galat}</p>}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={tutup} disabled={menyimpan}>Batal</Button>
                        <Button type="button" onClick={tandaiInisiatif} disabled={menyimpan}>Ya, tandai inisiatif</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    )
}
