import { useEffect, useId, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { pesanGalat } from '@/lib/pesan-galat'
import { cn } from '@/lib/utils'
import { JENIS_DOKUMEN, jenisDokumen } from './dokumen'

// Batas yang sama dengan validasi kata kunci di server.
const MAKS_KATA_KUNCI = 255

/**
 * Memilih satu dokumen: tentukan jenisnya, cari berdasarkan nomor atau perihal, lalu pilih dari hasil.
 * `value` berbentuk { tipe, id, nomor, judul, jenis, unitKerjaId } atau null.
 *
 * - `unitKerjaId` mempersempit pencarian ke satu unit kerja (dipakai agar tujuan seunit dengan sumber).
 * - `hanyaDapatDitautkan` menonaktifkan dokumen yang sudah tidak dapat diubah.
 * - `kecualikan` ({ tipe, id }) menonaktifkan satu dokumen, misalnya dokumen sumber.
 */
export function PilihDokumen({
    judul, value, onChange, jenisAwal = 'arsip', unitKerjaId, hanyaDapatDitautkan = false, kecualikan = null, disabled = false,
}) {
    const idDasar = useId()
    const [tipe, setTipe] = useState(value?.tipe || jenisAwal)
    const [kataKunci, setKataKunci] = useState('')
    const [percobaan, setPercobaan] = useState(0)
    const [hasil, setHasil] = useState({ kunci: null, data: [], total: 0, galat: '' })
    const kueri = useDebouncedValue(kataKunci.trim(), 300)
    const opsi = jenisDokumen(tipe)
    const kunci = `${tipe}|${unitKerjaId || ''}|${kueri}|${percobaan}`
    const memuat = !value && hasil.kunci !== kunci

    const adaPilihan = Boolean(value)
    const cari = opsi.cari
    useEffect(() => {
        if (adaPilihan) return undefined
        let aktif = true
        cari({ kataKunci: kueri || undefined, unitKerjaId: unitKerjaId || undefined })
            .then(({ data, total }) => {
                if (aktif) setHasil({ kunci, data, total: total ?? data.length, galat: '' })
            })
            .catch((err) => {
                if (aktif) setHasil({ kunci, data: [], total: 0, galat: pesanGalat(err, 'Pencarian dokumen gagal.') })
            })
        return () => { aktif = false }
    }, [adaPilihan, cari, kueri, kunci, unitKerjaId])

    const labelJenis = opsi.label.toLowerCase()

    if (value) {
        const terpilih = jenisDokumen(value.tipe)
        const Icon = terpilih.icon
        return (
            <div className="grid gap-2">
                <p className="text-sm font-medium">{judul}</p>
                <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className={`rounded-md p-1.5 ${terpilih.bg}`}>
                            <Icon className={`h-4 w-4 ${terpilih.color}`} aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{value.judul || 'Tanpa perihal'}</p>
                            <p className="truncate text-xs text-muted-foreground">
                                {terpilih.label} • No: {value.nomor || '-'}
                            </p>
                        </div>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={disabled} onClick={() => onChange(null)}>
                        Ganti
                    </Button>
                </div>
            </div>
        )
    }

    let daftar
    if (memuat) {
        daftar = (
            <p role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Memuat dokumen...
            </p>
        )
    } else if (hasil.galat) {
        daftar = (
            <div className="space-y-2 p-2">
                <p role="alert" className="text-sm text-destructive">{hasil.galat}</p>
                <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={() => setPercobaan((n) => n + 1)}>Coba lagi</Button>
            </div>
        )
    } else if (hasil.data.length === 0) {
        daftar = (
            <p className="py-6 text-center text-sm text-muted-foreground">
                {kueri ? `Tidak ada ${labelJenis} yang cocok.` : `Belum ada ${labelJenis} dalam jangkauan Anda.`}
            </p>
        )
    } else {
        daftar = hasil.data.map((baris) => {
            const ringkas = opsi.ringkas(baris)
            const dokumenIni = kecualikan?.tipe === tipe && kecualikan?.id === baris.id
            const terkunci = hanyaDapatDitautkan && !ringkas.dapatDitautkan
            return (
                <button
                    key={baris.id}
                    type="button"
                    disabled={disabled || dokumenIni || terkunci}
                    onClick={() => onChange({
                        tipe, id: baris.id, nomor: ringkas.nomor, judul: ringkas.judul, jenis: ringkas.jenis,
                        unitKerjaId: baris.unitKerjaId || null,
                    })}
                    className={cn(
                        'flex w-full items-start justify-between gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        dokumenIni || terkunci ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-primary/30 hover:bg-primary/5',
                    )}
                >
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{ringkas.judul || 'Tanpa perihal'}</p>
                        <p className="truncate text-xs text-muted-foreground">No: {ringkas.nomor || '-'}</p>
                    </div>
                    {dokumenIni && <Badge variant="secondary" className="shrink-0">Dokumen sumber</Badge>}
                    {!dokumenIni && terkunci && <Badge variant="secondary" className="shrink-0">Tidak dapat ditautkan</Badge>}
                </button>
            )
        })
    }

    return (
        <div className="grid gap-2">
            <p id={`${idDasar}-judul`} className="text-sm font-medium">{judul}</p>
            <div role="group" aria-labelledby={`${idDasar}-judul`} className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/50 p-1 sm:grid-cols-4">
                {JENIS_DOKUMEN.map((item) => {
                    const Icon = item.icon
                    const aktif = tipe === item.value
                    return (
                        <button
                            key={item.value}
                            type="button"
                            aria-pressed={aktif}
                            disabled={disabled}
                            onClick={() => setTipe(item.value)}
                            className={cn(
                                'flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-all',
                                aktif ? 'bg-card text-foreground shadow' : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                            {item.label}
                        </button>
                    )
                })}
            </div>
            <Label htmlFor={`${idDasar}-cari`} className="sr-only">{judul}: cari {labelJenis}</Label>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                    id={`${idDasar}-cari`}
                    type="search"
                    className="pl-9"
                    placeholder={opsi.petunjuk}
                    maxLength={MAKS_KATA_KUNCI}
                    value={kataKunci}
                    disabled={disabled}
                    onChange={(e) => setKataKunci(e.target.value)}
                />
            </div>
            <div role="group" aria-label={`${judul}: hasil pencarian`} aria-busy={memuat} className="max-h-56 space-y-2 overflow-y-auto">
                {daftar}
            </div>
            {!memuat && !hasil.galat && hasil.total > hasil.data.length && (
                <p className="text-xs text-muted-foreground">
                    Menampilkan {hasil.data.length} dari {hasil.total} dokumen terbaru. Persempit kata kunci untuk menemukan dokumen lain.
                </p>
            )}
        </div>
    )
}

export default PilihDokumen
