import { Link } from 'react-router-dom'
import { ChevronDown, EyeOff, Mail, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { LABEL_JENIS_SURAT, LABEL_RELASI, LABEL_STATUS_RANGKAIAN } from '@/lib/lacak-labels'

const ruteSurat = node => (node.jenis === 'surat_masuk' ? `/surat/masuk/${node.id}` : `/surat/keluar/${node.id}`)

function NodePratinjau({ node }) {
    if (node.masked) {
        return (
            <li data-masked="true" className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{LABEL_JENIS_SURAT[node.jenis] ?? 'Surat'} · {node.unitNama} · {node.label}</span>
                {node.dapatAjukanAkses && <span className="text-xs sm:ml-auto">Ajukan akses dari panel Alur Surat</span>}
            </li>
        )
    }
    const Icon = node.jenis === 'surat_masuk' ? Mail : Send
    return (
        <li className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {node.relasi && <Badge variant="outline">{LABEL_RELASI[node.relasi] ?? node.relasi}</Badge>}
            <Link to={ruteSurat(node)} className="font-mono text-xs underline-offset-2 hover:underline">{node.nomorSurat || 'Tanpa nomor'}</Link>
            <span className="min-w-0 flex-1 truncate">{node.perihal || 'Tanpa perihal'}</span>
            <span className="text-xs text-muted-foreground">{node.naskah ? `${node.naskah} · ` : ''}{node.unitNama} · {node.tahun}</span>
        </li>
    )
}

export function LacakKelompokCard({ kelompok, terbuka = false, onToggle, children }) {
    const { rangkaian, cocok = [], pratinjau = [], jumlahAnggota = 0, pratinjauTerpotong = false } = kelompok
    const utama = cocok[0]
    const judulId = `lacak-${String(kelompok.kunci).replace(/[^a-zA-Z0-9-]/g, '-')}`
    const sisa = Math.max(0, jumlahAnggota - pratinjau.length)
    // Surat tunggal: tautan detail hanya bila node P3 (mode baca, checkMany) tidak tersamar (FR:35, P3 T4-3).
    const nodeTunggal = rangkaian ? null : pratinjau[0]
    const detailTerbuka = Boolean(utama) && nodeTunggal?.masked === false

    return (
        <Card role="group" aria-labelledby={judulId}>
            <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                        {rangkaian ? (
                            <>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge>{rangkaian.kode}</Badge>
                                    <Badge variant="secondary">{LABEL_STATUS_RANGKAIAN[rangkaian.status] ?? rangkaian.status}</Badge>
                                    <span className="text-xs text-muted-foreground">Tahun {rangkaian.tahun}</span>
                                </div>
                                <h2 id={judulId} className="text-base font-semibold">{rangkaian.judul}</h2>
                            </>
                        ) : (
                            <>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline">Surat tunggal</Badge>
                                    {utama && <span className="text-xs text-muted-foreground">Tahun {utama.tahun}</span>}
                                </div>
                                <h2 id={judulId} className="text-base font-semibold">{utama?.nomorSurat || 'Tanpa nomor'}</h2>
                                {utama?.perihal && <p className="text-sm text-muted-foreground">{utama.perihal}</p>}
                            </>
                        )}
                    </div>
                    {rangkaian ? (
                        <Button type="button" variant="outline" size="sm" aria-expanded={terbuka} onClick={onToggle}>
                            <ChevronDown className={`h-4 w-4 transition-transform ${terbuka ? 'rotate-180' : ''}`} aria-hidden="true" />
                            {terbuka ? 'Tutup rangkaian' : 'Buka rangkaian'}
                        </Button>
                    ) : detailTerbuka ? (
                        <Button asChild variant="outline" size="sm">
                            <Link to={ruteSurat(utama)}>Buka detail surat</Link>
                        </Button>
                    ) : null}
                </div>
                {!rangkaian && nodeTunggal?.masked && (
                    <p data-masked="true" className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                        <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{LABEL_JENIS_SURAT[nodeTunggal.jenis] ?? 'Surat'} · {nodeTunggal.unitNama} · {nodeTunggal.label}</span>
                    </p>
                )}
                {rangkaian && pratinjau.length > 0 && (
                    <ol className="space-y-1.5" aria-label={`Pratinjau ${rangkaian ? rangkaian.kode : 'surat'}`}>
                        {pratinjau.map((node, index) => (
                            <NodePratinjau key={node.anggotaId ?? `${node.jenis}-${node.id ?? index}`} node={node} />
                        ))}
                    </ol>
                )}
                {pratinjauTerpotong && sisa > 0 && (
                    <p className="text-xs text-muted-foreground">+{sisa} surat lain dalam rangkaian ini</p>
                )}
                {terbuka && children}
            </CardContent>
        </Card>
    )
}
