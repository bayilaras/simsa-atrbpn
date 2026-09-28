import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { KlasifikasiPicker } from '@/components/KlasifikasiPicker'
import { rangkaianService } from '@/services/rangkaian.service'

export default function TutupMassalDataLama({ onSelesai } = {}) {
    const [ringkasan, setRingkasan] = useState(null)
    const [tahun, setTahun] = useState('')
    const [klasifikasi, setKlasifikasi] = useState({ id: null, kode: '' })
    const [pratinjau, setPratinjau] = useState(null)
    const [pratinjauFilter, setPratinjauFilter] = useState(null)
    const [paham, setPaham] = useState(false)
    const [hasil, setHasil] = useState(null)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    // Menandai setiap dry-run dengan urutan permintaan; respons dari permintaan yang sudah usang
    // (filter berubah sebelum respons tiba) diabaikan agar pratinjau tidak pernah menampilkan
    // hasil untuk filter yang bukan filter yang sedang aktif.
    const requestSeqRef = useRef(0)

    useEffect(() => {
        let aktif = true
        // Promise.resolve().then(...) mengubah TypeError sinkron (mock/layanan lama) menjadi penolakan yang tertangani.
        Promise.resolve()
            .then(() => rangkaianService.getRingkasanDataLama())
            .then(data => { if (aktif) setRingkasan(data) })
            .catch(() => { if (aktif) setRingkasan({ dapatMenutup: false, perTahun: [] }) })
        return () => { aktif = false }
    }, [])

    if (!ringkasan?.dapatMenutup) return null

    const filter = { ...(tahun ? { tahun: Number(tahun) } : {}), ...(klasifikasi.id ? { klasifikasiItemId: klasifikasi.id } : {}) }
    const resetPratinjau = () => {
        requestSeqRef.current += 1
        setPratinjau(null)
        setPratinjauFilter(null)
        setPaham(false)
        setHasil(null)
    }

    const jalankanPratinjau = () => {
        resetPratinjau()
        const seq = requestSeqRef.current
        const filterSnapshot = filter
        setBusy(true)
        setError('')
        rangkaianService.tutupMassalDataLama({ ...filterSnapshot, dryRun: true })
            .then(data => {
                // Abaikan respons usang: filter sudah berubah (resetPratinjau menaikkan requestSeqRef)
                // sejak permintaan ini dikirim.
                if (seq !== requestSeqRef.current) return
                setPratinjau(data)
                setPratinjauFilter(filterSnapshot)
            })
            .catch(err => { if (seq === requestSeqRef.current) setError(err?.message || 'Permintaan gagal.') })
            .finally(() => setBusy(false))
    }

    const jalankanPenerapan = () => {
        setBusy(true)
        setError('')
        // Payload penerapan dibangun dari snapshot filter yang tersimpan bersama pratinjau,
        // bukan dari filter langsung, agar penerapan selalu cocok dengan yang sudah dipratinjau.
        const payload = { ...pratinjauFilter, dryRun: false, konfirmasi: true, expectedCount: pratinjau.jumlah }
        rangkaianService.tutupMassalDataLama(payload)
            .then(data => { setHasil(data); onSelesai?.() })
            .catch(err => setError(err?.message || 'Permintaan gagal.'))
            .finally(() => setBusy(false))
    }

    return (
        <section aria-labelledby="tutup-massal-judul" className="space-y-3 rounded-md border p-3">
            <h3 id="tutup-massal-judul" className="text-sm font-semibold">Tutup massal data lama</h3>
            <p className="text-xs text-muted-foreground">
                Memberkaskan rangkaian data lama berstatus selesai. Unit pengolah memakai nilai tercatat atau unit pencatat;
                klasifikasi memakai klasifikasi berkas/induk atau pilihan di bawah. Maksimal 500 rangkaian per penerapan.
            </p>
            <Label htmlFor="tutup-massal-tahun">Tahun</Label>
            <select id="tutup-massal-tahun" className="w-full rounded border p-2 text-sm" value={tahun} disabled={busy}
                onChange={event => { setTahun(event.target.value); resetPratinjau() }}>
                <option value="">Semua tahun</option>
                {ringkasan.perTahun.map(row => <option key={row.tahun} value={row.tahun}>{row.tahun} ({row.jumlah})</option>)}
            </select>
            <KlasifikasiPicker id="tutup-massal-klasifikasi" label="Klasifikasi untuk rangkaian tanpa klasifikasi" value={klasifikasi.kode}
                disabled={busy}
                onChange={(kode, item) => { setKlasifikasi({ id: item?.id ?? null, kode: kode || '' }); resetPratinjau() }} />
            <Button variant="outline" disabled={busy} onClick={jalankanPratinjau}>Pratinjau</Button>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {pratinjau && !hasil && (
                <div className="space-y-2 text-sm">
                    <p>{pratinjau.jumlah} rangkaian siap diberkaskan; {pratinjau.tanpaKlasifikasi} dilewati karena belum berklasifikasi.</p>
                    {pratinjau.terpotong && <p>Hasil lebih dari 500; ulangi setelah penerapan ini.</p>}
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={paham} onChange={event => setPaham(event.target.checked)} />
                        Saya memahami status diberkaskan tidak dapat dibuka kembali.
                    </label>
                    <Button disabled={busy || !paham || pratinjau.jumlah === 0} onClick={jalankanPenerapan}>
                        {`Tutup massal ${pratinjau.jumlah} rangkaian`}
                    </Button>
                </div>
            )}
            {hasil && <p className="text-sm">{hasil.diterapkan} rangkaian diberkaskan.</p>}
        </section>
    )
}
