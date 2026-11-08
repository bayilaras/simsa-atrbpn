import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    db: new Proxy({}, { get: (_target, prop) => holder.db[prop] }),
}));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: '00000000-0000-4000-8000-000000000001', email: 'super@example.test', role: 'super_admin', unitKerjaId: null };
        next();
    },
}));

const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// created_at disimpan sebagai jam dinding UTC (sesi database timezone=UTC).
const EVENTS: Array<[number, string]> = [
    [1, '2026-11-08 16:59:59'], // 23.59.59 WIB, 8 Nov
    [2, '2026-11-08 17:00:00'], // 00.00 WIB, 9 Nov
    [3, '2026-11-09 00:30:00'], // 07.30 WIB, 9 Nov
    [4, '2026-11-09 16:00:00'], // 23.00 WIB, 9 Nov
    [5, '2026-11-09 17:00:00'], // 00.00 WIB, 10 Nov
];

let database: PGlite;
let app: express.Express;

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
        CREATE TABLE users (id uuid PRIMARY KEY, email varchar(255) NOT NULL, name varchar(255), image text);
        CREATE TABLE audit_log (
            id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), user_email varchar(255),
            action varchar(50) NOT NULL, entity_type varchar(50) NOT NULL, entity_id uuid,
            changes jsonb, ip_address varchar(45), created_at timestamp NOT NULL
        );
    `);
    for (const [n, createdAt] of EVENTS) {
        await database.query(
            `INSERT INTO audit_log (id, action, entity_type, created_at) VALUES ($1, 'update', 'arsip', $2)`,
            [id(n), createdAt],
        );
    }
    holder.db = drizzle(database);
    const { default: auditLogRouter } = await import('../routes/audit-log.routes');
    app = express();
    app.use('/api/audit-log', auditLogRouter);
}, 60_000);

afterAll(async () => { await database?.close(); });

const ids = async (query: Record<string, string>) => {
    const res = await request(app).get('/api/audit-log').query(query).expect(200);
    return (res.body.data as Array<{ id: string }>).map(row => row.id).sort();
};

describe('GET /api/audit-log — rentang tanggal kalender WIB', () => {
    it('mulai = akhir mencakup seluruh hari itu (00.00–23.59 WIB)', async () => {
        expect(await ids({ startDate: '2026-11-09', endDate: '2026-11-09' })).toEqual([id(2), id(3), id(4)]);
    });

    it('tanggal akhir menyertakan kejadian 23.00 WIB, bukan berhenti di 07.00 WIB', async () => {
        expect(await ids({ endDate: '2026-11-09' })).toEqual([id(1), id(2), id(3), id(4)]);
    });

    it('tanggal mulai dimulai 00.00 WIB, bukan 00.00 UTC', async () => {
        expect(await ids({ startDate: '2026-11-09' })).toEqual([id(2), id(3), id(4), id(5)]);
    });

    it('timestamp ISO lengkap tetap dipakai apa adanya (akhir inklusif)', async () => {
        expect(await ids({ startDate: '2026-11-08T17:00:00.000Z', endDate: '2026-11-09T00:30:00.000Z' }))
            .toEqual([id(2), id(3)]);
    });

    it('menolak tanggal yang tidak valid (400)', async () => {
        await request(app).get('/api/audit-log').query({ startDate: '2026-02-30' }).expect(400);
        await request(app).get('/api/audit-log').query({ endDate: 'bukan-tanggal' }).expect(400);
    });
});
