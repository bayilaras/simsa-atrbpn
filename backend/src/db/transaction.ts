import type { db } from '../config/database';

/** Transaksi Drizzle aplikasi; untuk layanan yang menerima `tx` dari pemanggil. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
