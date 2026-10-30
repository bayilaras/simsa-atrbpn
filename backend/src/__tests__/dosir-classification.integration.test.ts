import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { createMigratedPglite, insertUser, resetRangkaianFixture, seedUnits, uid, type PenggunaUji } from './helpers/lacak-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    get db() { return holder.db; },
    pool: { query: async () => { throw new Error('pool tidak dipakai dalam uji ini'); } },
}));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        const raw = req.headers['x-uji-pengguna'];
        req.user = raw ? JSON.parse(String(raw)) : undefined;
        next();
    },
}));

let database: PGlite;
let app: express.Express;
const sebagai = (user: PenggunaUji) => ({ 'x-uji-pengguna': JSON.stringify(user) });

const staff = { id: uid(901), email: 'staff@example.test', name: 'Staff BPPT', role: 'staff', unitKerjaId: 'dir_bppt' } satisfies PenggunaUji;
const admin = { id: uid(902), email: 'admin@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' } satisfies PenggunaUji;
const superAdmin = { id: uid(903), email: 'super@example.test', name: 'Super Admin', role: 'super_admin', unitKerjaId: null } satisfies PenggunaUji;

const DOSIR = uid(700);
const SM = {
    biasa: uid(1), terbatas: uid(2), rahasia: uid(3), sangatRahasia: uid(4), terhapus: uid(5),
} as const;
const SK = {
    biasa: uid(11), terbatas: uid(12), nul: uid(13), rahasia: uid(14), sangatRahasia: uid(15), terhapus: uid(16),
    lainUnit: uid(17), rahasiaLepas: uid(18), terbatasLepas: uid(19),
} as const;
const ACAK = uid(999_999);

const terlihat: Record<'staff' | 'admin' | 'superAdmin', { masuk: string[]; keluar: string[] }> = {
    staff: { masuk: [SM.biasa], keluar: [SK.biasa] },
    admin: { masuk: [SM.biasa, SM.terbatas], keluar: [SK.biasa, SK.terbatas, SK.nul] },
    superAdmin: {
        masuk: [SM.biasa, SM.terbatas, SM.rahasia, SM.sangatRahasia],
        keluar: [SK.biasa, SK.terbatas, SK.nul, SK.rahasia, SK.sangatRahasia],
    },
};
const pengguna = { staff, admin, superAdmin };

async function suratMasuk(id: string, n: number, sifat: string, deleted = false) {
    await database.query(
        `INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, tanggal_surat, perihal, sifat_surat, link_dokumen, is_deleted)
         VALUES ($1, 'dir_bppt', $2, 2026, $3, $4, $5, $6, $7, $8)`,
        [id, n, `SM-${n}/2026`, `2026-01-${String(n).padStart(2, '0')}`, `Perihal SM ${sifat} ${n}`, sifat,
            `https://dokumen.example.test/sm-${n}`, deleted],
    );
}

async function suratKeluar(id: string, n: number, klasifikasi: string | null, options: { unit?: string; deleted?: boolean } = {}) {
    await database.query(
        `INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, naskah_dinas, nomor_surat, tanggal_surat, perihal, kepada,
             klasifikasi_keamanan, link_dokumen, approval_status, is_deleted)
         VALUES ($1, $2, $3, 2026, 'Nota Dinas', $4, $5, $6, 'Direktur', $7, $8, 'approved', $9)`,
        [id, options.unit ?? 'dir_bppt', n, `ND-${n}/2026`, `2026-02-${String(n).padStart(2, '0')}`,
            `Perihal SK ${klasifikasi ?? 'null'} ${n}`, klasifikasi, `https://dokumen.example.test/sk-${n}`, options.deleted ?? false],
    );
}

const tautanKeluar = async (suratId: string) =>
    (await database.query('SELECT 1 FROM dosir_surat_keluar WHERE dosir_id = $1 AND surat_keluar_id = $2', [DOSIR, suratId])).rows.length;

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    const { default: dosirRouter } = await import('../routes/dosir.routes');
    app = express();
    app.use(express.json());
    app.use('/api/dosir', dosirRouter);
}, 180_000);
afterAll(async () => { await database?.close(); });

