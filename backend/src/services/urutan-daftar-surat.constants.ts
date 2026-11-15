/** Urutan daftar surat yang diterima server; nilai lain ditolak validasi. Bawaan: dicatat_terbaru. */
export const URUTAN_DAFTAR_SURAT = ['dicatat_terbaru', 'tanggal_terbaru', 'tanggal_terlama'] as const;
/** Surat masuk juga dapat diurutkan menurut tanggal diterima. */
export const URUTAN_DAFTAR_SURAT_MASUK = [...URUTAN_DAFTAR_SURAT, 'diterima_terbaru', 'diterima_terlama'] as const;
export type UrutanDaftarSurat = (typeof URUTAN_DAFTAR_SURAT_MASUK)[number];

/** Rentang tanggal daftar surat masuk: menurut tanggal surat (bawaan) atau tanggal diterima. */
export const ACUAN_TANGGAL_SURAT_MASUK = ['surat', 'diterima'] as const;
export type AcuanTanggalSuratMasuk = (typeof ACUAN_TANGGAL_SURAT_MASUK)[number];
