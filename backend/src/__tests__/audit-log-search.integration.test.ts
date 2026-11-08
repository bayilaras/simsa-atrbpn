import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    db: new Proxy({}, { get: (_target, prop) => holder.db[prop] }),
}));

const userId = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rowId = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ENTITY = 'b7e1c2d3-0000-4000-8000-000000000042';

let database: PGlite;
let service: typeof import('../services/audit-log.service').auditLogService;

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
        CREATE TABLE users (id uuid PRIMARY KEY, email varchar(255) NOT NULL, name varchar(255), image text);
        CREATE TABLE audit_log (
            id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), user_email varchar(255),
            action varchar(50) NOT NULL, entity_type varchar(50) NOT NULL, entity_id uuid,
            changes jsonb, ip_address varchar(45), created_at timestamp NOT NULL DEFAULT now()
        );
    `);
    await database.query(
        `INSERT INTO users (id, email, name) VALUES ($1, 'operator1@example.test', 'Budi Santoso'), ($2, 'operator2@example.test', 'Sari Dewi')`,
        [userId(1), userId(2)],
    );
    await database.query(
        `INSERT INTO audit_log (id, user_id, user_email, action, entity_type, entity_id) VALUES
            ($1, $3, 'operator1@example.test', 'update', 'arsip', $5),
            ($2, $4, 'operator2@example.test', 'create', 'surat_masuk', NULL)`,
        [rowId(1), rowId(2), userId(1), userId(2), ENTITY],
    );
    holder.db = drizzle(database);
    ({ auditLogService: service } = await import('../services/audit-log.service'));
}, 60_000);

afterAll(async () => { await database?.close(); });

const search = async (term: string) => {
    const result = await service.listLogs({ search: term });
    return { ids: result.data.map(row => row.id).sort(), total: result.pagination.total };
};

describe('auditLogService.listLogs — pencarian', () => {
    it('mencocokkan nama pengguna, termasuk pada hitungan total', async () => {
        expect(await search('budi')).toEqual({ ids: [rowId(1)], total: 1 });
        expect(await search('Dewi')).toEqual({ ids: [rowId(2)], total: 1 });
    });

    it('mencocokkan ID entitas secara utuh atau awalan, tanpa membedakan huruf besar', async () => {
        expect(await search(ENTITY)).toEqual({ ids: [rowId(1)], total: 1 });
        expect(await search('B7E1C2D3')).toEqual({ ids: [rowId(1)], total: 1 });
        // Potongan di tengah UUID bukan awalan, jadi tidak cocok.
        expect(await search('0000-000000000042')).toEqual({ ids: [], total: 0 });
    });

    it('tetap mencocokkan email, aksi, dan tipe entitas', async () => {
        expect(await search('operator2@')).toEqual({ ids: [rowId(2)], total: 1 });
        expect(await search('surat_masuk')).toEqual({ ids: [rowId(2)], total: 1 });
    });
});
