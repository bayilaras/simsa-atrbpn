import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { arsipTerjaga } from '../db/schema/arsip-terjaga';

const holder = vi.hoisted(() => ({ db: null as any, table: null as any }));
// Only unrelated dashboard queries are stubbed; the reporting aggregate and
// its joins/security scope execute against PostgreSQL in PGlite.
const empty: any = new Proxy({}, { get: (_target, key) => key === 'then'
    ? (resolve: (rows: unknown[]) => unknown) => resolve([]) : () => empty });
vi.mock('../config/database', () => ({ db: { select: (fields: any) => ({
    from: (table: any) => table === holder.table ? holder.db.select(fields).from(table) : empty,
}) } }));

let database: PGlite;
let service: typeof import('../services/dashboard.service').dashboardService;
beforeAll(async () => {
    database = new PGlite();
    await database.exec(`CREATE TABLE arsip (id uuid PRIMARY KEY, klasifikasi_keamanan text);
        CREATE TABLE arsip_terjaga (id uuid PRIMARY KEY, arsip_id uuid, unit_kerja_id text, status_pelaporan text);`);
    const stages = ['belum_dilaporkan', 'dicatat', 'dicatat', 'dikirim', 'diterima', 'bukti_diverifikasi', 'dilaporkan'];
    for (const [index, status] of [...stages, 'dicatat', 'dicatat'].entries()) {
        const id = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
        await database.query('INSERT INTO arsip VALUES ($1,$2)', [id, index === 8 ? 'rahasia' : 'biasa']);
        await database.query('INSERT INTO arsip_terjaga VALUES ($1,$1,$2,$3)', [id, index === 7 ? 'unit-other' : 'unit-a', status]);
    }
    holder.db = drizzle(database);
    holder.table = arsipTerjaga;
    ({ dashboardService: service } = await import('../services/dashboard.service'));
}, 20_000);
afterAll(async () => { await database?.close(); });

describe('dashboard reporting stages', () => {
    it('retains recorded and unknown states in scoped counts without inferring draft or verified receipt', async () => {
        const result = await service.getWidgetData('unit-a', ['biasa']);
        expect(result.vitalTerjagaAlerts).toMatchObject({
            terjagaTotal: 7, terjagaUnreported: 6,
            terjagaReportingStages: { belum_dilaporkan: 1, dicatat: 2, dikirim: 1,
                diterima: 1, bukti_diverifikasi: 1, perlu_ditinjau: 1 },
        });
    });
    it('returns no reporting counts for an empty authorized classification scope', async () => {
        const result = await service.getWidgetData('unit-a', []);
        expect(result.vitalTerjagaAlerts.terjagaTotal).toBe(0);
        expect(Object.values(result.vitalTerjagaAlerts.terjagaReportingStages).every(value => value === 0)).toBe(true);
    });
});
