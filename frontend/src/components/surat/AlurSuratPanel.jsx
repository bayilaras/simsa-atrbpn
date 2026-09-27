/* eslint-disable react-refresh/only-export-components -- kontrak Task 11 mewajibkan label status/relasi diekspor bersama panel ini untuk P3-P5 */
import { useEffect, useState } from 'react'
import { GitBranch, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import rangkaianService from '@/services/rangkaian.service'
import { TimelineItem } from '@/components/surat/TimelineItem'
import { JENIS_RELASI_LABEL } from '@/lib/tindak-lanjut'

// Kontrak ekspor P2 dipertahankan; sumber tunggal kini lib/tindak-lanjut.js (Task 19).
export { JENIS_RELASI_LABEL } from '@/lib/tindak-lanjut'

export const STATUS_RANGKAIAN_LABEL = { aktif: 'Aktif', selesai: 'Selesai', diberkaskan: 'Diberkaskan', digabung: 'Digabung' }
export const STATUS_DISPOSISI_LABEL = { sent: 'Terkirim', received: 'Diterima', processed: 'Selesai', rejected: 'Ditolak' }
// 'pengawas' tidak lagi dipetakan di sini -- lihat teks banner khusus di bawah.
const AKSES_LABEL = { peserta: 'peserta rangkaian' }
const DIKECUALIKAN = 'Dikecualikan'

// Kelompokkan relasi per node asal: satu anggota bisa menjadi asal lebih dari
// satu relasi keluar (mis. balasan DAN tindak lanjut ke anggota lain), jadi
// setiap relasinya harus dipertahankan -- bukan hanya yang terakhir diproses.
function relasiPerNodeAsal(relasiList) {
    const map = new Map()
    for (const relasi of relasiList) {
        const list = map.get(relasi.dariAnggotaId)
        if (list) list.push(relasi)
        else map.set(relasi.dariAnggotaId, [relasi])
    }
    return map
}

function keItemLinimasa(node, relasiDari) {
    const type = node.jenis === 'surat_masuk' ? 'masuk' : 'keluar'
    if (node.masked) return { type, masked: true, unitNama: node.unitNama }
    const relasiList = relasiDari.get(node.anggotaId) ?? []
    return {
        type,
        id: node.suratId,
        tanggal: node.tanggalSurat,
        perihal: node.perihal,
        nomorSurat: node.nomorSurat,
        dari: node.dari ?? '-',
        kepada: node.kepada ?? '-',
        unitNama: node.unitNama,
        relasiLabel: relasiList.length > 0
            ? relasiList.map((relasi) => JENIS_RELASI_LABEL[relasi.jenisRelasi] ?? relasi.jenisRelasi)
            : null,
    }
}

export function AlurSuratPanel({ jenis, suratId, aksesMelalui = 'owner', fallback = null, onChanged, muatUlangKe = 0 }) {
    const [state, setState] = useState({ loading: true, data: null, error: false, notFound: false })
    // Kunci reload internal panel: dinaikkan hanya oleh muatUlang (mis. tombol
    // "Coba lagi", atau aksi panel di Task 25), TIDAK oleh render ulang biasa.
    // onChanged HANYA dipanggil dari muatUlang -- bukan dari jalur muat awal --
    // supaya me-refresh parent (yang membongkar panel ini lewat gerbang
    // `if (loading) return <spinner>`) tidak memicu panel memuat ulang lalu
    // memanggil onChanged lagi tanpa henti (F1).
    const [muatKe, setMuatKe] = useState(0)
    const muatUlang = () => {
        setMuatKe((n) => n + 1)
        onChanged?.()
    }

    // muatUlangKe: sinyal reload yang dikendalikan PARENT (bukan panel), untuk
    // aksi di level halaman yang mengubah data rangkaian/disposisi tapi tidak
    // lewat muatUlang panel sendiri -- Terima Disposisi, Arsipkan, Distribusi,
    // persetujuan (N1). Parent menaikkannya hanya setelah aksi tersebut
    // sukses, TIDAK di jalur onChanged/fetchSurat biasa, supaya tidak
    // membentuk loop dengan mekanisme F1 di atas: fetchSurat yang dipanggil
    // dari sini tidak menaikkan muatUlangKe, hanya effect memuat data (yang
    // memang harus jalan lagi) yang bergantung padanya.
    useEffect(() => {
        let aktif = true
        async function muat() {
            setState({ loading: true, data: null, error: false, notFound: false })
            try {
                const data = await rangkaianService.getBySurat(jenis, suratId)
                if (aktif) {
                    setState({ loading: false, data, error: false, notFound: false })
                }
            } catch (err) {
                if (!aktif) return
                const status = err?.status ?? err?.response?.status
                if (status === 404) setState({ loading: false, data: null, error: false, notFound: true })
                else setState({ loading: false, data: null, error: true, notFound: false })
            }
        }
        muat()
        return () => { aktif = false }
    }, [jenis, suratId, muatKe, muatUlangKe])

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
                <CardContent className="p-4 flex items-center justify-between gap-3 text-sm text-destructive">
                    <span>Alur surat tidak dapat dimuat.</span>
                    <Button type="button" variant="outline" size="sm" onClick={muatUlang}>Coba lagi</Button>
                </CardContent>
            </Card>
        )
    }
    if (!state.data) return fallback

    const d = state.data
    const r = d.rangkaian
    const relasiDari = relasiPerNodeAsal(d.relasi)

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
                        {aksesMelalui === 'pengawas'
                            // Jalur pengawas bisa didapat lewat jangkauan rangkaian ATAU
                            // lewat jangkauan record-level atas satu anggota saja (lihat
                            // viaLintas di rangkaian-read.service.ts) -- jangan mengklaim
                            // "melalui rangkaian" di sini, karena itu tidak selalu benar.
                            ? 'Anda melihat surat ini sebagai unit pengawas (hanya baca).'
                            : `Dilihat melalui rangkaian ${r.kode} sebagai ${AKSES_LABEL[aksesMelalui] ?? 'peserta rangkaian'}. Akses baca saja.`}
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
