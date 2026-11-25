import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowLeftRight, Box, CheckCircle2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'
import { alamatPeminjaman } from '@/lib/peminjaman-arsip'
import archiveLendingService from '@/services/archive-lending.service'

// Halaman Peminjaman hanya terbuka bagi peran ini (lihat rute /archive-lending).
const PERAN_MENU_PEMINJAMAN = ['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen']
const KELAS_TAUTAN = 'inline-block text-sm font-medium text-indigo-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-indigo-300'

function tanggal(nilai) {
    if (!nilai) return '-'
    try {
        return format(parseISO(nilai), 'd MMM yyyy', { locale: localeId })
    } catch {
        return nilai
    }
}

function namaBoks(lokasi) {
    if (!lokasi) return ''
    return [lokasi.code, lokasi.name].filter(Boolean).join(' — ')
}

function Rincian({ label, lebar = false, children }) {
    return (
        <div className={lebar ? 'col-span-2 min-w-0' : 'min-w-0'}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="break-words text-sm font-medium text-foreground">{children}</dd>
        </div>
    )
}

function PinjamanBerjalan({ pinjaman, arsip, bolehBukaMenu }) {
    const terlambat = pinjaman.status === 'overdue'
    const perBoks = pinjaman.lendingType === 'box'
    return (
        <li className={`space-y-3 rounded-lg border p-3 ${terlambat
            ? 'border-red-200 bg-red-50/60 dark:border-red-800 dark:bg-red-500/10'
            : 'border-blue-200 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-500/10'}`}>
            <div className="flex flex-wrap items-center gap-2">
                {terlambat ? (
                    <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        Terlambat {pinjaman.daysOverdue} hari
                    </Badge>
                ) : (
                    <Badge className="gap-1 border-blue-200 bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-300">
                        <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
                        Dipinjam
                    </Badge>
                )}
                {perBoks && (
                    <Badge variant="outline" className="gap-1">
                        <Box className="h-3 w-3" aria-hidden="true" />
                        Per boks
                    </Badge>
                )}
            </div>
            {perBoks && (
                <p className="break-words text-sm text-foreground">
                    Boks tempat arsip ini disimpan{namaBoks(pinjaman.storageLocation) ? ` (${namaBoks(pinjaman.storageLocation)})` : ''} sedang dipinjam seluruhnya.
                </p>
            )}
            {/* Nama dan unit selebar kartu; dua tanggal berdampingan, muat di layar 360 px. */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Rincian label="Peminjam" lebar>{pinjaman.borrowerName || '-'}</Rincian>
                <Rincian label="Unit/instansi peminjam" lebar>{pinjaman.departmentUnit || '-'}</Rincian>
                <Rincian label="Tanggal pinjam">{tanggal(pinjaman.borrowDate)}</Rincian>
                <Rincian label="Jatuh tempo">
                    <span className={terlambat ? 'text-destructive' : undefined}>{tanggal(pinjaman.dueDate)}</span>
                </Rincian>
            </dl>
            {bolehBukaMenu && (
                <Link
                    className={KELAS_TAUTAN}
                    to={alamatPeminjaman({
                        status: terlambat ? 'overdue' : 'borrowed',
                        unitKerjaId: arsip.unitKerjaId,
                        ...(perBoks ? { storageLocationId: pinjaman.storageLocation?.id } : { arsipId: arsip.id }),
                    })}
                >
                    {perBoks ? 'Buka peminjaman boks ini' : 'Buka di menu Peminjaman'}
                </Link>
            )}
        </li>
    )
}

/**
 * Kartu baca-saja di halaman detail arsip: siapa yang sedang meminjam arsip
 * (atau boks tempatnya disimpan) dan riwayat peminjaman arsip itu.
 *
 * Server menjawab `readable: false` bila akun boleh membuka arsip (misalnya
 * lewat izin akses) tetapi kelas arsipnya di atas plafon daftar Peminjaman.
 * Kartu lalu hanya menyebut statusnya; tidak ada toast untuk galat muat.
 */
export function KartuPeminjamanArsip({ arsip }) {
    const { user } = useAuth()
    const arsipId = arsip?.id
    const unitKerjaId = arsip?.unitKerjaId
    const kunci = `${arsipId}:${unitKerjaId}:${arsip?.storageLocationId || ''}:${arsip?.lendingStatus || ''}`
    const [percobaan, setPercobaan] = useState(0)
    const [hasil, setHasil] = useState({ kunci: null, data: null, status: 'memuat' })

    useEffect(() => {
        if (!arsipId || !unitKerjaId) return undefined
        let aktif = true
        archiveLendingService.getHistoryByArsip(arsipId, unitKerjaId)
            .then((data) => {
                if (!aktif) return
                const terbaca = data?.readable === true && Array.isArray(data.active) && Array.isArray(data.history)
                setHasil({ kunci, data: terbaca ? data : null, status: terbaca ? 'siap' : 'tertutup' })
            })
            .catch((err) => {
                if (!aktif) return
                const tertutup = err?.status === 403 || err?.status === 404
                setHasil({ kunci, data: null, status: tertutup ? 'tertutup' : 'gagal' })
            })
        return () => { aktif = false }
    }, [kunci, arsipId, unitKerjaId, percobaan])

    if (!arsipId || !unitKerjaId) return null
    const status = hasil.kunci === kunci ? hasil.status : 'memuat'
    const tercatatDipinjam = arsip.lendingStatus === 'borrowed'
    const bolehBukaMenu = PERAN_MENU_PEMINJAMAN.includes(user?.role)

    let isi
    if (status === 'memuat') {
        isi = <p role="status" className="text-sm text-muted-foreground">Memuat data peminjaman...</p>
    } else if (status === 'gagal') {
        isi = (
            <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Data peminjaman belum dapat dimuat.</p>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        setHasil({ kunci: null, data: null, status: 'memuat' })
                        setPercobaan(nilai => nilai + 1)
                    }}
                >
                    Coba lagi
                </Button>
            </div>
        )
    } else if (status === 'tertutup') {
        isi = (
            <p className="text-sm text-muted-foreground">
                {tercatatDipinjam
                    ? 'Arsip ini tercatat sedang dipinjam. Rincian peminjam tidak ditampilkan untuk akun Anda.'
                    : 'Rincian peminjaman arsip ini tidak ditampilkan untuk akun Anda.'}
            </p>
        )
    } else {
        const { active, history, total } = hasil.data
        isi = (
            <>
                {active.length > 0 ? (
                    <ul className="space-y-3" aria-label="Peminjaman yang sedang berjalan">
                        {active.map(pinjaman => (
                            <PinjamanBerjalan key={pinjaman.id} pinjaman={pinjaman} arsip={arsip} bolehBukaMenu={bolehBukaMenu} />
                        ))}
                    </ul>
                ) : tercatatDipinjam ? (
                    <p className="text-sm text-muted-foreground">
                        Arsip ini tercatat sedang dipinjam, tetapi catatan peminjamannya tidak ditemukan.
                        {bolehBukaMenu ? ' Periksa menu Peminjaman.' : ' Hubungi admin unit kerja.'}
                    </p>
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge className="gap-1 border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            Tersedia
                        </Badge>
                        <span className="text-sm text-muted-foreground">Arsip ini tidak sedang dipinjam.</span>
                    </div>
                )}

                <div className="space-y-2 border-t pt-3">
                    <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Riwayat peminjaman</h3>
                    {history.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Belum ada peminjaman arsip ini yang sudah dikembalikan.</p>
                    ) : (
                        <>
                            <ul className="space-y-2">
                                {history.map(pinjaman => (
                                    <li key={pinjaman.id} className="rounded-lg border bg-muted/20 p-2.5">
                                        <p className="break-words text-sm font-medium text-foreground">{pinjaman.borrowerName || '-'}</p>
                                        {pinjaman.departmentUnit && (
                                            <p className="break-words text-xs text-muted-foreground">{pinjaman.departmentUnit}</p>
                                        )}
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Dipinjam {tanggal(pinjaman.borrowDate)}
                                            {pinjaman.returnDate ? `, kembali ${tanggal(pinjaman.returnDate)}` : ''}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                            <p className="text-xs text-muted-foreground">
                                {total > history.length
                                    ? `Menampilkan ${history.length} peminjaman terakhir dari ${total}.`
                                    : `${total} peminjaman sudah dikembalikan.`}
                            </p>
                        </>
                    )}
                    {bolehBukaMenu && total > 0 && (
                        <Link
                            className={KELAS_TAUTAN}
                            to={alamatPeminjaman({ status: 'returned', arsipId: arsip.id, unitKerjaId: arsip.unitKerjaId })}
                        >
                            Lihat riwayat di menu Peminjaman
                        </Link>
                    )}
                </div>
            </>
        )
    }

    return (
        <Card className="shadow-sm">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <ArrowLeftRight className="h-4 w-4 text-indigo-600" aria-hidden="true" />
                    Peminjaman
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
                {isi}
            </CardContent>
        </Card>
    )
}

export default KartuPeminjamanArsip
