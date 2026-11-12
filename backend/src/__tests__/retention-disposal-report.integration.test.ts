import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { createOptionalModuleAccessMiddleware } from '../middlewares/file-storage-access.middleware.js';
import { PENGGUNA, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

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

// Berita acara pemusnahan dari Manajemen Retensi tetap tersedia walau modul
// Penyusutan nonaktif, tetapi keluarannya hanya draf tanpa nomor buatan sistem.
let database: PGlite;
let app: express.Express;
const env: NodeJS.ProcessEnv = {};
const sebagai = (user: object) => ({ 'x-uji-pengguna': JSON.stringify(user) });

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { retentionRoutes } = await import('../routes/retention.routes');
    app = express();
    app.use('/api', createOptionalModuleAccessMiddleware(env));
    app.use(express.json());
    app.use('/api/retention', retentionRoutes);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
}, 90_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => { await seedRangkaianFixture(database); });

describe('POST /api/retention/disposal-report', () => {
    it.each(['false', 'true'])('modul Penyusutan %s: draf tanpa nomor buatan dengan nama unit kerja', async (flag) => {
        env.SIMSA_ADVANCED_ARCHIVE_WORKFLOWS_ENABLED = flag;
        const { body } = await request(app).post('/api/retention/disposal-report')
            .set(sebagai(PENGGUNA.tu)).send({ unitKerjaId: 'sesditjen' }).expect(200);
        expect(body.data).toMatchObject({
            draf: true,
            reportNumber: null,
            unitKerjaId: 'sesditjen',
            unitKerja: 'Sekretariat Ditjen',
            totalBerkas: 0,
            daftarArsip: [],
        });
        expect(JSON.stringify(body.data)).not.toMatch(/BA-/);
    });
});
