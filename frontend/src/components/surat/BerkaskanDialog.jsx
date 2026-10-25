import { useEffect, useState } from 'react'
import { Archive, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { KlasifikasiPicker } from '@/components/KlasifikasiPicker'
import rangkaianService from '@/services/rangkaian.service'
import { pesanGalat } from '@/lib/pesan-galat'

/** Label klasifikasi "kode – jenis" (T14-5/T25-3), bukan id mentah. */
function labelKlasifikasi(klasifikasi) {
    if (!klasifikasi) return '-'
    return klasifikasi.kode ? `${klasifikasi.kode} – ${klasifikasi.jenis}` : klasifikasi.jenis
}

/**
 * Berkaskan ke Direktorat (§9): unit hanya dari jangkauan, klasifikasi wajib, konfirmasi dua langkah.
 * Isi dialog hanya terpasang selama dialog terbuka, jadi setiap pembukaan memuat ulang opsi dan mulai dari langkah 1.
 */
export function BerkaskanDialog({ open, onOpenChange, rangkaian, onBerhasil }) {
    const [loading, setLoading] = useState(false)
    return (
        <Dialog open={open} onOpenChange={(value) => !loading && onOpenChange(value)}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Archive className="h-5 w-5" aria-hidden="true" />
                        Berkaskan ke Direktorat (Unit Pengolah)
                    </DialogTitle>
                    <DialogDescription>Rangkaian {rangkaian.kode} akan menjadi berkas naskah milik Unit Pengolah dan dikunci.</DialogDescription>
                </DialogHeader>
                <BerkaskanIsi
                    rangkaian={rangkaian} loading={loading} setLoading={setLoading}
                    onOpenChange={onOpenChange} onBerhasil={onBerhasil}
                />
            </DialogContent>
        </Dialog>
    )
}

function BerkaskanIsi({ rangkaian, loading, setLoading, onOpenChange, onBerhasil }) {
    const [opsi, setOpsi] = useState(null)
    const [unit, setUnit] = useState('')
    const [klasifikasi, setKlasifikasi] = useState(null)
    const [langkah, setLangkah] = useState(1)
    const [error, setError] = useState(null)

    useEffect(() => {
        let aktif = true
        rangkaianService.opsiBerkas(rangkaian.id).then((data) => {
            if (!aktif) return
            setOpsi(data)
            const dalamJangkauan = (data.unitDalamJangkauan || []).some((item) => item.id === data.unitPengolahId)
            setUnit(dalamJangkauan ? data.unitPengolahId : '')
            setKlasifikasi(data.klasifikasiInduk ?? null)
        }).catch((err) => {
            if (aktif) setError(pesanGalat(err, 'Gagal memuat opsi berkas'))
        })
        return () => { aktif = false }
    }, [rangkaian.id])

    const namaUnit = opsi?.unitDalamJangkauan.find((item) => item.id === unit)?.name || unit
    const teksKlasifikasi = labelKlasifikasi(klasifikasi)

    const berkaskan = async () => {
        setLoading(true)
        setError(null)
        try {
            await rangkaianService.berkaskan(rangkaian.id, { unitPengolahId: unit, klasifikasiItemId: klasifikasi.id })
            setLoading(false)
            onOpenChange(false)
            onBerhasil?.()
        } catch (err) {
            setLoading(false)
            setError(pesanGalat(err, 'Gagal memberkaskan'))
            setLangkah(1)
        }
    }

    return (
        <>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {!opsi && !error && (
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Memuat opsi berkas…
                </p>
            )}
            {opsi && langkah === 1 && (
                <div className="space-y-4">
                    <fieldset className="space-y-2">
                        <legend className="text-sm font-medium">Unit Pengolah (hanya unit dalam jangkauan)</legend>
                        {opsi.unitDalamJangkauan.map((item) => (
                            <label key={item.id} className="flex items-center gap-2 text-sm">
                                <input type="radio" name="unit-pengolah-berkas" value={item.id} checked={unit === item.id} onChange={() => setUnit(item.id)} />
                                {item.name}
                            </label>
                        ))}
                    </fieldset>
                    <div className="space-y-2">
                        <p className="text-sm font-medium">Klasifikasi berkas <span className="text-destructive">*</span></p>
                        <p className="text-sm text-muted-foreground">{teksKlasifikasi}</p>
                        <KlasifikasiPicker
                            value={klasifikasi?.kode || ''}
                            label="Klasifikasi berkas"
                            onChange={(kode, item) => setKlasifikasi(item ? { id: item.id, kode: item.kode, jenis: item.jenis } : null)}
                        />
                    </div>
                </div>
            )}
            {opsi && langkah === 2 && (
                <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-500/10">
                    <p className="font-medium">Periksa kembali. Unit pengolah dan klasifikasi menentukan retensi berkas dan hanya dapat dikoreksi lewat Koreksi Berkas.</p>
                    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                        <dt className="text-muted-foreground">Rangkaian</dt><dd>{rangkaian.kode}</dd>
                        <dt className="text-muted-foreground">Unit Pengolah</dt><dd>{namaUnit}</dd>
                        <dt className="text-muted-foreground">Klasifikasi</dt><dd>{teksKlasifikasi}</dd>
                    </dl>
                </div>
            )}
            <DialogFooter>
                {langkah === 1 ? (
                    <>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
                        <Button type="button" onClick={() => setLangkah(2)} disabled={!opsi || !unit || !klasifikasi?.id}>Lanjut</Button>
                    </>
                ) : (
                    <>
                        <Button type="button" variant="outline" onClick={() => setLangkah(1)} disabled={loading}>Kembali</Button>
                        <Button type="button" onClick={berkaskan} disabled={loading}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                            Ya, berkaskan
                        </Button>
                    </>
                )}
            </DialogFooter>
        </>
    )
}

export default BerkaskanDialog
