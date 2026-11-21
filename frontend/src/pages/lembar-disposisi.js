// Penyusunan isi Lembar Disposisi dari GET /api/distributions/surat/:id.

/** Jumlah baris tujuan yang selalu tercetak; sisanya kosong untuk diisi tangan. */
export const BARIS_KOSONG = 5

const LABEL_STATUS = Object.freeze({
    sent: 'Terkirim',
    received: 'Diterima',
    processed: 'Selesai',
    rejected: 'Ditolak',
})

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

/**
 * Tanggal kalender ditulis apa adanya ("2026-11-03" → "3 November 2026");
 * waktu (ISO lengkap) ditampilkan menurut WIB.
 */
export function formatTanggalCetak(nilai, denganJam = false) {
    if (!nilai) return ''
    const teks = String(nilai)
    const hanyaTanggal = /^(\d{4})-(\d{2})-(\d{2})$/.exec(teks)
    if (hanyaTanggal) {
        const [, tahun, bulan, hari] = hanyaTanggal
        return `${Number(hari)} ${BULAN[Number(bulan) - 1] ?? bulan} ${tahun}`
    }
    const tanggal = new Date(teks)
    if (Number.isNaN(tanggal.getTime())) return teks
    const bagian = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(tanggal).map(part => [part.type, part.value]))
    const hasil = `${Number(bagian.day)} ${BULAN[Number(bagian.month) - 1]} ${bagian.year}`
    return denganJam ? `${hasil} ${bagian.hour}.${bagian.minute} WIB` : hasil
}

function daftarTembusan(ccUnits, namaUnit) {
    let ids = ccUnits
    if (typeof ccUnits === 'string') {
        try { ids = JSON.parse(ccUnits) } catch { ids = [] }
    }
    if (!Array.isArray(ids)) return ''
    return ids.filter(id => typeof id === 'string' && id).map(id => namaUnit.get(id) || id).join(', ')
}

/**
 * Baris tabel "Diteruskan kepada", urut dari disposisi terlama. Baris yang
 * disamarkan server (tanpa unit tujuan) dilewati.
 */
export function barisDisposisi(riwayat, namaUnit = new Map()) {
    return riwayat
        .map(item => ({ distribusi: item?.distribution ?? item, unit: item?.targetUnit }))
        .filter(({ distribusi }) => distribusi && distribusi.id && (distribusi.targetUnitId || distribusi.targetUnit))
        .sort((a, b) => String(a.distribusi.sentAt ?? '').localeCompare(String(b.distribusi.sentAt ?? '')))
        .map(({ distribusi, unit }) => ({
            id: distribusi.id,
            unitTujuan: unit?.name || namaUnit.get(distribusi.targetUnitId) || distribusi.targetUnitId,
            instruksi: typeof distribusi.instruction === 'string' ? distribusi.instruction.trim() : '',
            batasWaktu: formatTanggalCetak(distribusi.batasWaktu) || '-',
            penanggungJawab: distribusi.penanggungJawab === true,
            status: LABEL_STATUS[distribusi.status] || distribusi.status || '-',
            dikirim: formatTanggalCetak(distribusi.sentAt),
            tembusan: daftarTembusan(distribusi.ccUnits, namaUnit),
        }))
}

/** Isian kolom Disposisi dari impor (teks bebas), digabung untuk dicetak. */
export function labelDisposisiSumber(nilai) {
    if (!Array.isArray(nilai)) return ''
    return nilai.filter(label => typeof label === 'string' && label.trim()).map(label => label.trim()).join('; ')
}
