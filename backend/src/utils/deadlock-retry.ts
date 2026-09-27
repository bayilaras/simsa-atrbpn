import { ConflictError } from './errors.js';
import { hasPostgresErrorCode } from './postgres-errors.js';

export const PESAN_KONFLIK_BERSAMAAN = 'Terjadi konflik penyimpanan bersamaan; silakan coba lagi.';

/**
 * G-RETRY: ulangi `run` bila Postgres membatalkan transaksi karena deadlock
 * (40P01) atau kegagalan serialisasi (40001); galat lain diteruskan apa adanya.
 * Kehabisan percobaan menjadi 409 agar klien dapat mencoba lagi.
 *
 * `run` HARUS membuka `db.transaction` sendiri: transaksi yang dibatalkan tidak
 * boleh dipakai ulang, jadi jangan membungkus pekerjaan di dalam `tx` pemanggil.
 * Efek samping di luar basis data (unggah berkas, dsb.) diletakkan di luar `run`.
 */
export async function denganRetryDeadlock<T>(run: () => Promise<T>, percobaan = 3): Promise<T> {
    for (let ke = 1; ; ke += 1) {
        try {
            return await run();
        } catch (error) {
            if (!hasPostgresErrorCode(error, '40P01') && !hasPostgresErrorCode(error, '40001')) throw error;
            if (ke >= percobaan) throw new ConflictError(PESAN_KONFLIK_BERSAMAAN);
        }
    }
}
