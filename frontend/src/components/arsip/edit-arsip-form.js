// Logika formulir Ubah Metadata Arsip. Batas dan aturan mengikuti
// updateArsipSchema (backend/src/validators/schemas.ts) serta
// arsipService.update; server tetap penentu akhir.
import { bolehMemilihKelas, normalisasiKelas, PESAN_KELAS_TERBATAS_PERAN } from '@/lib/kelas-keamanan'
import { pesanGalat } from '@/lib/pesan-galat'

// Opsi dan label sama dengan formulir registrasi (components/ArchiveDialog.jsx).
export const TINGKAT_PERKEMBANGAN_OPTIONS = Object.freeze([
    { value: 'Asli', label: 'Asli' },
    { value: 'Salinan', label: 'Salinan' },
    { value: 'Tembusan', label: 'Tembusan' },
])

export const KLASIFIKASI_KEAMANAN_OPTIONS = Object.freeze([
    { value: 'biasa', label: 'Biasa/Terbuka' },
    { value: 'terbatas', label: 'Terbatas' },
    { value: 'rahasia', label: 'Rahasia' },
    { value: 'sangat_rahasia', label: 'Sangat Rahasia' },
])

export const UNIT_PENGOLAH_OPTIONS = Object.freeze([
    { value: 'Ditjen', label: 'Ditjen' },
    { value: 'SekDitjen', label: 'Sesditjen' },
    { value: 'Dit. BPPT', label: 'Dit. BPPT' },
    { value: 'Dit. PTEP', label: 'Dit. PTEP' },
    { value: 'Dit. KTPP', label: 'Dit. KTPP' },
])

// Nilai media_type yang dikenal skema tabel arsip.
export const MEDIA_OPTIONS = Object.freeze([
    { value: 'kertas', label: 'Kertas' },
    { value: 'foto', label: 'Foto' },
    { value: 'video', label: 'Video' },
    { value: 'audio', label: 'Audio' },
    { value: 'elektronik', label: 'Elektronik' },
    { value: 'lainnya', label: 'Lainnya' },
])

// Teks yang sama dengan formulir surat keluar saat memilih kelas terkendali.
export const PESAN_KELAS_PERLU_PERSETUJUAN =
    'Rekod Terbatas atau lebih tinggi memerlukan persetujuan akses berjangka sebelum dapat ditayangkan atau dikelola.'

export const PESAN_ARSIP_TIDAK_DAPAT_DIUBAH =
    'Arsip ini tidak dapat diubah dengan akun Anda. Arsip mungkin sedang dikunci untuk penyusutan atau legal hold, memerlukan izin kelola, atau sudah tidak tersedia. Muat ulang halaman untuk melihat kondisi terbaru.'

// Isian ringkasan yang juga diterapkan server pada daftar item berkas
// (KOLOM_ITEM_CERMIN di backend services/arsip.service.ts).
export const FIELD_CERMIN_ITEM = Object.freeze([
    'nomorItem',
    'uraianItem',
    'tingkatPerkembangan',
    'tanggalArsip',
    'lokasiFc',
    'lokasiLaci',
    'lokasiFolder',
])

export const PESAN_ITEM_BELUM_TERMUAT =
    'Daftar di tab Item Arsip pada halaman ini mungkin belum menampilkan pembaruan item.'

export const PESAN_REKONSILIASI_DIKUNCI =
    'Rekonsiliasi dikunci karena arsip berada dalam legal hold atau workflow penyusutan.'

// Label mode sama dengan halaman Persetujuan Akses Rekod (RecordAccessGrants.jsx).
const LABEL_MODE_IZIN = Object.freeze({
    view: 'Tayang saja',
    download: 'Tayang dan unduh',
    manage: 'Tayang dan kelola (tanpa unduh)',
})

