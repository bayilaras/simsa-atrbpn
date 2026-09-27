/* eslint-disable react-refresh/only-export-components -- kontrak Task 11 mewajibkan label status/relasi diekspor bersama panel ini untuk P3-P5 */
import { useEffect, useState } from 'react'
import { GitBranch, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import rangkaianService from '@/services/rangkaian.service'
import { TimelineItem } from '@/components/surat/TimelineItem'

export const STATUS_RANGKAIAN_LABEL = { aktif: 'Aktif', selesai: 'Selesai', diberkaskan: 'Diberkaskan', digabung: 'Digabung' }
export const STATUS_DISPOSISI_LABEL = { sent: 'Terkirim', received: 'Diterima', processed: 'Selesai', rejected: 'Ditolak' }
export const JENIS_RELASI_LABEL = { balasan: 'Balasan', tindak_lanjut: 'Tindak lanjut', menjelaskan: 'Menjelaskan', merujuk: 'Merujuk' }
const AKSES_LABEL = { pengawas: 'unit pengawas', peserta: 'peserta rangkaian' }
const DIKECUALIKAN = 'Dikecualikan'

function keItemLinimasa(node, relasiDari) {
    const type = node.jenis === 'surat_masuk' ? 'masuk' : 'keluar'
    if (node.masked) return { type, masked: true, unitNama: node.unitNama }
    const relasi = relasiDari.get(node.anggotaId)
    return {
        type,
        id: node.suratId,
        tanggal: node.tanggalSurat,
        perihal: node.perihal,
        nomorSurat: node.nomorSurat,
        dari: node.dari ?? '-',
        kepada: node.kepada ?? '-',
        unitNama: node.unitNama,
        relasiLabel: relasi ? JENIS_RELASI_LABEL[relasi.jenisRelasi] ?? relasi.jenisRelasi : null,
    }
}

export function AlurSuratPanel({ jenis, suratId, aksesMelalui = 'owner', fallback = null }) {
    const [state, setState] = useState({ loading: true, data: null, error: false, notFound: false })

    useEffect(() => {
        let aktif = true
        async function muat() {
            setState({ loading: true, data: null, error: false, notFound: false })
            try {
                const data = await rangkaianService.getBySurat(jenis, suratId)
                if (aktif) setState({ loading: false, data, error: false, notFound: false })
            } catch (err) {
                if (!aktif) return
                const status = err?.status ?? err?.response?.status
                if (status === 404) setState({ loading: false, data: null, error: false, notFound: true })
                else setState({ loading: false, data: null, error: true, notFound: false })
            }
        }
        muat()
        return () => { aktif = false }
    }, [jenis, suratId])

    if (state.loading) {
        return (
            <Card role="status" aria-busy="true">
                <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Memuat alur surat…
                </CardContent>
            </Card>
        )
    }
    if (state.notFound) {
        return (
            <Card role="status">
                <CardContent className="p-4 text-sm text-muted-foreground">Alur surat tidak tersedia untuk Anda.</CardContent>
            </Card>
        )
    }
    if (state.error) {
        return (
            <Card role="alert">
                <CardContent className="p-4 text-sm text-destructive">Alur surat tidak dapat dimuat.</CardContent>
            </Card>
        )
    }
    if (!state.data) return fallback

    const d = state.data
    const r = d.rangkaian
    const relasiDari = new Map(d.relasi.map((relasi) => [relasi.dariAnggotaId, relasi]))

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <GitBranch className="h-5 w-5" aria-hidden="true" />
                    Alur Surat
                </CardTitle>
                <CardDescription>
                    <span className="font-mono">{r.kode}</span> · {r.judul}
                </CardDescription>
                {aksesMelalui !== 'owner' && (
                    <p role="note" className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                        Dilihat melalui rangkaian {r.kode} sebagai {AKSES_LABEL[aksesMelalui] ?? 'peserta rangkaian'}. Akses baca saja.
                    </p>
                )}
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="outline">{STATUS_RANGKAIAN_LABEL[r.status] ?? r.status}</Badge>
                    <span>{r.unitPencatat.nama} → {r.unitPengolah?.nama ?? 'Unit pengolah belum ditetapkan'}</span>
                </div>

                {d.peserta.length > 0 && (
                    <div className="space-y-2">
                        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Peserta</h4>
                        <ul aria-label="Peserta rangkaian" className="flex flex-wrap gap-2">
                            {d.peserta.map((peserta) => (
                                <li key={peserta.unitKerjaId}><Badge variant="secondary">{peserta.nama}</Badge></li>
                            ))}
                        </ul>
                    </div>
                )}

                {d.disposisi.length > 0 && (
                    <section aria-label="Status tindak lanjut per penerima" className="space-y-2">
                        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status Tindak Lanjut per Penerima</h4>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-muted-foreground">
                                        <th className="py-1 pr-3 font-medium">Unit</th>
                                        <th className="py-1 pr-3 font-medium">Instruksi</th>
                                        <th className="py-1 pr-3 font-medium">Batas waktu</th>
                                        <th className="py-1 pr-3 font-medium">Status</th>
                                        <th className="py-1 font-medium">Penyelesaian</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {d.disposisi.map((row) => (
                                        <tr key={row.id} className="border-t align-top">
                                            <td className="py-2 pr-3">
                                                <span>{row.targetUnit.nama}</span>
                                                {row.penanggungJawab && <Badge variant="outline" className="ml-2">Penanggung jawab</Badge>}
                                            </td>
                                            <td className="py-2 pr-3 whitespace-pre-line">{row.masked ? DIKECUALIKAN : (row.instruction || '-')}</td>
                                            <td className="py-2 pr-3">{row.batasWaktu ?? '-'}</td>
                                            <td className="py-2 pr-3">
                                                {STATUS_DISPOSISI_LABEL[row.status] ?? row.status}
                                                {row.ditutupPengawas ? ' (ditutup pengawas)' : ''}
                                            </td>
                                            <td className="py-2 whitespace-pre-line">
                                                {row.masked
                                                    ? DIKECUALIKAN
                                                    : (row.catatanPenyelesaian || row.rejectionReason || (row.penyelesaianAnggotaId ? 'Surat penyelesaian' : '-'))}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}

                <section aria-label="Linimasa rangkaian" className="space-y-2">
                    <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Linimasa</h4>
                    <div>
                        {d.anggota.map((node, index) => (
                            <TimelineItem key={node.anggotaId} item={keItemLinimasa(node, relasiDari)} isLast={index === d.anggota.length - 1} />
                        ))}
                    </div>
                    {d.truncated && (
                        <p role="status" className="text-sm text-muted-foreground">
                            Rangkaian ini memuat lebih dari 300 surat; hanya 300 pertama yang ditampilkan.
                        </p>
                    )}
                </section>

                {d.rangkaianTerkait.length > 0 && (
                    <section aria-label="Rangkaian terkait" className="space-y-2">
                        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rangkaian terkait</h4>
                        <ul className="space-y-1 text-sm">
                            {d.rangkaianTerkait.map((terkait) => (
                                <li key={terkait.id}>
                                    <span className="font-mono">{terkait.kode}</span>
                                    {' · '}{terkait.hubungan === 'lanjutan_dari' ? 'Lanjutan dari' : 'Dilanjutkan oleh'}
                                    {' · '}{STATUS_RANGKAIAN_LABEL[terkait.status] ?? terkait.status}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {r.diberkaskanAt && (
                    <p className="text-sm text-muted-foreground">
                        Bukti penutupan berkas: {r.kode}, tgl {r.diberkaskanAt.slice(0, 10)}
                    </p>
                )}
            </CardContent>
        </Card>
    )
}

export default AlurSuratPanel
