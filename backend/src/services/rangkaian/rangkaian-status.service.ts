import { sql } from 'drizzle-orm';
import { anggotaMemblokirSql, disposisiTerbukaSql, type Tx } from './deps.js';
import { rowsOf } from './sql-rows.js';

export const rangkaianStatusService = {
    /**
     * Penghalang §8/§9 dengan definisi SAMA dengan fakta P1 `open_disposisi` dan
     * `blocking_anggota` (builder bersama, T12-1) — dipakai Tandai Selesai dan
     * Berkaskan. Pemanggil memegang kunci rangkaian agar hasilnya stabil.
     */
    async hitungPenghalang(tx: Tx, rangkaianId: string): Promise<{ disposisiTerbuka: number; anggotaBlokir: number }> {
        const [row] = rowsOf<{ disposisi_terbuka: number; anggota_blokir: number }>(await tx.execute(sql`
            SELECT ${disposisiTerbukaSql(rangkaianId)} AS disposisi_terbuka, ${anggotaMemblokirSql(rangkaianId)} AS anggota_blokir`));
        return { disposisiTerbuka: row?.disposisi_terbuka ?? 0, anggotaBlokir: row?.anggota_blokir ?? 0 };
    },
};
