// backend/src/services/rangkaian-daftar.service.ts
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
    barisDari, cocokUnitRekamanSql, dalamCakupanPengawasSql, jangkauanSql, kecocokanUnitRekaman, resolveKonteksBaca,
} from './access/visibility-spec.js';
import { readRefKey, recordAccessService, type ReadAccessResult, type ReadRef } from './record-access.service.js';
import { judulRangkaianTampil } from './rangkaian-judul.js';
import { tingkatAksesRangkaian } from './rangkaian-read.service.js';

export type DaftarRangkaianFilter = {
    unitPengolahId?: string;
    status?: 'aktif' | 'selesai' | 'diberkaskan';
    asal?: 'surat_masuk' | 'inisiatif' | 'data_lama';
    page: number;
    limit: number;
};
export type PenggunaDaftar = { id: string; role: string; unitKerjaId: string | null; email?: string; name?: string | null };

export type RangkaianRingkas = {
    id: string;
    kode: string;
    status: string;
    asal: string;
    tahun: number;
    judul: string;
    unitPencatat: { id: string; nama: string | null };
    unitPengolah: { id: string; nama: string | null } | null;
    jumlahAnggota: number;
    selesaiAt: string | null;
    diberkaskanAt: string | null;
    /** FR:35: tautan/aksi memakai mode baca — true hanya bila GET /api/rangkaian/:id akan mengembalikan 200. */
    dapatDibuka: boolean;
};

type BarisRangkaian = {
    id: string; kode: string; status: string; asal: string; judul: string; tahun: number;
    unit_pencatat_id: string; unit_pencatat_nama: string | null;
    unit_pengolah_id: string | null; unit_pengolah_nama: string | null;
    selesai_at: string | null; diberkaskan_at: string | null;
    induk_surat_masuk_id: string | null; induk_surat_keluar_id: string | null;
    jumlah_anggota: number;
};

/**
 * Cakupan daftar dirakit dari predikat P2 (satu sumber, §4.3):
 * - pemilik: unit pencatat cocok dengan kecocokan unit rekaman pengguna (super_admin = semua,
 *   staff/auditor = unitnya sendiri, tanpa jangkauan lintas unit — D5);
 * - pengawas: FULL_ADMIN + unit efektif is_unit_pengawas, atas pencatat ditjen/sesditjen/dir_*;
 * - peserta: unit efektif ∈ jangkauan(R) (§4.5; termasuk rangkaian_peserta bila flag data lama menyala).
 */
async function lingkupSql(user: PenggunaDaftar): Promise<SQL> {
    const ctx = await resolveKonteksBaca(user, db);
    const bagian: SQL[] = [cocokUnitRekamanSql(kecocokanUnitRekaman(user), sql.raw('r.unit_pencatat_id'))];
    if (ctx.pengawas) bagian.push(dalamCakupanPengawasSql(sql.raw('r.unit_pencatat_id')));
    if (ctx.unitJangkauan) bagian.push(jangkauanSql(sql.raw('r.id'), ctx.unitJangkauan, ctx.disposisiLamaRead));
    return sql`(${sql.join(bagian, sql` OR `)})`;
}

