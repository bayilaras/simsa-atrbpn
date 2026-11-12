import { useId, useState } from 'react'
import { GitMerge, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { pesanGalat } from '@/lib/pesan-galat'
import { cn } from '@/lib/utils'
import { tunjukSilangService } from '@/services/tunjuk-silang.service'
import { PilihDokumen } from './PilihDokumen'
import { JENIS_RELASI } from './dokumen'

// Batas yang sama dengan validasi server (keterangan ≤ 2000).
const MAKS_KETERANGAN = 2000

/**
 * Menambah tunjuk silang antara dua dokumen yang dipilih lewat pencarian.
 * Isi dialog hanya terpasang selama dialog terbuka, jadi setiap pembukaan mulai dari awal.
 */
export function TambahTunjukSilangDialog({ open, onOpenChange, onBerhasil }) {
    const [menyimpan, setMenyimpan] = useState(false)
    return (
        <Dialog open={open} onOpenChange={(value) => !menyimpan && onOpenChange(value)}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <GitMerge className="h-5 w-5 text-indigo-600" aria-hidden="true" />
                        Tambah Tunjuk Silang
                    </DialogTitle>
                    <DialogDescription>
                        Pilih dua dokumen dari unit kerja yang sama, lalu tentukan jenis hubungannya.
                    </DialogDescription>
                </DialogHeader>
                <TambahIsi menyimpan={menyimpan} setMenyimpan={setMenyimpan} onOpenChange={onOpenChange} onBerhasil={onBerhasil} />
            </DialogContent>
        </Dialog>
    )
}

function TambahIsi({ menyimpan, setMenyimpan, onOpenChange, onBerhasil }) {
    const idDasar = useId()
    const [sumber, setSumber] = useState(null)
    const [tujuan, setTujuan] = useState(null)
    const [relasi, setRelasi] = useState('referensi')
    const [keterangan, setKeterangan] = useState('')
    const [galat, setGalat] = useState('')

    const pilihSumber = (dokumen) => {
        setSumber(dokumen)
        // Tujuan dicari di unit kerja dokumen sumber, jadi pilihan lama tidak lagi berlaku.
        setTujuan(null)
        setGalat('')
    }

    const simpan = async () => {
        if (!sumber || !tujuan || menyimpan) return
        setMenyimpan(true)
        setGalat('')
        try {
            await tunjukSilangService.create({
                sourceType: sumber.tipe, sourceId: sumber.id,
                targetType: tujuan.tipe, targetId: tujuan.id,
                jenisRelasi: relasi,
                keterangan: keterangan.trim() || undefined,
            })
            setMenyimpan(false)
            onOpenChange(false)
            onBerhasil?.({ sumber, tujuan })
        } catch (err) {
            setMenyimpan(false)
            setGalat(pesanGalat(err, 'Tunjuk silang belum dapat disimpan. Silakan coba lagi.'))
        }
    }

    return (
        <>
            <div className="grid gap-5">
                <PilihDokumen judul="Dokumen sumber" value={sumber} onChange={pilihSumber} hanyaDapatDitautkan disabled={menyimpan} />

                {sumber ? (
                    <PilihDokumen
                        judul="Dokumen tujuan"
                        value={tujuan}
                        onChange={(dokumen) => { setTujuan(dokumen); setGalat('') }}
                        jenisAwal="surat_masuk"
                        unitKerjaId={sumber.unitKerjaId || undefined}
                        kecualikan={sumber}
                        hanyaDapatDitautkan
                        disabled={menyimpan}
                    />
                ) : (
                    <div className="grid gap-2">
                        <p className="text-sm font-medium">Dokumen tujuan</p>
                        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                            Pilih dokumen sumber terlebih dahulu.
                        </p>
                    </div>
                )}

                <div className="grid gap-2">
                    <p id={`${idDasar}-relasi`} className="text-sm font-medium">Jenis hubungan</p>
                    <div role="group" aria-labelledby={`${idDasar}-relasi`} className="flex flex-wrap gap-2">
                        {JENIS_RELASI.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                aria-pressed={relasi === item.value}
                                disabled={menyimpan}
                                onClick={() => setRelasi(item.value)}
                                className={cn(
                                    'min-h-9 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    relasi === item.value
                                        ? 'border-indigo-600 bg-indigo-600 text-white'
                                        : 'border-border bg-card text-muted-foreground hover:text-foreground',
                                )}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid gap-2">
                    <Label htmlFor={`${idDasar}-keterangan`}>Keterangan (opsional)</Label>
                    <Textarea
                        id={`${idDasar}-keterangan`}
                        rows={3}
                        className="resize-none"
                        maxLength={MAKS_KETERANGAN}
                        placeholder="Catatan singkat tentang hubungan kedua dokumen"
                        value={keterangan}
                        disabled={menyimpan}
                        onChange={(e) => setKeterangan(e.target.value)}
                    />
                </div>
            </div>
            {galat && <p role="alert" className="text-sm text-destructive">{galat}</p>}
            <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={menyimpan}>Batal</Button>
                <Button type="button" onClick={simpan} disabled={!sumber || !tujuan || menyimpan} className="bg-indigo-600 hover:bg-indigo-700">
                    {menyimpan && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    Simpan Tunjuk Silang
                </Button>
            </DialogFooter>
        </>
    )
}

export default TambahTunjukSilangDialog