beforeEach(async () => {
    await database.exec('TRUNCATE dosir, audit_log CASCADE');
    await resetRangkaianFixture(database);
    await seedUnits(database, [{ id: 'dir_bppt', name: 'Dit. BPPT' }, { id: 'dir_ptep', name: 'Dit. PTEP' }]);
    for (const user of [staff, admin, superAdmin]) await insertUser(database, user);

    await suratMasuk(SM.biasa, 1, 'Biasa');
    await suratMasuk(SM.terbatas, 2, 'Terbatas');
    await suratMasuk(SM.rahasia, 3, 'Rahasia');
    await suratMasuk(SM.sangatRahasia, 4, 'Sangat Rahasia');
    await suratMasuk(SM.terhapus, 5, 'Biasa', true);
    await suratKeluar(SK.biasa, 11, 'biasa');
    await suratKeluar(SK.terbatas, 12, 'terbatas');
    await suratKeluar(SK.nul, 13, null);
    await suratKeluar(SK.rahasia, 14, 'rahasia');
    await suratKeluar(SK.sangatRahasia, 15, 'sangat_rahasia');
    await suratKeluar(SK.terhapus, 16, 'biasa', { deleted: true });
    await suratKeluar(SK.lainUnit, 17, 'biasa', { unit: 'dir_ptep' });
    await suratKeluar(SK.rahasiaLepas, 18, 'rahasia');
    await suratKeluar(SK.terbatasLepas, 19, 'terbatas');

    await database.query(`INSERT INTO dosir (id, unit_kerja_id, kode, judul) VALUES ($1, 'dir_bppt', 'BPPT-2026-001', 'Perkara uji')`, [DOSIR]);
    for (const id of Object.values(SM)) {
        await database.query('INSERT INTO dosir_surat_masuk (dosir_id, surat_masuk_id) VALUES ($1, $2)', [DOSIR, id]);
    }
    for (const id of [SK.biasa, SK.terbatas, SK.nul, SK.rahasia, SK.sangatRahasia, SK.terhapus, SK.lainUnit]) {
        await database.query(`INSERT INTO dosir_surat_keluar (dosir_id, surat_keluar_id, notes) VALUES ($1, $2, 'Catatan tautan')`, [DOSIR, id]);
    }
});

describe.each(['staff', 'admin', 'superAdmin'] as const)('dosir untuk %s', (peran) => {
    const user = pengguna[peran];
    const harapan = terlihat[peran];

    it('detail dan linimasa hanya memuat surat yang lolos kelas, unit, dan belum dihapus', async () => {
        const detail = await request(app).get(`/api/dosir/${DOSIR}`).set(sebagai(user)).expect(200);
        expect(detail.body.data.suratMasuk.map((s: any) => s.id).sort()).toEqual([...harapan.masuk].sort());
        expect(detail.body.data.suratKeluar.map((s: any) => s.id).sort()).toEqual([...harapan.keluar].sort());

        const timeline = await request(app).get(`/api/dosir/${DOSIR}/timeline`).set(sebagai(user)).expect(200);
        expect(timeline.body.data.filter((s: any) => s.type === 'masuk').map((s: any) => s.id).sort()).toEqual([...harapan.masuk].sort());
        expect(timeline.body.data.filter((s: any) => s.type === 'keluar').map((s: any) => s.id).sort()).toEqual([...harapan.keluar].sort());
    });

    it('hitungan daftar sama dengan jumlah item di detail', async () => {
        const daftar = await request(app).get('/api/dosir?unitKerjaId=dir_bppt').set(sebagai(user)).expect(200);
        expect(daftar.body.data).toHaveLength(1);
        expect(daftar.body.data[0]).toMatchObject({
            id: DOSIR,
            suratMasukCount: harapan.masuk.length,
            suratKeluarCount: harapan.keluar.length,
            totalSurat: harapan.masuk.length + harapan.keluar.length,
        });
    });
});

describe('isi surat tersembunyi tidak terbaca lewat dosir', () => {
    it('admin_unit tidak menerima perihal atau linkDokumen surat rahasia dan yang terhapus', async () => {
        const detail = await request(app).get(`/api/dosir/${DOSIR}`).set(sebagai(admin)).expect(200);
        const timeline = await request(app).get(`/api/dosir/${DOSIR}/timeline`).set(sebagai(admin)).expect(200);
        const teks = JSON.stringify([detail.body, timeline.body]);
        for (const n of [3, 4, 5, 14, 15, 16, 17]) {
            expect(teks).not.toContain(`https://dokumen.example.test/s${n < 10 ? 'm' : 'k'}-${n}`);
        }
        for (const perihal of ['Rahasia 3', 'Sangat Rahasia 4', 'rahasia 14', 'sangat_rahasia 15', 'biasa 16', 'biasa 17']) {
            expect(teks).not.toContain(perihal);
        }
        expect(teks).not.toContain(SK.rahasia);
        expect(teks).not.toContain(SM.terhapus);
    });
});

