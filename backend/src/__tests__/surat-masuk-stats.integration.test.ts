import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null as any, queries: 0 }));
vi.mock('../config/database', () => ({ db: {
    select: (fields: any) => { holder.queries++; return holder.db.select(fields); },
} }));
vi.mock('../services/audit-log.service', () => ({ default: {} }));
vi.mock('../services/srikandi-producer.service', () => ({ srikandiBusinessProducer: {} }));
vi.mock('../services/client-blob-upload.service', () => ({ clientBlobUploadService: {}, normalizeBlobLocator: (value: unknown) => value }));
vi.mock('../services/file-attachment.service', () => ({ default: {} }));
vi.mock('../services/settings.service', () => ({ settingsService: {} }));
vi.mock('../services/archive-rule-assignment.service', () => ({ archiveRuleAssignmentService: {} }));

let database: PGlite;
let service: InstanceType<typeof import('../services/surat-masuk.service').SuratMasukService>;
beforeAll(async () => {
    database = new PGlite();
    await database.exec(`CREATE TABLE surat_masuk (
        unit_kerja_id text, tahun integer, sifat_surat text, status text,
        is_archived boolean, is_deleted boolean
    );
    INSERT INTO surat_masuk VALUES
        ('unit-a', 2026, 'biasa', 'belum_dibalas', false, false),
        ('unit-a', 2026, 'segera', 'sudah_dibalas', true, false),
        ('unit-a', 2026, NULL, NULL, NULL, false),
        ('unit-a', 2026, 'rahasia', 'belum_dibalas', true, false),
        ('unit-a', 2026, 'biasa', 'belum_dibalas', true, true),
        ('unit-a', 2025, 'biasa', 'sudah_dibalas', true, false),
        ('unit-b', 2026, 'biasa', 'belum_dibalas', false, false),
        ('unit-a', 2026, 'sangat_segera', 'sudah_dibalas', false, NULL),
        ('unit-deleted', 2026, 'biasa', 'belum_dibalas', true, true);`);
    holder.db = drizzle(database);
    const { SuratMasukService } = await import('../services/surat-masuk.service');
    service = new SuratMasukService();
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(() => { holder.queries = 0; });

describe('incoming statistics SQL and query budget', () => {
    it.each([
        ['unit-a', 2026, ['biasa'], { total: 4, belumDibalas: 1, sudahDibalas: 2, diarsipkan: 1 }],
        [null, 2026, ['biasa'], { total: 5, belumDibalas: 2, sudahDibalas: 2, diarsipkan: 1 }],
        ['unit-a', undefined, ['biasa'], { total: 5, belumDibalas: 1, sudahDibalas: 3, diarsipkan: 2 }],
        ['unit-a', 2026, null, { total: 5, belumDibalas: 2, sudahDibalas: 2, diarsipkan: 2 }],
        ['unit-a', 2026, ['rahasia'], { total: 1, belumDibalas: 1, sudahDibalas: 0, diarsipkan: 1 }],
        ['unit-a', 2026, [], { total: 0, belumDibalas: 0, sudahDibalas: 0, diarsipkan: 0 }],
        ['unit-empty', 2026, ['biasa'], { total: 0, belumDibalas: 0, sudahDibalas: 0, diarsipkan: 0 }],
        ['unit-deleted', 2026, ['biasa'], { total: 0, belumDibalas: 0, sudahDibalas: 0, diarsipkan: 0 }],
    ] as const)('counts unit %s / year %s / security %j without changing visibility', async (unit, year, security, expected) => {
        expect(await service.getStats(unit, year, security === null ? null : [...security])).toEqual(expected);
        expect(holder.queries).toBe(1);
    });
});
