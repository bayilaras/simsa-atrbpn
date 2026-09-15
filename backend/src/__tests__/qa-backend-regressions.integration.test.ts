import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { enterTestMigratorRole } from './helpers/database-role-fixture';
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));
const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const userId = '76000000-0000-4000-8000-000000000001';
const sourceId = '76000000-0000-4000-8000-000000000002';
const targetId = '76000000-0000-4000-8000-000000000003';
let database: PGlite;
let storage: typeof import('../services/storage-location.service').storageLocationService;
let crossref: typeof import('../services/tunjuk-silang.service').tunjukSilangService;
beforeAll(async () => {
    database = new PGlite({ extensions: { pgcrypto } });
    await database.waitReady;
    await enterTestMigratorRole(database);
    for (const file of readdirSync(migrationsDir).filter(file => /^\d{4}.*\.sql$/.test(file) && Number(file.slice(0, 4)) <= 44).sort()) {
        for (const statement of readFileSync(`${migrationsDir}/${file}`, 'utf8').split('--> statement-breakpoint').filter(value => value.trim()))
            await database.exec(statement);
    }
    holder.db = drizzle(database, { schema });
    ({ storageLocationService: storage } = await import('../services/storage-location.service'));
    ({ tunjukSilangService: crossref } = await import('../services/tunjuk-silang.service'));
}, 60000);
afterAll(async () => { await database?.close(); });
afterEach(() => vi.useRealTimers());
beforeEach(async () => {
    await database.exec(`TRUNCATE tunjuk_silang,storage_locations,arsip,users,unit_kerja CASCADE;
    INSERT INTO unit_kerja(id,name) VALUES('ditjen','Ditjen'),('sesditjen','Sesditjen');
    INSERT INTO users(id,email,role,unit_kerja_id) VALUES('${userId}','qa@example.test','admin_unit','ditjen');
    INSERT INTO arsip(id,unit_kerja_id,jenis_arsip,tahun) VALUES('${sourceId}','ditjen','masuk',2026),('${targetId}','ditjen','masuk',2026);`);
});
describe('QA database regressions with actual Drizzle/PGlite errors', () => {
    it('reports a duplicate active cross-reference as 409 and preserves one active record', async () => {
        const input = { sourceType: 'arsip', sourceId, targetType: 'arsip', targetId, jenisRelasi: 'referensi', createdBy: userId };
        const first = await crossref.create(input);
        await expect(crossref.create(input)).rejects.toMatchObject({ statusCode: 409 });
        expect((await database.query('SELECT id FROM tunjuk_silang WHERE cancelled_at IS NULL')).rows).toEqual([{ id: first.id }]);
        await crossref.cancel(first.id, userId, 'Hubungan sintetis selesai diuji');
        const replacement = await crossref.create(input);
        expect(replacement.id).not.toBe(first.id);
        expect((await database.query('SELECT id FROM tunjuk_silang')).rows).toHaveLength(2);
    });
    it('trims display codes and rejects case-insensitive duplicates only inside the same unit', async () => {
        const first = await storage.create({ unitKerjaId: 'ditjen', name: 'First', level: 'gedung', code: '  G1  ' }, 'ditjen');
        expect(first.code).toBe('G1');
        await expect(storage.create({ unitKerjaId: 'ditjen', name: 'Duplicate', level: 'gedung', code: 'g1' }, 'ditjen')).rejects.toMatchObject({ statusCode: 409 });
        const other = await storage.create({ unitKerjaId: 'sesditjen', name: 'Other unit', level: 'gedung', code: 'g1' }, 'sesditjen');
        expect(other.unitKerjaId).toBe('sesditjen');
        expect((await database.query('SELECT id FROM storage_locations')).rows).toHaveLength(2);
    });
    it('rejects a code collision on update without changing either location', async () => {
        const first = await storage.create({ unitKerjaId: 'ditjen', name: 'First', level: 'gedung', code: 'G1' }, 'ditjen');
        const second = await storage.create({ unitKerjaId: 'ditjen', name: 'Second', level: 'gedung', code: 'G2' }, 'ditjen');
        await expect(storage.update(second.id, { code: ' g1 ' }, 'ditjen')).rejects.toMatchObject({ statusCode: 409 });
        expect((await storage.findById(second.id, 'ditjen'))?.code).toBe('G2');
        expect((await storage.update(first.id, { code: ' G1 ', name: 'Renamed' }, 'ditjen'))?.code).toBe('G1');
    });
    it('generates the next unused suffix when deletion or manual codes leave sequence gaps', async () => {
        await storage.create({ unitKerjaId: 'ditjen', name: 'First', level: 'gedung', code: 'G1' }, 'ditjen');
        await storage.create({ unitKerjaId: 'ditjen', name: 'Third', level: 'gedung', code: 'G3' }, 'ditjen');
        const generated = await storage.create({ unitKerjaId: 'ditjen', name: 'Auto', level: 'gedung' } as any, 'ditjen');
        expect(generated.code).toBe('G4');
    });
    it('allocates distinct generated codes for parallel service transactions', async () => {
        const created = await Promise.all(['One', 'Two', 'Three'].map(name => storage.create({ unitKerjaId: 'ditjen', name, level: 'gedung' } as any, 'ditjen')));
        expect(new Set(created.map(row => row.code)).size).toBe(3);
        expect((await database.query('SELECT id FROM storage_locations')).rows).toHaveLength(3);
    });
    it('allocates a hierarchical code without colliding with an explicit code at another level', async () => {
        const parent = await storage.create({ unitKerjaId: 'ditjen', name: 'Parent', level: 'gedung', code: 'G1' }, 'ditjen');
        await storage.create({ unitKerjaId: 'ditjen', name: 'Manual identifier', level: 'gedung', code: 'g1-r1' }, 'ditjen');
        const child = await storage.create({ unitKerjaId: 'ditjen', name: 'Child', level: 'ruang', parentId: parent.id } as any, 'ditjen');
        expect(child.code).toBe('G1-R2');
        expect(child.parentId).toBe(parent.id);
    });
    it('rejects blank, oversized and oversized generated codes without partial writes', async () => {
        await expect(storage.create({ unitKerjaId: 'ditjen', name: 'Blank', level: 'gedung', code: '   ' }, 'ditjen')).rejects.toMatchObject({ statusCode: 400 });
        await expect(storage.create({ unitKerjaId: 'ditjen', name: 'Long', level: 'gedung', code: 'A'.repeat(51) }, 'ditjen')).rejects.toMatchObject({ statusCode: 400 });
        const parent = await storage.create({ unitKerjaId: 'ditjen', name: 'Long parent', level: 'gedung', code: 'A'.repeat(50) }, 'ditjen');
        await expect(storage.create({ unitKerjaId: 'ditjen', name: 'Child', level: 'ruang', parentId: parent.id } as any, 'ditjen')).rejects.toMatchObject({ statusCode: 400 });
        expect((await database.query('SELECT id FROM storage_locations')).rows).toEqual([{ id: parent.id }]);
    });
    it('enforces normalized location uniqueness for direct SQL writes as well', async () => {
        await database.exec("INSERT INTO storage_locations(unit_kerja_id,code,name,level) VALUES('ditjen','G1','First','gedung')");
        await expect(database.exec("INSERT INTO storage_locations(unit_kerja_id,code,name,level) VALUES('ditjen',' g1 ','Duplicate','gedung')")).rejects.toMatchObject({ code: '23505' });
    });
    it('supports generated codes and updates under the restricted API database role', async () => {
        await database.exec('RESET ROLE; SET ROLE simsa_api_runtime');
        try {
            const created = await storage.create({ unitKerjaId: 'ditjen', name: 'Runtime', level: 'gedung' } as any, 'ditjen');
            expect(created.code).toBe('G1');
            expect((await storage.update(created.id, { code: ' G2 ' }, 'ditjen'))?.code).toBe('G2');
        } finally {
            await database.exec('RESET ROLE; SET ROLE simsa_migrator');
        }
    });
    it.each(['2026-09-13T17:00:00.000Z', '2026-09-13T22:56:00.000Z', '2026-09-14T00:00:00.000Z'])('accepts the WIB calendar day at%s with database timezone UTC', async (instant) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(instant));
        await database.exec("SET TIME ZONE 'UTC'");
        const clock = await database.query<{
            today: string;
        }>("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS today");
        expect(clock.rows[0].today).toBe('2026-09-14');
        await expect(database.exec(`INSERT INTO retention_trigger_events(arsip_id,revision,event_type,event_date,label,evidence_uri,evidence_sha256,actor_id)
      VALUES('${sourceId}',1,'berkas_ditutup','2026-09-14','Boundary evidence','urn:qa:boundary','${'a'.repeat(64)}','${userId}')`)).resolves.toBeDefined();
    });
    it.each(['UTC', 'Etc/GMT+12', 'Pacific/Kiritimati'])('rejects tomorrow in WIB regardless of session timezone%s', async (timezone) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-13T16:59:59.000Z'));
        await database.exec(`SET TIME ZONE '${timezone}'`);
        await expect(database.exec(`INSERT INTO retention_trigger_events(arsip_id,revision,event_type,event_date,label,evidence_uri,evidence_sha256,actor_id)
      VALUES('${sourceId}',1,'berkas_ditutup','2026-09-14','Future evidence','urn:qa:future','${'a'.repeat(64)}','${userId}')`)).rejects.toMatchObject({ code: '23514' });
    });
});
describe('storage migration preserves existing business records', () => {
    it('refuses duplicate normalized codes with a descriptive preflight and leaves all rows unchanged', async () => {
        const legacy = new PGlite();
        await legacy.waitReady;
        try {
            await legacy.exec("CREATE TABLE storage_locations(id text PRIMARY KEY,unit_kerja_id text,code text); INSERT INTO storage_locations VALUES('old-a','ditjen','G1'),('old-b','ditjen',' g1 ')");
            const file = `${migrationsDir}/0044_storage_location_business_codes.sql`;
            const apply = async () => { if (existsSync(file))
                for (const statement of readFileSync(file, 'utf8').split('--> statement-breakpoint').filter(value => value.trim()))
                    await legacy.exec(statement); };
            await expect(apply()).rejects.toThrow(/duplicate normalized storage location codes/i);
            expect((await legacy.query('SELECT id,code FROM storage_locations ORDER BY id')).rows).toEqual([{ id: 'old-a', code: 'G1' }, { id: 'old-b', code: ' g1 ' }]);
        }
        finally {
            await legacy.close();
        }
    });
});
