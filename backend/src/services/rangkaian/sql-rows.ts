import { sql, type SQL } from 'drizzle-orm';

/** Hasil `tx.execute` node-postgres adalah { rows }, Proxy mock mengembalikan array (= barisDari P2). */
export { barisDari as rowsOf } from '../access/visibility-spec.js';

/**
 * Array dikirim sebagai SATU parameter teks, lalu dipecah di SQL. Ini menghindari
 * ekspansi array Drizzle menjadi daftar parameter dan aman untuk array kosong.
 * Hanya untuk nilai tanpa koma (uuid, "jenis:uuid").
 */
export function uuidArraySql(ids: string[]): SQL {
    return sql`string_to_array(${ids.join(',')}, ',')::uuid[]`;
}

export function textArraySql(values: string[]): SQL {
    return sql`string_to_array(${values.join(',')}, ',')::text[]`;
}
