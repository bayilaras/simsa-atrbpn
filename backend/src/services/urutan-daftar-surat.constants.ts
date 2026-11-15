/** Urutan daftar surat yang diterima server; nilai lain ditolak validasi. Bawaan: dicatat_terbaru. */
export const URUTAN_DAFTAR_SURAT = ['dicatat_terbaru', 'tanggal_terbaru', 'tanggal_terlama'] as const;
export type UrutanDaftarSurat = (typeof URUTAN_DAFTAR_SURAT)[number];
