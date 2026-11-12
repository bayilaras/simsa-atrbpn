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

/** Link dokumen boleh kosong; bila diisi harus berupa alamat lengkap, sama dengan pemeriksaan server. */
export function linkDokumenError(value) {
    const link = String(value ?? '')
    if (!link) return null
    return URL.canParse(link) ? null : PESAN_LINK_DOKUMEN_TIDAK_VALID
}