describe('POST /api/dosir/:id/surat', () => {
    const tautkan = (user: PenggunaUji, suratId: string, type = 'keluar') =>
        request(app).post(`/api/dosir/${DOSIR}/surat`).set(sebagai(user)).send({ type, suratId });

    it('menolak surat rahasia di unit sendiri persis seperti UUID acak tanpa membuat tautan', async () => {
        const acak = await tautkan(admin, ACAK).expect(404);
        const rahasia = await tautkan(admin, SK.rahasiaLepas).expect(404);
        expect(rahasia.body).toEqual(acak.body);
        expect(await tautanKeluar(SK.rahasiaLepas)).toBe(0);
    });

    it('menolak surat yang sudah tertaut tetapi tersembunyi dengan 404, bukan 409', async () => {
        const acak = await tautkan(admin, ACAK).expect(404);
        expect((await tautkan(admin, SK.rahasia).expect(404)).body).toEqual(acak.body);
        expect((await tautkan(admin, SM.sangatRahasia, 'masuk').expect(404)).body).toEqual(acak.body);
    });

    it('menolak surat yang dihapus lunak, juga untuk super_admin', async () => {
        await database.query('DELETE FROM dosir_surat_keluar WHERE surat_keluar_id = $1', [SK.terhapus]);
        await tautkan(superAdmin, SK.terhapus).expect(404);
        expect(await tautanKeluar(SK.terhapus)).toBe(0);
    });

    it('menautkan surat yang terlihat lalu menjawab 409 bila diulang', async () => {
        await tautkan(admin, SK.terbatasLepas).expect(201);
        expect(await tautanKeluar(SK.terbatasLepas)).toBe(1);
        await tautkan(admin, SK.terbatasLepas).expect(409);
        await tautkan(superAdmin, SK.rahasiaLepas).expect(201);
    });
});

describe('DELETE /api/dosir/:id', () => {
    it('mencatat semua tautan yang ikut terhapus, termasuk ke surat yang tidak terlihat penghapus', async () => {
        const response = await request(app).delete(`/api/dosir/${DOSIR}`).set(sebagai(admin)).expect(200);
        expect(JSON.stringify(response.body)).not.toContain(SK.rahasia);
        expect(await tautanKeluar(SK.rahasia)).toBe(0);

        const { rows } = await database.query<{ changes: any }>(
            `SELECT changes FROM audit_log WHERE entity_type = 'dosir' AND entity_id = $1 AND action = 'delete'`, [DOSIR]);
        expect(rows).toHaveLength(1);
        const { masuk, keluar } = rows[0].changes.tautanTerhapus;
        expect(masuk.map((t: any) => t.suratMasukId).sort()).toEqual(Object.values(SM).sort());
        expect(keluar.map((t: any) => t.suratKeluarId).sort())
            .toEqual([SK.biasa, SK.terbatas, SK.nul, SK.rahasia, SK.sangatRahasia, SK.terhapus, SK.lainUnit].sort());
        expect(keluar.find((t: any) => t.suratKeluarId === SK.rahasia)).toMatchObject({ notes: 'Catatan tautan' });
        expect(keluar.every((t: any) => typeof t.addedAt === 'string')).toBe(true);
    });
});

describe('DELETE /api/dosir/:id/surat/:type/:suratId', () => {
    const lepas = (user: PenggunaUji, suratId: string, type = 'keluar') =>
        request(app).delete(`/api/dosir/${DOSIR}/surat/${type}/${suratId}`).set(sebagai(user));

    it('tautan ke surat tersembunyi dijawab seperti tidak tertaut dan barisnya tetap ada', async () => {
        const tidakTertaut = await lepas(admin, SK.terbatasLepas).expect(404);
        const tersembunyi = await lepas(admin, SK.rahasia).expect(404);
        expect(tersembunyi.body).toEqual(tidakTertaut.body);
        expect(await tautanKeluar(SK.rahasia)).toBe(1);
        await lepas(admin, SK.terhapus).expect(404);
        expect(await tautanKeluar(SK.terhapus)).toBe(1);
        await lepas(admin, SM.rahasia, 'masuk').expect(404);
    });

    it('melepas tautan yang terlihat oleh pemanggil', async () => {
        await lepas(admin, SK.nul).expect(200);
        expect(await tautanKeluar(SK.nul)).toBe(0);
        await lepas(superAdmin, SK.rahasia).expect(200);
        expect(await tautanKeluar(SK.rahasia)).toBe(0);
    });
});
