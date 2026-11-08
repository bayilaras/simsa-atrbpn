import { useEffect, useState } from 'react'
import { format, isValid, parseISO } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'
import { Loader2, MailMinus, MailPlus, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { pesanGalat } from '@/lib/pesan-galat'
import { cn } from '@/lib/utils'
import dosirService from '@/services/dosir.service'
import { suratMasukService } from '@/services/surat-masuk.service'
import { suratKeluarService } from '@/services/surat-keluar.service'

const JENIS_SURAT = [
    { value: 'masuk', label: 'Surat Masuk', icon: MailPlus, service: suratMasukService, pihak: 'Dari', kolomPihak: 'dari', petunjuk: 'Nomor, perihal, atau pengirim' },
    { value: 'keluar', label: 'Surat Keluar', icon: MailMinus, service: suratKeluarService, pihak: 'Kepada', kolomPihak: 'kepada', petunjuk: 'Nomor, perihal, atau tujuan' },
]
const BATAS_HASIL = 10
// Batas yang sama dengan validasi server (search ≤ 255, notes ≤ 2000).
const MAKS_KATA_KUNCI = 255
const MAKS_CATATAN = 2000

function formatTanggal(value) {
    if (!value) return ''
    const date = parseISO(String(value))
    return isValid(date) ? format(date, 'dd MMM yyyy', { locale: idLocale }) : ''
}

/**
 * Menambahkan surat masuk/keluar ke dosir. Pencarian dibatasi pada daftar surat unit kerja dosir,
 * sama dengan surat yang diterima POST /api/dosir/:id/surat.
 * Isi dialog hanya terpasang selama dialog terbuka, jadi setiap pembukaan mulai dari awal.
 */
export function TambahSuratDosirDialog({ open, onOpenChange, dosir, jenisAwal = 'masuk', onBerhasil, onMuatUlang }) {
    const [menyimpan, setMenyimpan] = useState(false)
    return (
        <Dialog open={open} onOpenChange={(value) => !menyimpan && onOpenChange(value)}>
            <DialogContent className="sm:max-w-[640px]">
                <DialogHeader>
                    <DialogTitle>Tambah Surat ke Dosir</DialogTitle>
                    <DialogDescription>
                        Pilih surat dari unit kerja dosir ini, lalu tambahkan catatan bila perlu.
                    </DialogDescription>
                </DialogHeader>
                <TambahSuratIsi
                    dosir={dosir} jenisAwal={jenisAwal} menyimpan={menyimpan} setMenyimpan={setMenyimpan}
                    onOpenChange={onOpenChange} onBerhasil={onBerhasil} onMuatUlang={onMuatUlang}
                />
            </DialogContent>
        </Dialog>
    )
}

function TambahSuratIsi({ dosir, jenisAwal, menyimpan, setMenyimpan, onOpenChange, onBerhasil, onMuatUlang }) {
    const [jenis, setJenis] = useState(jenisAwal === 'keluar' ? 'keluar' : 'masuk')
    const [kataKunci, setKataKunci] = useState('')
    const [terpilih, setTerpilih] = useState(null)
    const [catatan, setCatatan] = useState('')
    const [galat, setGalat] = useState('')
    const [percobaan, setPercobaan] = useState(0)
    const [hasil, setHasil] = useState({ kunci: null, data: [], total: 0, galat: '' })
    const kueri = useDebouncedValue(kataKunci.trim(), 300)
    const unitKerjaId = dosir.unitKerjaId
    const kunci = `${jenis}|${kueri}|${percobaan}`
    const opsi = JENIS_SURAT.find((item) => item.value === jenis)
    const service = opsi.service
    const sudahAda = new Set(((jenis === 'masuk' ? dosir.suratMasuk : dosir.suratKeluar) || []).map((surat) => surat.id))
    const pilihan = terpilih && !sudahAda.has(terpilih.id) ? terpilih : null
    const memuat = hasil.kunci !== kunci

    useEffect(() => {
        let aktif = true
        service.getAll({ unitKerjaId, search: kueri || undefined, page: 1, limit: BATAS_HASIL })
            .then((response) => {
                if (!aktif) return
                const data = response?.data || []
                setHasil({ kunci, data, total: response?.pagination?.total ?? data.length, galat: '' })
            })
            .catch((err) => {
                if (aktif) setHasil({ kunci, data: [], total: 0, galat: pesanGalat(err, 'Pencarian surat gagal.') })
            })
        return () => { aktif = false }
    }, [kunci, kueri, service, unitKerjaId])

    const pilihJenis = (value) => {
        if (value === jenis) return
        setJenis(value)
        setTerpilih(null)
        setGalat('')
    }

    const tambahkan = async () => {
        if (!pilihan || menyimpan) return
        setMenyimpan(true)
        setGalat('')
        try {
            await dosirService.addSurat(dosir.id, jenis, pilihan.id, catatan.trim())
            setMenyimpan(false)
            onOpenChange(false)
            onBerhasil?.({ jenis, surat: pilihan })
        } catch (err) {
            setMenyimpan(false)
            setGalat(pesanGalat(err, 'Surat belum dapat ditambahkan ke dosir. Silakan coba lagi.'))
            // Surat mungkin sudah tertaut: muat ulang dosir agar tanda "Sudah di dosir" sesuai data terbaru.
            if (err?.status === 409 || err?.mutationOutcomeUnknown) onMuatUlang?.()
        }
    }

    const labelJenis = opsi.label.toLowerCase()
    let daftar
    if (memuat) {
        daftar = (
            <p role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Memuat surat...
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
                {kueri ? `Tidak ada ${labelJenis} yang cocok.` : `Belum ada ${labelJenis} di unit kerja dosir ini.`}
            </p>
        )
    } else {
        daftar = hasil.data.map((surat) => {
            const sudah = sudahAda.has(surat.id)
            const dipilih = pilihan?.id === surat.id
            const tanggal = formatTanggal(surat.tanggalSurat)
            return (
                <button
                    key={surat.id}
                    type="button"
                    aria-pressed={dipilih}
                    disabled={sudah || menyimpan}
                    onClick={() => setTerpilih(surat)}
                    className={cn(
                        'flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        sudah ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-primary/30 hover:bg-primary/5',
                        dipilih ? 'border-primary/40 bg-primary/10' : 'border-border bg-card',
                    )}
                >
                    <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{surat.perihal || 'Tanpa perihal'}</p>
                        <p className="truncate text-sm text-muted-foreground">
                            No: {surat.nomorSurat || '-'} • {opsi.pihak}: {surat[opsi.kolomPihak] || '-'}
                        </p>
                        {tanggal && <p className="text-xs text-muted-foreground">{tanggal}</p>}
                    </div>
                    {sudah && <Badge variant="secondary" className="shrink-0">Sudah di dosir</Badge>}
                </button>
            )
        })
    }

    return (
        <>
            <div className="grid gap-4">
                <div className="grid gap-2">
                    <p id="jenis-surat-dosir" className="text-sm font-medium">Jenis surat</p>
                    <div role="group" aria-labelledby="jenis-surat-dosir" className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/50 p-1">
                        {JENIS_SURAT.map((item) => {
                            const Icon = item.icon
                            const aktif = jenis === item.value
                            return (
                                <button
                                    key={item.value}
                                    type="button"
                                    aria-pressed={aktif}
                                    disabled={menyimpan}
                                    onClick={() => pilihJenis(item.value)}
                                    className={cn(
                                        'flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-all',
                                        aktif ? 'bg-card text-foreground shadow' : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    <Icon className="h-4 w-4" aria-hidden="true" />
                                    {item.label}
                                </button>
                            )
                        })}
                    </div>
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="cari-surat-dosir">Cari {labelJenis}</Label>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                            id="cari-surat-dosir"
                            type="search"
                            className="pl-9"
                            placeholder={opsi.petunjuk}
                            maxLength={MAKS_KATA_KUNCI}
                            value={kataKunci}
                            onChange={(e) => setKataKunci(e.target.value)}
                        />
                    </div>
                    <div role="group" aria-label="Hasil pencarian surat" aria-busy={memuat} className="max-h-72 space-y-2 overflow-y-auto">
                        {daftar}
                    </div>
                    {!memuat && !hasil.galat && hasil.total > hasil.data.length && (
                        <p className="text-xs text-muted-foreground">
                            Menampilkan {hasil.data.length} dari {hasil.total} surat terbaru. Persempit kata kunci untuk menemukan surat lain.
                        </p>
                    )}
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="catatan-surat-dosir">Catatan (opsional)</Label>
                    <Textarea
                        id="catatan-surat-dosir"
                        rows={3}
                        className="resize-none"
                        maxLength={MAKS_CATATAN}
                        value={catatan}
                        disabled={menyimpan}
                        onChange={(e) => setCatatan(e.target.value)}
                    />
                </div>

                {pilihan && (
                    <p className="text-sm text-muted-foreground">
                        Surat dipilih: <span className="font-medium text-foreground">{pilihan.nomorSurat || pilihan.perihal || '-'}</span>
                    </p>
                )}
            </div>
            {galat && <p role="alert" className="text-sm text-destructive">{galat}</p>}
            <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={menyimpan}>Batal</Button>
                <Button type="button" onClick={tambahkan} disabled={!pilihan || menyimpan} className="bg-indigo-600 hover:bg-indigo-700">
                    {menyimpan && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    Tambahkan ke Dosir
                </Button>
            </DialogFooter>
        </>
    )
}

export default TambahSuratDosirDialog
