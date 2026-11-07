// Cermin kelasUntukRole dan normalizeSecurityClassification di
// backend/src/services/access/visibility-spec.ts. Server tetap penentu akhir;
// helper ini hanya menyembunyikan pilihan kelas yang pasti ditolak (403
// "Klasifikasi keamanan melebihi kewenangan pengguna").

export const KELAS_KEAMANAN = Object.freeze(['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'])

const KELAS_DIKENAL = new Set(KELAS_KEAMANAN)

// Nilai sifat_surat lama yang menyatakan urgensi/jenis, bukan kerahasiaan.
// Sama dengan BIASA_SIFAT_ALIASES backend.
const SIFAT_BIASA = new Set([
    'biasa',
    'biasa/terbuka',
    'biasa_/_terbuka',
    'terbuka',
    'segera',
    'sangat_segera',
    'amat_segera',
    'kilat',
    'amat_segera/kilat',
    'amat_segera_/_kilat',
    'undangan',
    'penting',
])

const ADMIN_UNIT_ROLES = new Set(['admin_unit', 'admin_dirjen', 'admin_sesditjen'])

export const PESAN_KELAS_TERBATAS_PERAN =
    'Kelas Rahasia dan Sangat Rahasia hanya dapat ditetapkan oleh Super Admin.'

// Rekod Terbatas ke atas hanya dibuka lewat persetujuan akses yang terikat pada
// rekod dan kelasnya, juga bagi unit pencatat dan Super Admin.
export const PESAN_SURAT_MASUK_PERLU_PERSETUJUAN =
    'Surat Terbatas, Rahasia, atau Sangat Rahasia hanya dapat dibuka atau diubah dengan persetujuan akses berjangka, juga oleh pencatatnya. '
    + 'Setelah disimpan, ajukan persetujuan akses untuk membuka surat ini.'

// Catatan pada langkah pratinjau impor surat masuk. Pratinjau (previewRows di
// backend) tidak memeriksa baris; penolakan baru tampil di rincian hasil.
export const CATATAN_KELAS_IMPOR_SURAT_MASUK =
    'Sifat Surat pada surat masuk sekaligus menjadi klasifikasi keamanan; sel kosong atau “-” dicatat sebagai Biasa. '
    + 'Baris Rahasia atau Sangat Rahasia hanya dapat diimpor oleh Super Admin, dan baris surat baru dengan sifat yang tidak dikenal ditolak. '
    + 'Pratinjau hanya menampilkan isi sumber; baris yang ditolak terlihat pada Rincian hasil impor setelah Impor, dan baris lain tetap tersimpan.'

/** Kelas keamanan baku untuk nilai klasifikasiKeamanan atau sifatSurat. */
export function normalisasiKelas(nilai) {
    const trimmed = String(nilai ?? '').trim()
    const base = trimmed === '' ? 'biasa' : trimmed
    const normalized = base.toLowerCase().replace(/[\s-]+/g, '_')
    return SIFAT_BIASA.has(normalized) ? 'biasa' : normalized
}

/** Kelas yang boleh dicatat atau diubah oleh peran ini. */
export function kelasUntukPeran(role) {
    if (role === 'super_admin') return [...KELAS_KEAMANAN]
    if (ADMIN_UNIT_ROLES.has(role)) return ['biasa', 'terbatas']
    if (role === 'staff' || role === 'auditor') return ['biasa']
    return []
}

/** true bila peran boleh menyimpan nilai ini (sifatSurat atau klasifikasiKeamanan). */
export function bolehMemilihKelas(role, nilai) {
    const kelas = normalisasiKelas(nilai)
    return KELAS_DIKENAL.has(kelas) && kelasUntukPeran(role).includes(kelas)
}

/**
 * Saring opsi {value, ...} menurut kewenangan peran. Nilai yang sudah melekat
 * pada rekod tetap ditampilkan agar formulir ubah tidak menghapusnya diam-diam
 * (server tidak menganggap pengiriman ulang kelas yang sama sebagai kenaikan).
 */
export function saringOpsiKelas(options, role, nilaiSaatIni) {
    const kelasSaatIni = nilaiSaatIni === undefined || nilaiSaatIni === null || nilaiSaatIni === ''
        ? null
        : normalisasiKelas(nilaiSaatIni)
    return options.filter(option => bolehMemilihKelas(role, option.value)
        || (kelasSaatIni !== null && normalisasiKelas(option.value) === kelasSaatIni))
}

/** true bila sebagian opsi disembunyikan untuk peran ini (untuk teks bantuan). */
export function adaKelasTersembunyi(options, role) {
    return options.some(option => !bolehMemilihKelas(role, option.value))
}