function formatBerlakuSampai(nilai) {
    if (!nilai) return ''
    const tanggal = new Date(nilai)
    if (Number.isNaN(tanggal.getTime())) return ''
    return tanggal.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

// Permohonan baru ditolak selama grant yang disetujui masih berlaku, dan
// hanya Super Admin yang dapat mencabutnya; saran di bawah mengikuti itu.
function pesanPerluIzinKelola(izinAkses) {
    const mode = LABEL_MODE_IZIN[izinAkses?.mode] || LABEL_MODE_IZIN.view
    const sampai = formatBerlakuSampai(izinAkses?.berlakuSampai)
    return [
        'Arsip berkelas Terbatas atau lebih tinggi hanya dapat diubah dengan persetujuan akses mode "Tayang dan kelola".',
        `Persetujuan Anda saat ini: "${mode}"${sampai ? `, berlaku sampai ${sampai}` : ''}.`,
        'Selama persetujuan itu masih berlaku, permohonan baru akan ditolak. Minta Super Admin mencabutnya atau tunggu sampai masa berlakunya berakhir,',
        'lalu ajukan mode "Tayang dan kelola" di halaman Persetujuan Akses Rekod (menu Persetujuan Akses Arsip).',
    ].join(' ')
}

/** Teks per kode `alasanTerkunci` dari GET /api/arsip/:id (backend services/access/arsip-aksi.ts). */
export const PESAN_ALASAN_TERKUNCI = Object.freeze({
    peran_baca_saja: 'Peran Anda hanya dapat melihat arsip ini.',
    penyusutan_dieksekusi: 'Metadata dikunci karena penyusutan arsip ini sudah dilaksanakan.',
    legal_hold: 'Metadata dikunci karena arsip sedang dalam legal hold.',
    proses_penyusutan: 'Metadata dikunci karena arsip sedang dalam proses penyusutan.',
    perlu_izin_kelola: pesanPerluIzinKelola,
    // Kode khusus frontend: muat ulang setelah kelas dinaikkan ditolak server.
    perlu_persetujuan_akses:
        'Arsip kini berkelas Terbatas atau lebih tinggi dan memerlukan persetujuan akses sebelum dapat dibuka atau diubah kembali.',
    tidak_berwenang: 'Arsip ini tidak dapat diubah dengan akun Anda.',
})

// Kunci karena keadaan rekod; untuk rekonsiliasi tetap memakai kalimat lamanya.
const ALASAN_KEADAAN_REKOD = new Set(['penyusutan_dieksekusi', 'legal_hold', 'proses_penyusutan'])

function teksAlasanTerkunci(kode, izinAkses) {
    const pesan = Object.hasOwn(PESAN_ALASAN_TERKUNCI, kode ?? '')
        ? PESAN_ALASAN_TERKUNCI[kode]
        : PESAN_ALASAN_TERKUNCI.tidak_berwenang
    return typeof pesan === 'function' ? pesan(izinAkses) : pesan
}

// Cadangan bila respons belum membawa aksiDiizinkan (backend lama): cermin
// keadaan rekod dari record-access mutable dan arsipService.update.
function alasanMetadataDikunci(arsip) {
    if (arsip.disposalStatus === 'executed') return PESAN_ALASAN_TERKUNCI.penyusutan_dieksekusi
    if (arsip.legalHold) return PESAN_ALASAN_TERKUNCI.legal_hold
    if (arsip.disposalStatus !== 'active' || arsip.disposalBatchId) return PESAN_ALASAN_TERKUNCI.proses_penyusutan
    return ''
}

function alasanRekonsiliasiDikunci(arsip) {
    return arsip.legalHold || arsip.disposalStatus !== 'active' || arsip.disposalBatchId
        ? PESAN_REKONSILIASI_DIKUNCI
        : ''
}

/**
 * Boleh tidaknya aksi pada halaman detail arsip. Bila server mengirim
 * aksiDiizinkan, server yang menentukan; bila tidak, keadaan rekod saja.
 */
export function statusAksiArsip(arsip = {}, aksi = 'ubah_metadata') {
    if (Array.isArray(arsip.aksiDiizinkan)) {
        const boleh = arsip.aksiDiizinkan.includes(aksi)
        if (boleh) return { boleh, alasan: '' }
        if (aksi === 'rekonsiliasi_aturan' && ALASAN_KEADAAN_REKOD.has(arsip.alasanTerkunci)) {
            return { boleh, alasan: PESAN_REKONSILIASI_DIKUNCI }
        }
        return { boleh, alasan: teksAlasanTerkunci(arsip.alasanTerkunci, arsip.izinAkses) }
    }
    const alasan = aksi === 'rekonsiliasi_aturan' ? alasanRekonsiliasiDikunci(arsip) : alasanMetadataDikunci(arsip)
    return { boleh: !alasan, alasan }
}

export const LABEL_FIELD = Object.freeze({
    nomorBerkas: 'Nomor Berkas',
    unitPengolah: 'Unit Pengolah',
    uraianBerkas: 'Uraian Berkas',
    kurunWaktu: 'Kurun Waktu',
    nomorItem: 'Nomor Item',
    tingkatPerkembangan: 'Tingkat Perkembangan',
    uraianItem: 'Uraian Item',
    tanggalArsip: 'Tanggal Arsip',
    jumlah: 'Jumlah',
    mediaType: 'Media',
    lokasiFc: 'No. Filing Cabinet',
    lokasiLaci: 'No. Laci',
    lokasiFolder: 'No. Folder',
    storageLocationId: 'Lokasi Simpan',
    klasifikasiKeamanan: 'Klasifikasi Keamanan',
    personInCharge: 'Penanggung Jawab',
    keterangan: 'Keterangan',
})

// Urutan field = urutan tampil, dipakai juga untuk memfokuskan galat pertama.
export const FIELD_METADATA = Object.freeze(Object.keys(LABEL_FIELD))

export const BATAS_PANJANG = Object.freeze({
    nomorBerkas: 100,
    uraianBerkas: 2000,
    nomorItem: 100,
    uraianItem: 2000,
    kurunWaktu: 100,
    mediaType: 50,
    lokasiFc: 50,
    lokasiLaci: 50,
    lokasiFolder: 50,
    personInCharge: 255,
    unitPengolah: 255,
    keterangan: 4000,
})

// min(1) di skema, ditambah lokasi fisik yang wajib saat registrasi
// (archive-registration-validation.js). Hanya berlaku bila field diubah:
// rekod lama yang memang kosong tetap dapat dikoreksi di bagian lain.
export const FIELD_WAJIB = Object.freeze(new Set([
    'nomorBerkas',
    'uraianBerkas',
    'mediaType',
    'unitPengolah',
    'lokasiFc',
    'lokasiLaci',
    'lokasiFolder',
]))

const PERINGKAT_KELAS = { biasa: 0, terbatas: 1, rahasia: 2, sangat_rahasia: 3 }
const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/
const POLA_KURUN = /^(\d{4}-\d{2}-\d{2})\s*s\/d\s*(\d{4}-\d{2}-\d{2})$/i

export function peringkatKelas(kelas) {
    const normal = normalisasiKelas(kelas)
    return Object.hasOwn(PERINGKAT_KELAS, normal) ? PERINGKAT_KELAS[normal] : null
}

/** true bila kelas ini hanya dapat dibuka dengan persetujuan akses (Terbatas ke atas). */
export function kelasPerluPersetujuan(kelas) {
    return (peringkatKelas(kelas) ?? 0) >= PERINGKAT_KELAS.terbatas
}

/** Sama dengan dateSchema backend: format YYYY-MM-DD dan tanggal kalender yang ada. */
export function tanggalValid(nilai) {
    if (!POLA_TANGGAL.test(nilai)) return false
    const parsed = new Date(`${nilai}T00:00:00.000Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === nilai
}

const teks = nilai => (nilai === null || nilai === undefined ? '' : String(nilai))

function tanggalDariRekod(nilai) {
    const mentah = teks(nilai).trim()
    return /^\d{4}-\d{2}-\d{2}/.test(mentah) ? mentah.slice(0, 10) : mentah
}

// Nilai lama yang hanya berbeda huruf besar/kecil dipetakan ke opsi baku;
// nilai di luar daftar dipertahankan agar tidak hilang diam-diam.
function cocokkanOpsi(nilai, options) {
    const mentah = teks(nilai).trim()
    if (!mentah) return ''
    const cocok = options.find(option => option.value.toLowerCase() === mentah.toLowerCase())
    return cocok ? cocok.value : mentah
}

/** Opsi Select ditambah nilai rekod yang tidak ada di daftar baku. */
export function opsiDenganNilaiLama(options, nilaiLama) {
    if (!nilaiLama || options.some(option => option.value === nilaiLama)) return [...options]
    return [...options, { value: nilaiLama, label: nilaiLama }]
}

/**
 * Isian awal formulir dari rekod. Kurun waktu hasil registrasi
 * ("YYYY-MM-DD s/d YYYY-MM-DD") atau kosong diisi lewat dua tanggal; format
 * lain (data impor lama) tetap berupa teks bebas.
 */
export function formAwal(arsip = {}) {
    const kurun = teks(arsip.kurunWaktu).trim()
    const cocokKurun = kurun.match(POLA_KURUN)
    const modeKurun = !kurun || cocokKurun ? 'tanggal' : 'teks'
    return {
        modeKurun,
        nomorBerkas: teks(arsip.nomorBerkas),
        uraianBerkas: teks(arsip.uraianBerkas),
        unitPengolah: cocokkanOpsi(arsip.unitPengolah, UNIT_PENGOLAH_OPTIONS),
        kurunDari: cocokKurun ? cocokKurun[1] : '',
        kurunSampai: cocokKurun ? cocokKurun[2] : '',
        kurunTeks: modeKurun === 'teks' ? kurun : '',
        tanggalArsip: tanggalDariRekod(arsip.tanggalArsip),
        nomorItem: teks(arsip.nomorItem),
        uraianItem: teks(arsip.uraianItem),
        tingkatPerkembangan: cocokkanOpsi(arsip.tingkatPerkembangan, TINGKAT_PERKEMBANGAN_OPTIONS),
        jumlah: teks(arsip.jumlah),
        mediaType: cocokkanOpsi(arsip.mediaType, MEDIA_OPTIONS),
        lokasiFc: teks(arsip.lokasiFc),
        lokasiLaci: teks(arsip.lokasiLaci),
        lokasiFolder: teks(arsip.lokasiFolder),
        storageLocationId: teks(arsip.storageLocationId),
        klasifikasiKeamanan: normalisasiKelas(arsip.klasifikasiKeamanan),
        personInCharge: teks(arsip.personInCharge),
        keterangan: teks(arsip.keterangan),
    }
}

function nilaiKurun(form) {
    if (form.modeKurun === 'teks') return form.kurunTeks.trim()
    const dari = form.kurunDari.trim()
    const sampai = form.kurunSampai.trim()
    if (!dari && !sampai) return ''
    // Format yang sama dengan registrasi di ArchiveDialog.
    return `${dari} s/d ${sampai}`
}

/** Nilai yang akan disimpan per field (sudah di-trim). */
export function nilaiMetadata(form) {
    return Object.fromEntries(FIELD_METADATA.map(field => [
        field,
        field === 'kurunWaktu' ? nilaiKurun(form) : teks(form[field]).trim(),
    ]))
}

/** Field yang nilainya berbeda dari isian awal. */
export function fieldBerubah(form, awal) {
    const sekarang = nilaiMetadata(form)
    const semula = nilaiMetadata(awal)
    return FIELD_METADATA.filter(field => sekarang[field] !== semula[field])
}

/** Badan PUT /api/arsip/:id: hanya field yang berubah, tanpa field retensi. */
export function payloadPerubahan(form, awal) {
    const sekarang = nilaiMetadata(form)
    return Object.fromEntries(fieldBerubah(form, awal).map(field => [
        field,
        field === 'jumlah' ? Number(sekarang.jumlah)
            // Pilihan kosong melepas arsip dari lokasi simpannya.
            : field === 'storageLocationId' ? sekarang[field] || null
                : sekarang[field],
    ]))
}

function galatKurun(form) {
    if (form.modeKurun === 'teks') return ''
    const dari = form.kurunDari.trim()
    const sampai = form.kurunSampai.trim()
    if (!dari && !sampai) return ''
    if (!dari || !sampai) return 'Isi tanggal awal dan akhir kurun waktu, atau kosongkan keduanya.'
    if (!tanggalValid(dari) || !tanggalValid(sampai)) return 'Tanggal kurun waktu tidak valid.'
    if (sampai < dari) return 'Tanggal akhir kurun waktu tidak boleh sebelum tanggal awal.'
    return ''
}

/**
 * Galat per field untuk field yang diubah saja; nilai lama yang tidak
 * disentuh tidak dikirim sehingga tidak divalidasi ulang.
 */
export function validasiForm(form, awal, role) {
    const sekarang = nilaiMetadata(form)
    const galat = {}
    for (const field of fieldBerubah(form, awal)) {
        const nilai = sekarang[field]
        const label = LABEL_FIELD[field]
        if (FIELD_WAJIB.has(field) && !nilai) {
            galat[field] = `${label} wajib diisi.`
        } else if (BATAS_PANJANG[field] && nilai.length > BATAS_PANJANG[field]) {
            galat[field] = `${label} maksimal ${BATAS_PANJANG[field].toLocaleString('id-ID')} karakter (saat ini ${nilai.length.toLocaleString('id-ID')}).`
        } else if (field === 'tanggalArsip') {
            if (!nilai) galat[field] = 'Tanggal arsip tidak boleh dikosongkan.'
            else if (!tanggalValid(nilai)) galat[field] = 'Tanggal arsip tidak valid.'
        } else if (field === 'jumlah') {
            const angka = Number(nilai)
            if (!/^\d+$/.test(nilai) || angka < 1 || angka > 10000) {
                galat[field] = 'Jumlah harus bilangan bulat 1 sampai 10.000.'
            }
        } else if (field === 'tingkatPerkembangan') {
            if (!TINGKAT_PERKEMBANGAN_OPTIONS.some(option => option.value === nilai)) {
                galat[field] = 'Pilih Asli, Salinan, atau Tembusan.'
            }
        } else if (field === 'klasifikasiKeamanan') {
            if (!bolehMemilihKelas(role, nilai)) galat[field] = PESAN_KELAS_TERBATAS_PERAN
        } else if (field === 'kurunWaktu') {
            const pesan = galatKurun(form)
            if (pesan) galat[field] = pesan
        }
    }
    return galat
}

/** Pesan untuk galat dari arsipService.update. */
export function pesanGalatUbahArsip(err) {
    const teksGalat = [err?.message, err?.data?.message, err?.data?.error].filter(Boolean).join(' ')
    if (err?.status === 403 && /klasifikasi keamanan melebihi kewenangan/i.test(teksGalat)) {
        return PESAN_KELAS_TERBATAS_PERAN
    }
    if (err?.status === 404) return PESAN_ARSIP_TIDAK_DAPAT_DIUBAH
    const rincian = Array.isArray(err?.details)
        ? err.details.map(detail => detail?.message).filter(Boolean).join('; ')
        : ''
    return rincian || pesanGalat(err, 'Gagal memperbarui metadata arsip.')
}
