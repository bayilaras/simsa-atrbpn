import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { GitBranch, Loader2, Search, X } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AlurSuratPanel from '@/components/surat/AlurSuratPanel'
import { LacakKelompokCard } from '@/components/lacak/LacakKelompokCard'
import { BerkasRangkaianTab } from '@/components/lacak/BerkasRangkaianTab'
import { useLacakSearch } from '@/hooks/use-lacak-search'
import { LACAK_MAX_CHARS, LACAK_MIN_CHARS } from '@/lib/lacak-cache'

const TAHUN_SEKARANG = new Date().getFullYear()
const PILIHAN_TAHUN = Array.from({ length: 10 }, (_, index) => String(TAHUN_SEKARANG - index))

export default function LacakSurat() {
    const [searchParams, setSearchParams] = useSearchParams()
    const urlQ = searchParams.get('q') ?? ''
    const rangkaianParam = searchParams.get('rangkaian') ?? ''
    const tab = searchParams.get('tab') === 'berkas' ? 'berkas' : 'lacak'
    const [input, setInput] = useState(urlQ)
    const [urlQTerakhir, setUrlQTerakhir] = useState(urlQ)
    const [tahun, setTahun] = useState('')
    const [ditutupUntuk, setDitutupUntuk] = useState(null)

    // Navigasi luar (Back, tautan GlobalSearch) mengganti ?q=; input mengikutinya tanpa efek.
    if (urlQ !== urlQTerakhir) {
        setUrlQTerakhir(urlQ)
        setInput(urlQ)
    }

    const lacak = useLacakSearch(input, { tahun })
    // Hook mengembalikan data null selama loading (P3 986e7b5): tidak ada kartu basi yang bisa diklik.
    const kelompok = lacak.status === 'success' ? lacak.data?.kelompok ?? [] : []
    const satuRangkaian = kelompok.length === 1 && kelompok[0].rangkaian ? kelompok[0].rangkaian.id : ''
    const otomatis = satuRangkaian && ditutupUntuk !== lacak.q ? satuRangkaian : ''
    const rangkaianTerbuka = rangkaianParam || otomatis

    const ubahParam = ubah => {
        setSearchParams(previous => {
            const next = new URLSearchParams(previous)
            ubah(next)
            return next
        }, { replace: true })
    }

    // ?rangkaian= sengaja dipertahankan saat mengetik supaya panel yang terbuka tidak
    // dipasang ulang (GET /:id + audit view_via_rangkaian) pada setiap kueri (P4-C-2).
    const onInput = value => {
        const qUrl = value.trim() ? value : ''
        setInput(value)
        setUrlQTerakhir(qUrl)
        ubahParam(next => {
            if (qUrl) next.set('q', qUrl)
            else next.delete('q')
        })
    }

    const tutupPanelUrl = () => {
        ubahParam(next => next.delete('rangkaian'))
        setDitutupUntuk(lacak.q)
    }

    const toggle = id => {
        if (rangkaianTerbuka === id) {
            if (rangkaianParam === id) ubahParam(next => next.delete('rangkaian'))
            setDitutupUntuk(lacak.q)
        } else {
            ubahParam(next => next.set('rangkaian', id))
        }
    }

    // Rangkaian dari ?rangkaian= menempati satu <li> ber-key tetap. Slot 1 adalah kartunya bila ada
    // di hasil (ekspansi di tempat), atau kepala "Rangkaian terpilih" selama memuat / bila tidak ada
    // di hasil. Slot 2 adalah panelnya, di luar kartu, sehingga posisi pohonnya tidak pernah berubah
    // dan panel dipasang sekali walau kartu lain datang dan pergi (P4-C-2, spec: ekspansi di tempat).
    const indeksParam = rangkaianParam ? kelompok.findIndex(item => item.rangkaian?.id === rangkaianParam) : -1
    const itemRangkaianParam = item => (
        <li key={`rangkaian:${rangkaianParam}`} className="space-y-2">
            {item ? (
                <LacakKelompokCard kelompok={item} terbuka onToggle={() => toggle(rangkaianParam)} />
            ) : (
                <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">Rangkaian terpilih</h2>
                    <Button type="button" variant="ghost" size="sm" onClick={tutupPanelUrl}>
                        <X className="h-4 w-4" aria-hidden="true" />Tutup panel rangkaian
                    </Button>
                </div>
            )}
            <AlurSuratPanel key={rangkaianParam} rangkaianId={rangkaianParam} />
        </li>
    )

    // Satu larik anak ber-key: React hanya mempertahankan anak ber-key di dalam larik yang sama.
    // Bila kartu ?rangkaian= belum ada di hasil (memuat / tidak cocok), <li>-nya berada paling atas.
    const itemHasil = kelompok.map((item, index) => {
        if (index === indeksParam) return itemRangkaianParam(item)
        const terbuka = Boolean(item.rangkaian) && item.rangkaian.id === rangkaianTerbuka
        return (
            <li key={item.kunci}>
                <LacakKelompokCard kelompok={item} terbuka={terbuka} onToggle={() => toggle(item.rangkaian.id)}>
                    {terbuka && <AlurSuratPanel key={item.rangkaian.id} rangkaianId={item.rangkaian.id} />}
                </LacakKelompokCard>
            </li>
        )
    })
    if (rangkaianParam && indeksParam === -1) itemHasil.unshift(itemRangkaianParam(null))

    const ubahTab = value => ubahParam(next => {
        if (value === 'berkas') next.set('tab', 'berkas')
        else next.delete('tab')
    })

    return (
        <div className="space-y-5">
            <PageHeader
                icon={GitBranch}
                title="Lacak Surat"
                description="Telusuri surat masuk dan keluar beserta rangkaian tindak lanjutnya dalam satu pencarian."
            />
            <Tabs value={tab} onValueChange={ubahTab}>
                <TabsList>
                    <TabsTrigger value="lacak">Lacak</TabsTrigger>
                    <TabsTrigger value="berkas">Berkas Rangkaian</TabsTrigger>
                </TabsList>

                <TabsContent value="lacak" className="space-y-4">
                    <form role="search" aria-label="Lacak surat" onSubmit={event => event.preventDefault()} className="flex flex-col gap-2 sm:flex-row">
                        <div className="relative flex-1">
                            <label htmlFor="lacak-q" className="sr-only">Nomor surat atau perihal</label>
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                            <Input
                                id="lacak-q"
                                type="search"
                                value={input}
                                onChange={event => onInput(event.target.value)}
                                placeholder="Nomor surat (mis. B-12/PTPP.1/IX/2024) atau kata dalam perihal"
                                aria-describedby="lacak-bantuan"
                                aria-busy={lacak.status === 'loading'}
                                className="h-12 pl-10 text-base"
                            />
                        </div>
                        <label htmlFor="lacak-tahun" className="sr-only">Tahun</label>
                        <select id="lacak-tahun" value={tahun} onChange={event => setTahun(event.target.value)} className="h-12 rounded-md border bg-background px-3 text-sm">
                            <option value="">Semua tahun</option>
                            {PILIHAN_TAHUN.map(value => <option key={value} value={value}>{value}</option>)}
                        </select>
                    </form>
                    <p id="lacak-bantuan" className="text-sm text-muted-foreground">
                        Ketik minimal {LACAK_MIN_CHARS} karakter. Hasil dikelompokkan per rangkaian; surat yang tidak boleh Anda baca tampil sebagai “Dikecualikan”.
                    </p>

                    {lacak.status === 'invalid' && (
                        <p role="alert" className="text-sm text-destructive">Kata kunci maksimal {LACAK_MAX_CHARS} karakter.</p>
                    )}
                    {lacak.status === 'loading' && (
                        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Mencari…
                        </p>
                    )}
                    {lacak.status === 'error' && (
                        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 p-4 text-sm">
                            <p className="text-destructive">{lacak.error?.message || 'Pencarian gagal. Periksa koneksi lalu coba lagi.'}</p>
                            <Button type="button" variant="outline" size="sm" onClick={lacak.retry}>Coba lagi</Button>
                        </div>
                    )}
                    {lacak.status === 'success' && kelompok.length === 0 && (
                        <p role="status" className="text-sm text-muted-foreground">
                            Tidak ada surat yang cocok dengan “{lacak.q}” dalam jangkauan Anda.
                        </p>
                    )}
                    {kelompok.length > 0 && <p role="status" className="sr-only">{kelompok.length} hasil ditemukan.</p>}
                    {(rangkaianParam || kelompok.length > 0) && (
                        <ol aria-label="Hasil lacak surat" className="space-y-3">
                            {itemHasil}
                        </ol>
                    )}
                </TabsContent>

                <TabsContent value="berkas">
                    <BerkasRangkaianTab />
                </TabsContent>
            </Tabs>
        </div>
    )
}
