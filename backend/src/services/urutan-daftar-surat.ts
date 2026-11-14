import { asc, desc, sql, type SQL } from 'drizzle-orm';
import type { suratKeluar, suratMasuk } from '../db/schema';
import { URUTAN_DAFTAR_SURAT, type UrutanDaftarSurat } from './urutan-daftar-surat.constants.js';

/**
 * ORDER BY daftar surat. Selalu diakhiri id agar halaman tidak bertukar baris
 * yang nilainya sama; surat tanpa tanggal ditaruh di akhir.
 */
export function urutanDaftarSuratSql(tabel: typeof suratMasuk | typeof suratKeluar, urutan?: UrutanDaftarSurat): SQL[] {
    if (urutan === 'tanggal_terbaru') return [sql`${tabel.tanggalSurat} DESC NULLS LAST`, desc(tabel.createdAt), desc(tabel.id)];
    if (urutan === 'tanggal_terlama') return [sql`${tabel.tanggalSurat} ASC NULLS LAST`, asc(tabel.createdAt), asc(tabel.id)];
    return [desc(tabel.createdAt), desc(tabel.id)];
}

/** Untuk parameter tanpa validasi skema (ekspor): nilai di luar daftar diabaikan. */
export function urutanDaftarSuratDari(nilai: unknown): UrutanDaftarSurat | undefined {
    return (URUTAN_DAFTAR_SURAT as readonly unknown[]).includes(nilai) ? nilai as UrutanDaftarSurat : undefined;
}
