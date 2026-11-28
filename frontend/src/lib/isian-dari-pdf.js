import { JENIS_NASKAH_DINAS } from '@/lib/jenis-naskah'

/**
 * Isian formulir surat yang dapat diisi dari teks PDF surat. `isian` adalah
 * nama isian di formulir, `dari` nama isian yang dibaca server
 * (POST /api/letter-prefill). Sifat surat dan kelas keamanan sengaja tidak
 * ada: keduanya menentukan siapa yang boleh membuka surat, jadi tetap pilihan
 * petugas yang mencatat.
 */
export const PETA_ISIAN_SURAT_MASUK = Object.freeze([
    { isian: 'jenisSurat', dari: 'jenisSurat', label: 'Jenis Surat' },
    { isian: 'nomorSurat', dari: 'nomorSurat', label: 'Nomor Surat' },
    { isian: 'tanggalSurat', dari: 'tanggalSurat', label: 'Tanggal Surat' },
    { isian: 'perihal', dari: 'perihal', label: 'Perihal' },
    { isian: 'dari', dari: 'pengirim', label: 'Dari (Pengirim)' },
    { isian: 'kepada', dari: 'penerima', label: 'Kepada (Penerima)' },
])

export const PETA_ISIAN_SURAT_KELUAR = Object.freeze([
    { isian: 'naskahDinas', dari: 'jenisSurat', label: 'Naskah Dinas' },
    { isian: 'nomorSurat', dari: 'nomorSurat', label: 'Nomor Surat' },
    { isian: 'tanggalSurat', dari: 'tanggalSurat', label: 'Tanggal Surat' },
    { isian: 'perihal', dari: 'perihal', label: 'Perihal' },
    { isian: 'kepada', dari: 'penerima', label: 'Kepada' },
])

const TANGGAL_ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const FORMAT_TANGGAL = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

// Nilai dari server tetap diperiksa sebelum masuk formulir: jenis harus salah
// satu pilihan formulir, tanggal harus berbentuk tanggal isian (YYYY-MM-DD).
function nilaiSah(dari, nilai) {
    if (typeof nilai !== 'string') return ''
    const teks = nilai.trim()
    if (!teks) return ''
    if (dari === 'jenisSurat') return JENIS_NASKAH_DINAS.includes(teks) ? teks : ''
    if (dari === 'tanggalSurat') return TANGGAL_ISO.test(teks) ? teks : ''
    return teks
}

function tampilan(dari, nilai) {
    if (dari !== 'tanggalSurat') return nilai
    const [, tahun, bulan, hari] = TANGGAL_ISO.exec(nilai)
    return FORMAT_TANGGAL.format(new Date(Date.UTC(Number(tahun), Number(bulan) - 1, Number(hari))))
}

/** Usulan isian dari hasil baca server, hanya yang ada nilainya. */
export function usulanIsian(peta, terbaca) {
    if (!terbaca || typeof terbaca !== 'object') return []
    return peta.flatMap(({ isian, dari, label }) => {
        const nilai = nilaiSah(dari, terbaca[dari])
        return nilai ? [{ isian, label, nilai, tampilan: tampilan(dari, nilai) }] : []
    })
}

/**
 * Keadaan tiap usulan terhadap formulir: 'kosong' (dapat diisi), 'sama'
 * (formulir sudah memuat nilai itu), atau 'terisi' (petugas sudah mengisi
 * nilai lain, yang tidak pernah ditimpa).
 */
export function keadaanUsulan(usulan, formData) {
    return usulan.map((butir) => {
        const sekarang = String(formData?.[butir.isian] ?? '').trim()
        const keadaan = !sekarang ? 'kosong' : sekarang === butir.nilai ? 'sama' : 'terisi'
        return { ...butir, keadaan }
    })
}
