import { omitSuratArchivePreviews } from './surat-archive-selection'

export function buildSuratFormPayload(formData, unitKerjaId, fileUploadsEnabled) {
    return {
        ...omitSuratArchivePreviews(formData),
        unitKerjaId,
        // An unavailable document editor cannot clear an existing server value.
        linkDokumen: fileUploadsEnabled ? formData.linkDokumen : undefined,
    }
}

export const PESAN_LINK_DOKUMEN_TIDAK_VALID = 'Link dokumen harus berupa alamat lengkap, misalnya https://contoh.go.id/berkas'
export const CATATAN_LAMPIRAN_OPSIONAL = 'Link dokumen dan berkas tidak wajib diisi.'
export const PETUNJUK_LAMPIRAN_MENYUSUL = 'Surat dapat disimpan tanpa lampiran; hasil pindai dapat ditambahkan nanti lewat menu Edit Surat.'
// Surat keluar hanya dapat diubah selama masih draf atau ditolak.
export const PETUNJUK_LAMPIRAN_MENYUSUL_KELUAR = 'Surat dapat disimpan tanpa lampiran; hasil pindai dapat ditambahkan lewat menu Edit Surat selama surat masih draf atau ditolak (sebelum diajukan untuk persetujuan).'

/** Link dokumen boleh kosong; bila diisi harus berupa alamat lengkap, sama dengan pemeriksaan server. */
export function linkDokumenError(value) {
    const link = String(value ?? '')
    if (!link) return null
    // new URL, bukan URL.canParse: peramban kantor yang lebih lama belum mengenalnya.
    try {
        new URL(link)
        return null
    } catch {
        return PESAN_LINK_DOKUMEN_TIDAK_VALID
    }
}
