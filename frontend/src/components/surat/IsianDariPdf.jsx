import { useMemo, useState } from 'react'
import { CheckCircle2, FileSearch, Info, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { keadaanUsulan, usulanIsian } from '@/lib/isian-dari-pdf'

const PESAN_TANPA_HASIL = {
    'tanpa-teks': 'Berkas ini tidak memuat teks yang dapat dibaca (biasanya hasil pindai), jadi isian tidak dapat diisi dari berkas. Isi formulir seperti biasa.',
    gagal: 'Isian tidak dapat dibaca dari berkas ini. Isi formulir seperti biasa.',
    kosong: 'Tidak ada isian yang terbaca dari berkas ini. Isi formulir seperti biasa.',
}

const CATATAN_KEADAAN = {
    sama: 'sudah terisi',
    terisi: 'tidak diubah, sudah Anda isi',
}

const Bingkai = ({ children }) => (
    <section
        aria-label="Isi dari berkas PDF"
        className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3"
    >
        {children}
    </section>
)

/**
 * Panel "Isi dari berkas PDF" di atas formulir surat. Sebelum ada berkas ia
 * menawarkan memilih PDF lebih dulu; setelah berkas dipilih ia menampilkan
 * isian yang terbaca dan mengisikannya atas perintah petugas. Isian yang sudah
 * diketik tidak pernah ditimpa, dan sifat surat tidak pernah diisi dari berkas.
 *
 * status dan terbaca berasal dari useIsianDariPdf; peta dari lib/isian-dari-pdf.
 */
export function IsianDariPdf({ status, terbaca, peta, formData, namaBerkas, onPilihBerkas, onIsi, disabled = false }) {
    const usulan = useMemo(() => usulanIsian(peta, terbaca), [peta, terbaca])
    // Jumlah isian yang diisikan untuk hasil baca ini; berkas lain memulai dari awal.
    const [catatan, setCatatan] = useState({ untuk: null, jumlah: 0 })
    const jumlahDiisi = catatan.untuk === terbaca && terbaca ? catatan.jumlah : 0

    if (status === 'diam') {
        return (
            <Bingkai>
                <div className="flex flex-wrap items-center gap-3">
                    <FileSearch className="h-5 w-5 text-primary flex-shrink-0" aria-hidden="true" />
                    <p className="flex-1 min-w-[14rem] text-sm text-foreground">
                        <span className="font-medium">Punya PDF suratnya?</span>{' '}
                        Pilih berkasnya lebih dulu. Nomor, tanggal, perihal, dan isian lain dibaca dari berkas untuk Anda periksa.
                    </p>
                    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onPilihBerkas}>
                        Pilih berkas PDF
                    </Button>
                </div>
            </Bingkai>
        )
    }

    if (status === 'membaca') {
        return (
            <Bingkai>
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Membaca isian dari berkas{namaBerkas ? ` ${namaBerkas}` : ''}…
                </p>
            </Bingkai>
        )
    }

    const tanpaHasil = status === 'siap' && usulan.length === 0 ? 'kosong' : status
    if (PESAN_TANPA_HASIL[tanpaHasil]) {
        return (
            <Bingkai>
                <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Info className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    {PESAN_TANPA_HASIL[tanpaHasil]}
                </p>
            </Bingkai>
        )
    }

    const butir = keadaanUsulan(usulan, formData)
    const dapatDiisi = butir.filter(({ keadaan }) => keadaan === 'kosong')
    const isiFormulir = () => {
        for (const { isian, nilai } of dapatDiisi) onIsi(isian, nilai)
        setCatatan({ untuk: terbaca, jumlah: jumlahDiisi + dapatDiisi.length })
    }

    return (
        <Bingkai>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <FileSearch className="h-4 w-4 text-primary" aria-hidden="true" />
                        Isian terbaca dari berkas
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        Isian yang sudah Anda ketik tidak diubah. Sifat surat tidak diisi dari berkas.
                    </p>
                </div>
                <Button type="button" size="sm" disabled={disabled || dapatDiisi.length === 0} onClick={isiFormulir}>
                    Isi formulir
                </Button>
            </div>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(9rem,auto)_1fr]">
                {butir.map(({ isian, label, tampilan, keadaan }) => (
                    <div key={isian} className="contents">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="min-w-0 break-words text-foreground">
                            {tampilan}
                            {CATATAN_KEADAAN[keadaan] && (
                                <span className="ml-2 text-xs text-muted-foreground">({CATATAN_KEADAAN[keadaan]})</span>
                            )}
                        </dd>
                    </div>
                ))}
            </dl>
            <p role="status" className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                {jumlahDiisi > 0 && (
                    <>
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        {jumlahDiisi} isian diisi dari berkas. Periksa kembali sebelum menyimpan.
                    </>
                )}
            </p>
        </Bingkai>
    )
}
