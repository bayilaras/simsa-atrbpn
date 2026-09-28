// Alias sifat/urgensi lama yang BUKAN kelas kerahasiaan. Harus identik dengan
// BIASA_SIFAT_ALIASES backend/src/services/access/visibility-spec.ts:13-21.
const BIASA_ALIAS = new Set(['biasa', 'biasa/terbuka', 'terbuka', 'segera', 'sangat_segera', 'undangan', 'penting'])
const TERKENDALI = new Set(['terbatas', 'rahasia', 'sangat_rahasia'])

export const JENIS_RELASI_LABEL = Object.freeze({
    balasan: 'Balasan',
    tindak_lanjut: 'Tindak lanjut',
    menjelaskan: 'Menjelaskan',
    merujuk: 'Merujuk',
})

/** Cermin normalizeSecurityClassification backend (visibility-spec.ts:40-59): trim, lower, `[\s-]+`→`_`, alias→biasa. */
export function normalisasiSifat(v) {
    const s = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
    return BIASA_ALIAS.has(s) || s === '' ? 'biasa' : s
}

/** Hanya terbatas/rahasia/sangat_rahasia terkendali -- nilai tak dikenal dianggap biasa, sama seperti server. */
export function isSifatTerkendali(v) {
    return TERKENDALI.has(normalisasiSifat(v))
}

/** Pesan 409 persis dari server selama RANGKAIAN_AJUKAN_AKSES mati (Global Constraints). */
export const PESAN_TERKENDALI = 'Surat terkendali belum dapat didisposisikan; tangani di unit pencatat atau aktifkan jalur akses disposisi'

/** Gabungkan chip instruksi ke catatan yang sudah diketik, satu per baris. */
export function appendInstruksi(prev, teks) {
    const p = (prev ?? '').trimEnd()
    return p ? `${p}\n${teks}` : teks
}

export function isKeputusan(naskahDinas) {
    return /keputusan/i.test(naskahDinas || '')
}

/** location.state untuk /surat/keluar/tambah dari menu Tindak Lanjut / Kotak Disposisi. */
export function buildTindakLanjutState(jenis, surat, aksi) {
    const disposisiHidup = surat.distribusiUnitSaya && ['sent', 'received'].includes(surat.distribusiUnitSaya.status)
    const referensi = {
        jenis,
        suratId: surat.id,
        nomorSurat: surat.nomorSurat || null,
        perihal: surat.perihal || null,
        rangkaianKode: surat.rangkaian?.kode || null,
        ...(disposisiHidup ? { distribusiId: surat.distribusiUnitSaya.id } : {}),
    }
    if (aksi === 'buat_nd_penjelas') {
        return {
            tindakLanjut: { ...referensi, jenisRelasi: 'menjelaskan', terkunci: true },
            preset: { naskahDinas: 'Nota Dinas', perihal: `Penjelasan Keputusan Nomor ${surat.nomorSurat || ''}`.trim() },
        }
    }
    if (aksi === 'buat_nota_dinas') {
        return {
            tindakLanjut: { ...referensi, jenisRelasi: 'tindak_lanjut', terkunci: true },
            preset: { naskahDinas: 'Nota Dinas', perihal: `Tindak lanjut: ${surat.perihal || ''}` },
        }
    }
    return {
        tindakLanjut: { ...referensi, jenisRelasi: jenis === 'surat_masuk' ? 'balasan' : 'tindak_lanjut', terkunci: true },
        preset: { perihal: `Balasan: ${surat.perihal || ''}`, kepada: jenis === 'surat_masuk' ? (surat.dari || '') : (surat.kepada || '') },
    }
}

/** Bentuk payload `tindakLanjut` untuk POST /api/surat-keluar. */
export function toTindakLanjutPayload(referensi) {
    if (!referensi) return undefined
    const { jenis, suratId, jenisRelasi, distribusiId } = referensi
    return distribusiId ? { jenis, suratId, jenisRelasi, distribusiId } : { jenis, suratId, jenisRelasi }
}

/**
 * Tanggal hari ini (YYYY-MM-DD) di Asia/Jakarta — batas bawah input Batas waktu
 * disposisi, selaras batasWaktuSchema server yang menolak tanggal lampau (WIB).
 */
export function hariIniJakarta(now = new Date()) {
    return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
}