export const rangkaianDaftarService = {
    async list(user: PenggunaDaftar, filter: DaftarRangkaianFilter) {
        const where: SQL[] = [sql`r.status <> 'digabung'`, await lingkupSql(user)];
        where.push(filter.asal ? sql`r.asal = ${filter.asal}` : sql`r.asal <> 'data_lama'`);
        if (filter.status) where.push(sql`r.status = ${filter.status}`);
        if (filter.unitPengolahId) where.push(sql`r.unit_pengolah_id = ${filter.unitPengolahId}`);
        const kondisi = sql.join(where, sql` AND `);

        // P4-C-9: total dihitung terpisah agar halaman di luar rentang tetap melaporkan total yang benar.
        const [hitung] = barisDari<{ total: number }>(await db.execute(
            sql`SELECT count(*)::int AS total FROM rangkaian_surat r WHERE ${kondisi}`,
        ));
        const total = hitung?.total ?? 0;
        const offset = (filter.page - 1) * filter.limit;

        const result = await db.execute(sql`
            SELECT r.id, r.kode, r.status, r.asal, r.judul, r.tahun,
                   r.unit_pencatat_id, up.name AS unit_pencatat_nama,
                   r.unit_pengolah_id, uo.name AS unit_pengolah_nama,
                   r.selesai_at, r.diberkaskan_at,
                   ai.surat_masuk_id AS induk_surat_masuk_id, ai.surat_keluar_id AS induk_surat_keluar_id,
                   (SELECT count(*)::int FROM rangkaian_anggota a
                        LEFT JOIN surat_masuk xm ON xm.id = a.surat_masuk_id
                        LEFT JOIN surat_keluar xk ON xk.id = a.surat_keluar_id
                    WHERE a.rangkaian_id = r.id AND coalesce(xm.is_deleted, xk.is_deleted) IS NOT TRUE) AS jumlah_anggota
            FROM rangkaian_surat r
            LEFT JOIN unit_kerja up ON up.id = r.unit_pencatat_id
            LEFT JOIN unit_kerja uo ON uo.id = r.unit_pengolah_id
            LEFT JOIN rangkaian_anggota ai ON ai.rangkaian_id = r.id AND ai.peran = 'induk'
            WHERE ${kondisi}
            ORDER BY coalesce(r.diberkaskan_at, r.selesai_at, r.updated_at) DESC, r.id
            LIMIT ${filter.limit} OFFSET ${offset}`);
        const rows = barisDari<BarisRangkaian>(result);

        const indukRef = new Map<string, ReadRef>();
        for (const row of rows) {
            if (row.induk_surat_masuk_id) indukRef.set(row.id, { type: 'surat_masuk', id: row.induk_surat_masuk_id });
            else if (row.induk_surat_keluar_id) indukRef.set(row.id, { type: 'surat_keluar', id: row.induk_surat_keluar_id });
        }
        const akses: Map<string, ReadAccessResult> = indukRef.size
            ? await recordAccessService.checkMany(user, [...indukRef.values()])
            : new Map();
        const indukTerbaca = (rowId: string) => {
            const ref = indukRef.get(rowId);
            const hasil = ref ? akses.get(readRefKey(ref)) : undefined;
            return Boolean(hasil?.allowed) && !hasil?.masked;
        };

        // FR:35: tautan/aksi memakai mode baca — rangkaian yang tercantum (lingkup list) belum tentu dapat dibuka (GET /:id).
        const dapatDibuka = new Map<string, boolean>();
        for (const row of rows) dapatDibuka.set(row.id, (await tingkatAksesRangkaian(user, row.id, db)) !== null);

        const data: RangkaianRingkas[] = rows.map(row => ({
            id: row.id,
            kode: row.kode,
            status: row.status,
            asal: row.asal,
            tahun: row.tahun,
            judul: judulRangkaianTampil(row.kode, row.judul, !indukTerbaca(row.id)),
            unitPencatat: { id: row.unit_pencatat_id, nama: row.unit_pencatat_nama },
            unitPengolah: row.unit_pengolah_id ? { id: row.unit_pengolah_id, nama: row.unit_pengolah_nama } : null,
            jumlahAnggota: row.jumlah_anggota,
            selesaiAt: row.selesai_at,
            diberkaskanAt: row.diberkaskan_at,
            dapatDibuka: dapatDibuka.get(row.id) === true,
        }));
        return {
            data,
            pagination: { page: filter.page, limit: filter.limit, total, totalPages: Math.max(1, Math.ceil(total / filter.limit)) },
            meta: { aksiDiizinkan: [] as string[] },
        };
    },
};
