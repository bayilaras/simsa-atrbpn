// Logika formulir Tambah Arsip. Batas mengikuti createArsipManualSchema
// (backend/src/validators/schemas.ts); server tetap penentu akhir.
import { bolehMemilihKelas, PESAN_KELAS_TERBATAS_PERAN } from '@/lib/kelas-keamanan'
import { pesanGalat } from '@/lib/pesan-galat'
import { tanggalValid, TINGKAT_PERKEMBANGAN_OPTIONS } from './edit-arsip-form'

export const JENIS_ARSIP = Object.freeze(['masuk', 'keluar', 'lainnya'])

/** Label jenis arsip untuk tampilan (detail, laporan). */
export const LABEL_JENIS_ARSIP = Object.freeze({ masuk: 'Surat Masuk', keluar: 'Surat Keluar', lainnya: 'Arsip Lainnya' })

export const JENIS_ARSIP_OPTIONS = Object.freeze([
    { value: 'masuk', label: 'Arsip surat masuk' },
    { value: 'keluar', label: 'Arsip surat keluar' },
    { value: 'lainnya', label: 'Arsip lainnya (bukan surat: SK, laporan, berkas kegiatan, dll.)' },
])

export const PESAN_TAMBAH_PERMANEN =
    'Arsip yang sudah disimpan tidak dapat dihapus dari aplikasi. Kesalahan isian dikoreksi lewat Ubah Metadata pada detail arsip.'

// Urutan = urutan tampil, dipakai untuk memfokuskan galat pertama.
export const FIELD_TAMBAH = Object.freeze([
    'jenisArsip', 'nomorBerkas', 'tanggalArsip', 'uraianBerkas', 'kurunWaktu', 'unitPengolah',
    'tingkatPerkembangan', 'mediaType', 'jumlah', 'lokasiFc', 'lokasiLaci', 'lokasiFolder',
    'storageLocationId', 'klasifikasiKeamanan', 'personInCharge', 'keterangan', 'pernyataan',
])

const LABEL = Object.freeze({
    nomorBerkas: 'Nomor Berkas',
    uraianBerkas: 'Uraian Berkas',
    tanggalArsip: 'Tanggal Arsip',
    kurunWaktu: 'Kurun Waktu',
    unitPengolah: 'Unit Pengolah',
    lokasiFc: 'No. Filing Cabinet',
    lokasiLaci: 'No. Laci',
    lokasiFolder: 'No. Folder',
    personInCharge: 'Penanggung Jawab',
    keterangan: 'Keterangan',
})

const WAJIB = ['nomorBerkas', 'uraianBerkas', 'tanggalArsip', 'lokasiFc', 'lokasiLaci', 'lokasiFolder']
const BATAS = Object.freeze({
    nomorBerkas: 100, uraianBerkas: 2000, kurunWaktu: 100, unitPengolah: 255,
    lokasiFc: 50, lokasiLaci: 50, lokasiFolder: 50, personInCharge: 255, keterangan: 4000,
})

export function formAwalTambah(jenisAwal = 'lainnya') {
    return {
        jenisArsip: JENIS_ARSIP.includes(jenisAwal) ? jenisAwal : 'lainnya',
        nomorBerkas: '',
        tanggalArsip: '',
        uraianBerkas: '',
        kurunWaktu: '',
        unitPengolah: '',
        tingkatPerkembangan: '',
        mediaType: 'kertas',
        jumlah: '1',
        lokasiFc: '',
        lokasiLaci: '',
        lokasiFolder: '',
        storageLocationId: '',
        klasifikasiKeamanan: 'biasa',
        personInCharge: '',
        keterangan: '',
        pernyataan: false,
    }
}

const teks = nilai => (nilai === null || nilai === undefined ? '' : String(nilai)).trim()

export function galatTambahArsip(form, role) {
    const galat = {}
    if (!JENIS_ARSIP.includes(form.jenisArsip)) galat.jenisArsip = 'Pilih jenis arsip.'
    for (const field of WAJIB) {
        if (!teks(form[field])) galat[field] = `${LABEL[field]} wajib diisi.`
    }
    for (const [field, batas] of Object.entries(BATAS)) {
        const nilai = teks(form[field])
        if (!galat[field] && nilai.length > batas) {
            galat[field] = `${LABEL[field]} maksimal ${batas.toLocaleString('id-ID')} karakter (saat ini ${nilai.length.toLocaleString('id-ID')}).`
        }
    }
    const tanggal = teks(form.tanggalArsip)
    if (!galat.tanggalArsip && !tanggalValid(tanggal)) galat.tanggalArsip = 'Tanggal arsip tidak valid.'
    const jumlah = teks(form.jumlah)
    if (jumlah && (!/^\d+$/.test(jumlah) || Number(jumlah) < 1 || Number(jumlah) > 10000)) {
        galat.jumlah = 'Jumlah harus bilangan bulat 1 sampai 10.000.'
    }
    if (form.tingkatPerkembangan && !TINGKAT_PERKEMBANGAN_OPTIONS.some(opsi => opsi.value === form.tingkatPerkembangan)) {
        galat.tingkatPerkembangan = 'Pilih Asli, Salinan, atau Tembusan.'
    }
    if (!bolehMemilihKelas(role, form.klasifikasiKeamanan)) galat.klasifikasiKeamanan = PESAN_KELAS_TERBATAS_PERAN
    if (form.pernyataan !== true) galat.pernyataan = 'Centang pernyataan sebelum menyimpan.'
    return galat
}

/** Badan POST /api/arsip/manual tanpa unitKerjaId; isian kosong tidak dikirim. */
export function payloadTambahArsip(form) {
    const hasil = {
        jenisArsip: form.jenisArsip,
        nomorBerkas: teks(form.nomorBerkas),
        uraianBerkas: teks(form.uraianBerkas),
        tanggalArsip: teks(form.tanggalArsip),
        lokasiFc: teks(form.lokasiFc),
        lokasiLaci: teks(form.lokasiLaci),
        lokasiFolder: teks(form.lokasiFolder),
        klasifikasiKeamanan: form.klasifikasiKeamanan || 'biasa',
        jumlah: Number(teks(form.jumlah) || 1),
    }
    for (const field of ['kurunWaktu', 'unitPengolah', 'tingkatPerkembangan', 'mediaType', 'personInCharge', 'keterangan', 'storageLocationId']) {
        const nilai = teks(form[field])
        if (nilai) hasil[field] = nilai
    }
    return hasil
}

export function pesanGalatTambahArsip(err) {
    const rincian = Array.isArray(err?.details)
        ? err.details.map(detail => detail?.message).filter(Boolean).join('; ')
        : ''
    if (err?.status === 403 && /klasifikasi keamanan melebihi kewenangan/i.test([err?.message, err?.data?.error].filter(Boolean).join(' '))) {
        return PESAN_KELAS_TERBATAS_PERAN
    }
    return rincian || pesanGalat(err, 'Arsip gagal disimpan. Coba lagi.')
}
