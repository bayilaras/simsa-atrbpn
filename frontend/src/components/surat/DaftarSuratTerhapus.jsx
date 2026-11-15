import { useCallback, useState } from 'react'
import { format } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { RotateCcw, Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlasanDialog } from '@/components/surat/AlasanDialog'
import { ResourcePagination } from '@/components/ResourcePagination'
import { usePaginatedResource } from '@/hooks/use-paginated-resource'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useToast } from '@/hooks/use-toast'
import suratTerhapusService from '@/services/surat-terhapus.service'

const JUDUL = { masuk: 'Surat Masuk Terhapus', keluar: 'Surat Keluar Terhapus' }
// Surat masuk memakai nomor agenda; surat keluar memakai nomor urut.
const NOMOR = { masuk: 'nomor agenda dan nomor surat', keluar: 'nomor urut dan nomor surat' }

function waktuHapus(nilai) {
    if (!nilai) return '-'
    const waktu = new Date(nilai)
    return Number.isNaN(waktu.getTime()) ? '-' : format(waktu, 'dd MMM yyyy HH.mm', { locale: localeId })
}

const sebutan = (surat) => surat?.nomorSurat || surat?.perihal || 'tanpa nomor'

/**
 * Daftar surat terhapus untuk Super Admin, dengan tombol Pulihkan. Surat yang
 * dipulihkan kembali ke daftar dengan nomornya semula (lihat NOMOR); bila nomor
 * suratnya juga dipakai surat aktif lain di unit itu, toast memuat peringatan.
 */
export function DaftarSuratTerhapus({ jenis, unitKerjaId, onDipulihkan }) {
    const { toast } = useToast()
    const [cari, setCari] = useState('')
    const cariTunda = useDebouncedValue(cari.trim(), 400)
    const [dipilih, setDipilih] = useState(null)
    const ambil = useCallback(
        ({ page, limit }) => suratTerhapusService.daftar(jenis, { unitKerjaId, search: cariTunda || undefined, page, limit }),
        [jenis, unitKerjaId, cariTunda],
    )
    const daftar = usePaginatedResource(ambil, { queryKey: JSON.stringify([jenis, unitKerjaId, cariTunda]) })
    const idCari = `cari-surat-${jenis}-terhapus`

    const pulihkan = async (alasan) => {
        const hasil = await suratTerhapusService.pulihkan(jenis, dipilih.id, alasan)
        const nomorSama = Array.isArray(hasil?.suratAktifNomorSama) ? hasil.suratAktifNomorSama.length : 0
        const peringatan = nomorSama > 0
            ? ` Nomor surat ini juga dipakai oleh ${nomorSama} surat lain yang masih aktif di unit ini. Periksa apakah surat itu sama.`
            : ''
        toast({ title: 'Surat dipulihkan', description: `Surat ${sebutan(dipilih)} kembali ke daftar dengan nomor semula.${peringatan}` })
        daftar.reload()
        onDipulihkan?.()
    }

    return (
        <Card className="shadow-sm border-border/60">
            <CardHeader className="space-y-4 pb-4">
                <div className="space-y-1">
                    <CardTitle className="text-base">{JUDUL[jenis]}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                        Surat yang dihapus tidak tampil di daftar lain. Surat yang dipulihkan kembali ke daftar dengan {NOMOR[jenis]} semula.
                    </p>
                </div>
                <div className="max-w-md space-y-1.5">
                    <label htmlFor={idCari} className="text-sm font-medium">Cari surat terhapus</label>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input id={idCari} className="pl-9" placeholder="Cari nomor surat atau perihal..." value={cari} onChange={(event) => setCari(event.target.value)} />
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                <Table responsive>
                    <TableHeader className="bg-muted/30">
                        <TableRow className="hover:bg-transparent">
                            <TableHead className="w-[170px]">Nomor Surat</TableHead>
                            <TableHead>Perihal</TableHead>
                            <TableHead className="w-[180px]">Unit Kerja</TableHead>
                            <TableHead className="w-[160px]">Dihapus oleh</TableHead>
                            <TableHead className="w-[150px]">Waktu hapus</TableHead>
                            <TableHead>Alasan hapus</TableHead>
                            <TableHead className="w-[120px] text-right">Aksi</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!daftar.loading && !daftar.error && daftar.rows.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                                    {cariTunda ? 'Tidak ada surat terhapus yang cocok dengan pencarian.' : 'Tidak ada surat terhapus.'}
                                </TableCell>
                            </TableRow>
                        )}
                        {daftar.rows.map((row) => (
                            <TableRow key={row.id}>
                                <TableCell data-label="Nomor Surat">
                                    <span className="rounded-md border bg-background px-2 py-0.5 font-mono text-xs" style={{ overflowWrap: 'anywhere' }}>
                                        {row.nomorSurat || '-'}
                                    </span>
                                </TableCell>
                                <TableCell data-label="Perihal" className="font-medium">{row.perihal || '-'}</TableCell>
                                <TableCell data-label="Unit Kerja" className="text-sm">{row.unitKerjaNama || '-'}</TableCell>
                                <TableCell data-label="Dihapus oleh" className="text-sm">{row.dihapusOleh || 'Tidak tercatat'}</TableCell>
                                <TableCell data-label="Waktu hapus" className="text-sm">{waktuHapus(row.deletedAt)}</TableCell>
                                <TableCell data-label="Alasan hapus" className="text-sm">
                                    {row.alasanHapus || <span className="text-muted-foreground">Tidak dicatat</span>}
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button type="button" variant="outline" size="sm" onClick={() => setDipilih(row)} aria-label={`Pulihkan surat ${sebutan(row)}`}>
                                        <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Pulihkan
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                <ResourcePagination resource={daftar} label="surat terhapus" />
            </CardContent>
            <AlasanDialog
                open={Boolean(dipilih)}
                onOpenChange={(buka) => { if (!buka) setDipilih(null) }}
                title="Pulihkan surat?"
                description={`Surat ${sebutan(dipilih)} akan kembali ke daftar dengan ${NOMOR[jenis]} semula. Pemulihan dicatat di log audit.`}
                label="Alasan pemulihan"
                submitLabel="Pulihkan"
                onSubmit={pulihkan}
            />
        </Card>
    )
}

export default DaftarSuratTerhapus
