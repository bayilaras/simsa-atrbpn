import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Loader2, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import suratMasukService from '@/services/surat-masuk.service'
import distributionService from '@/services/distribution.service'
import api from '@/services/api'
import { rekamanPerluPersetujuan } from '@/lib/akses-rekaman'
import { labelSifatSuratMasuk } from '@/lib/sifat-surat-masuk'
import { barisDisposisi, BARIS_KOSONG, formatTanggalCetak, labelDisposisiSumber } from './lembar-disposisi'

function Baris({ label, children }) {
    return (
        <tr>
            <th scope="row" className="w-40 border border-black px-2 py-1.5 text-left align-top font-semibold">{label}</th>
            <td className="border border-black px-2 py-1.5 align-top">{children || '-'}</td>
        </tr>
    )
}

/**
 * Lembar Disposisi surat masuk untuk dicetak dan dilampirkan pada surat fisik.
 * Disposisi yang sudah dikirim lewat SIMSA tercetak; ruang kosong disediakan
 * untuk catatan dan paraf pimpinan.
 */
export default function LembarDisposisi() {
    const { id } = useParams()
    const { user } = useAuth()
    const [muatan, setMuatan] = useState({ status: 'memuat' })

    useEffect(() => {
        let aktif = true
        const muat = async () => {
            let surat
            try {
                surat = await suratMasukService.getById(id)
            } catch (error) {
                if (!aktif) return
                const perlu = rekamanPerluPersetujuan(error, 'surat_masuk', id)
                setMuatan({ status: perlu ? 'perlu_akses' : 'gagal' })
                return
            }
            // Riwayat kosong dijawab 404; daftar unit hanya untuk nama.
            const [riwayat, unit] = await Promise.all([
                distributionService.getHistoryBySurat(id).catch(() => []),
                api.get('/api/unit-kerja').then(response => response?.data || []).catch(() => []),
            ])
            if (!aktif) return
            const namaUnit = new Map((Array.isArray(unit) ? unit : []).map(u => [u.id, u.name]))
            setMuatan({ status: 'siap', surat, namaUnit, disposisi: barisDisposisi(Array.isArray(riwayat) ? riwayat : [], namaUnit) })
        }
        void muat()
        return () => { aktif = false }
    }, [id])

    if (muatan.status === 'memuat') {
        return (
            <div role="status" className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-gray-600">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Memuat lembar disposisi…
            </div>
        )
    }
    if (muatan.status !== 'siap') {
        return (
            <div className="mx-auto max-w-lg space-y-3 p-8 text-sm">
                <p role="alert">
                    {muatan.status === 'perlu_akses'
                        ? 'Surat ini memerlukan persetujuan akses sebelum dapat dibuka atau dicetak.'
                        : 'Surat tidak dapat dimuat. Surat mungkin sudah dihapus atau tidak termasuk dalam akses Anda.'}
                </p>
                <Link className="underline" to={`/surat/masuk/${id}`}>Kembali ke detail surat</Link>
            </div>
        )
    }

    const { surat, namaUnit, disposisi } = muatan
    const catatanSumber = labelDisposisiSumber(surat.disposisi)
    const barisIsian = Math.max(0, BARIS_KOSONG - disposisi.length)

    return (
        <div className="lembar-disposisi mx-auto max-w-[210mm] bg-white p-8 text-[13px] leading-snug text-black print:p-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
                <Link className="text-sm underline" to={`/surat/masuk/${surat.id}`}>Kembali ke detail surat</Link>
                <Button type="button" onClick={() => window.print()}>
                    <Printer className="mr-2 h-4 w-4" aria-hidden="true" /> Cetak
                </Button>
            </div>

            <div className="mb-4 border-b-2 border-black pb-2 text-center">
                <p className="text-sm font-semibold uppercase">{namaUnit.get(surat.unitKerjaId) || surat.unitKerjaId}</p>
                <h1 className="mt-1 text-lg font-bold tracking-wide">LEMBAR DISPOSISI</h1>
            </div>

            <table className="mb-4 w-full border-collapse">
                <tbody>
                    <Baris label="No. Agenda">{surat.noUrut != null ? String(surat.noUrut) : ''}</Baris>
                    <Baris label="Tanggal Diterima">{formatTanggalCetak(surat.tanggalDiterima)}</Baris>
                    <Baris label="Nomor Surat">{surat.nomorSurat}</Baris>
                    <Baris label="Tanggal Surat">{formatTanggalCetak(surat.tanggalSurat)}</Baris>
                    <Baris label="Asal Surat">{surat.dari}</Baris>
                    <Baris label="Perihal">{surat.perihal}</Baris>
                    <Baris label="Sifat">{surat.sifatSurat ? labelSifatSuratMasuk(surat.sifatSurat) : ''}</Baris>
                    {catatanSumber && <Baris label="Disposisi (catatan)">{catatanSumber}</Baris>}
                </tbody>
            </table>

            <h2 className="mb-1 font-bold">Diteruskan kepada</h2>
            <table className="mb-4 w-full border-collapse">
                <thead>
                    <tr>
                        <th scope="col" className="w-8 border border-black px-1 py-1">No</th>
                        <th scope="col" className="border border-black px-2 py-1 text-left">Unit tujuan</th>
                        <th scope="col" className="border border-black px-2 py-1 text-left">Instruksi</th>
                        <th scope="col" className="w-24 border border-black px-2 py-1 text-left">Batas waktu</th>
                        <th scope="col" className="w-24 border border-black px-2 py-1 text-left">Status</th>
                    </tr>
                </thead>
                <tbody>
                    {disposisi.map((baris, indeks) => (
                        <tr key={baris.id}>
                            <td className="border border-black px-1 py-1.5 text-center align-top">{indeks + 1}</td>
                            <td className="border border-black px-2 py-1.5 align-top">
                                {baris.unitTujuan}
                                {baris.penanggungJawab && <span className="block text-[11px] italic">Penanggung jawab</span>}
                                {baris.tembusan && <span className="block text-[11px]">Tembusan: {baris.tembusan}</span>}
                            </td>
                            <td className="border border-black px-2 py-1.5 align-top whitespace-pre-line">{baris.instruksi || '-'}</td>
                            <td className="border border-black px-2 py-1.5 align-top">{baris.batasWaktu}</td>
                            <td className="border border-black px-2 py-1.5 align-top">
                                {baris.status}
                                <span className="block text-[11px]">dikirim {baris.dikirim}</span>
                            </td>
                        </tr>
                    ))}
                    {Array.from({ length: barisIsian }, (_, indeks) => (
                        <tr key={`kosong-${indeks}`} aria-hidden="true">
                            <td className="h-9 border border-black px-1 text-center">{disposisi.length + indeks + 1}</td>
                            <td className="border border-black" />
                            <td className="border border-black" />
                            <td className="border border-black" />
                            <td className="border border-black" />
                        </tr>
                    ))}
                </tbody>
            </table>

            <div className="grid grid-cols-3 gap-4">
                <section className="col-span-2 border border-black p-2" aria-label="Catatan pimpinan">
                    <h2 className="font-bold">Catatan / instruksi pimpinan</h2>
                    <div className="mt-2 space-y-5" aria-hidden="true">
                        {Array.from({ length: 5 }, (_, indeks) => <div key={indeks} className="border-b border-dotted border-black" />)}
                    </div>
                </section>
                <section className="border border-black p-2 text-center" aria-label="Paraf">
                    <h2 className="font-bold">Paraf dan tanggal</h2>
                    <div className="h-24" />
                    <p className="border-t border-dotted border-black pt-1 text-[11px]">(.................................)</p>
                </section>
            </div>

            <footer className="mt-4 text-[10px] text-gray-600">
                Dicetak dari SIMSA pada {formatTanggalCetak(new Date().toISOString(), true)}{user?.name ? ` oleh ${user.name}` : ''}.
            </footer>
        </div>
    )
}
