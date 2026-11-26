import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { ARSIP_TERBATAS, GRANT, PENGGUNA, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    get db() { return holder.db; },
    pool: { query: async () => { throw new Error('pool tidak dipakai dalam uji ini'); } },
}));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        const raw = req.headers['x-uji-pengguna'];
        req.user = raw ? { email: 'uji@example.test', ...JSON.parse(String(raw)) } : undefined;
        next();
    },
}));

// Legal hold mengunci arsip untuk perubahan lain. Menerapkan dan melepasnya
// tetap harus bisa dilakukan lewat rutenya sendiri oleh pengelola arsip itu.
const ARSIP = '6a000000-0000-4000-8000-000000000001';
const ALASAN_TAHAN = 'Penahanan untuk pemeriksaan resmi';
const ALASAN_LEPAS = 'Pemeriksaan selesai, penahanan dilepas';

let database: PGlite;
let app: express.Express;
const sebagai = (user: object) => ({ 'x-uji-pengguna': JSON.stringify(user) });

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { retentionRoutes } = await import('../routes/retention.routes');
    app = express();
    app.use(express.json());
    app.use('/api/retention', retentionRoutes);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
}, 90_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    await seedRangkaianFixture(database);
    await database.exec(`
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, keterangan)
        VALUES ('${ARSIP}','sesditjen','masuk',2026,'biasa','Arsip biasa TU');
    `);
});

const tahan = (user: object, id = ARSIP, unitKerjaId = 'sesditjen') => request(app)
    .put(`/api/retention/${id}/hold`).set(sebagai(user)).send({ unitKerjaId, reason: ALASAN_TAHAN });
const lepas = (user: object, id = ARSIP, unitKerjaId = 'sesditjen') => request(app)
    .put(`/api/retention/${id}/release`).set(sebagai(user)).send({ unitKerjaId, reason: ALASAN_LEPAS });

async function keadaan(id = ARSIP) {
    const { rows } = await database.query<{ legal_hold: boolean; legal_hold_release_reason: string | null }>(
        'SELECT legal_hold, legal_hold_release_reason FROM arsip WHERE id = $1', [id]);
    return rows[0];
}
async function aksiAudit(id = ARSIP) {
    const { rows } = await database.query<{ action: string }>(
        "SELECT action FROM audit_log WHERE entity_type = 'arsip' AND entity_id = $1 ORDER BY created_at, action", [id]);
    return rows.map(row => row.action);
}

describe('PUT /api/retention/:id/hold dan /release', () => {
    it('admin unit pemilik menerapkan legal hold lalu melepasnya', async () => {
        const ditahan = await tahan(PENGGUNA.tu).expect(200);
        expect(ditahan.body.data).toMatchObject({ legalHold: true, legalHoldReason: ALASAN_TAHAN });
        expect(await keadaan()).toMatchObject({ legal_hold: true });

        const dilepas = await lepas(PENGGUNA.tu).expect(200);
        expect(dilepas.body.data).toMatchObject({ legalHold: false, legalHoldReleaseReason: ALASAN_LEPAS });
        expect(await keadaan()).toEqual({ legal_hold: false, legal_hold_release_reason: ALASAN_LEPAS });
        expect(await aksiAudit()).toEqual(['hold', 'release_hold']);
    });

    it('Super Admin melepas legal hold dengan menyebut unit arsipnya', async () => {
        await tahan(PENGGUNA.tu).expect(200);
        await lepas(PENGGUNA.superAdmin).expect(200);
        expect(await keadaan()).toMatchObject({ legal_hold: false });
    });

    it('menjawab 409 dengan pesannya sendiri bila keadaan tidak cocok', async () => {
        const belumDitahan = await lepas(PENGGUNA.tu).expect(409);
        expect(belumDitahan.body.error).toBe('Arsip tidak sedang dalam status legal hold.');

        await tahan(PENGGUNA.tu).expect(200);
        const sudahDitahan = await tahan(PENGGUNA.tu).expect(409);
        expect(sudahDitahan.body.error).toBe('Arsip sudah dalam status legal hold.');
        expect(await aksiAudit()).toEqual(['hold']);
    });

    it('legal hold dapat diterapkan saat penyusutan sedang diusulkan, tetapi tidak setelah dieksekusi', async () => {
        await database.exec(`UPDATE arsip SET disposal_status='proposed_musnah' WHERE id='${ARSIP}'`);
        await tahan(PENGGUNA.tu).expect(200);
        await lepas(PENGGUNA.tu).expect(200);

        await database.exec(`UPDATE arsip SET disposal_status='executed' WHERE id='${ARSIP}'`);
        const dieksekusi = await tahan(PENGGUNA.tu).expect(409);
        expect(dieksekusi.body.error).toBe('Legal hold tidak dapat diterapkan setelah penyusutan selesai dieksekusi.');
    });

    it.each([
        ['admin unit lain dengan unitnya sendiri', PENGGUNA.bppt, 'dir_bppt', 404],
        // Unit yang disebut admin unit diabaikan; yang berlaku unitnya sendiri.
        ['admin unit lain yang menyebut unit pemilik', PENGGUNA.bppt, 'sesditjen', 404],
        ['staff unit pemilik', PENGGUNA.staffSes, 'sesditjen', 403],
        ['auditor unit pemilik', PENGGUNA.auditorSes, 'sesditjen', 403],
    ] as const)('%s tidak dapat menerapkan atau melepas', async (_kasus, user, unit, status) => {
        await tahan(user, ARSIP, unit).expect(status);
        expect(await keadaan()).toMatchObject({ legal_hold: false });

        await tahan(PENGGUNA.tu).expect(200);
        await lepas(user, ARSIP, unit).expect(status);
        expect(await keadaan()).toMatchObject({ legal_hold: true });
        expect(await aksiAudit()).toEqual(['hold']);
    });

    it('arsip Terbatas memerlukan persetujuan kelola, untuk menerapkan maupun melepas', async () => {
        // Fixture: TU memegang persetujuan kelola atas arsip Terbatas ini.
        await tahan(PENGGUNA.tu, ARSIP_TERBATAS).expect(200);

        await database.exec(`UPDATE record_access_grants SET access_mode='view' WHERE id='${GRANT.tuArsip}'`);
        await lepas(PENGGUNA.tu, ARSIP_TERBATAS).expect(404);
        expect(await keadaan(ARSIP_TERBATAS)).toMatchObject({ legal_hold: true });

        await database.exec(`UPDATE record_access_grants SET access_mode='manage' WHERE id='${GRANT.tuArsip}'`);
        await lepas(PENGGUNA.tu, ARSIP_TERBATAS).expect(200);

        await database.exec(`UPDATE record_access_grants SET access_mode='view' WHERE id='${GRANT.tuArsip}'`);
        await tahan(PENGGUNA.tu, ARSIP_TERBATAS).expect(404);
        expect(await keadaan(ARSIP_TERBATAS)).toMatchObject({ legal_hold: false });
    });
});
