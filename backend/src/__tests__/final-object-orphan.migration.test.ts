import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
    new URL('../db/migrations/0033_final_object_orphan_queue.sql', import.meta.url),
    'utf8',
).split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean);

const databases: PGlite[] = [];

afterEach(async () => {
    await Promise.all(databases.splice(0).map(database => database.close()));
});

describe('final object orphan queue migration privileges', () => {
    it('allows worker idempotent insert/fencing but reserves row cleanup for its isolated role', async () => {
        const database = new PGlite({ extensions: { pgcrypto } });
        databases.push(database);
        await database.waitReady;
        await database.exec(`
            CREATE ROLE simsa_api_runtime NOLOGIN;
            CREATE ROLE simsa_event_runtime NOLOGIN;
            CREATE ROLE simsa_worker_runtime NOLOGIN;
            CREATE ROLE simsa_final_cleanup NOLOGIN;
            CREATE ROLE simsa_maintenance NOLOGIN;
            GRANT USAGE ON SCHEMA public TO simsa_api_runtime, simsa_worker_runtime, simsa_final_cleanup;
            CREATE TABLE file_attachments (id integer);
            CREATE TABLE regulatory_rule_sets (id integer);
            CREATE TABLE bulk_upload_items (id integer);
            CREATE TABLE autentikasi (id integer);
            CREATE TABLE surat_masuk (id integer);
            CREATE TABLE surat_keluar (id integer);
        `);
        for (const statement of migration) await database.exec(statement);

        await database.exec('SET ROLE simsa_worker_runtime');
        const insert = `
            INSERT INTO final_object_orphans (
                attachment_id, final_locator, final_object_generation,
                source_locator, source_object_generation, not_before
            ) VALUES (
                '00000000-0000-4000-8000-000000000001',
                'gs://simsa-final/released/00000000-0000-4000-8000-000000000001/1-record.pdf',
                '1735689600999999',
                'gs://simsa-upload/surat-masuk/record.pdf',
                '1735689600123456',
                '2026-10-01T00:00:00Z'
            )
            ON CONFLICT (final_locator, final_object_generation) DO NOTHING
        `;
        await expect(database.exec(insert)).resolves.toBeDefined();
        await expect(database.exec(insert)).resolves.toBeDefined();
        await expect(database.exec(`
            SELECT final_locator, final_object_generation FROM final_object_orphans
        `)).resolves.toBeDefined();
        await expect(database.exec('SELECT status FROM final_object_orphans'))
            .rejects.toThrow(/permission denied/i);
        await expect(database.exec(`
            UPDATE final_object_orphans SET status = 'deleted'
        `)).rejects.toThrow(/permission denied/i);
        const fenced = await database.query<{ acquired: boolean }>(`
            SELECT public.simsa_mark_final_object_reference_candidate(
                '00000000-0000-4000-8000-000000000001',
                'gs://simsa-final/released/00000000-0000-4000-8000-000000000001/1-record.pdf',
                '1735689600999999',
                'gs://simsa-upload/surat-masuk/record.pdf',
                '1735689600123456',
                '2026-10-31T01:00:00Z'
            ) AS acquired
        `);
        expect(fenced.rows).toEqual([{ acquired: true }]);

        await database.exec('RESET ROLE; SET ROLE simsa_api_runtime');
        const reserved = await database.query<{ reserved: boolean }>(`
            SELECT public.simsa_reserve_api_final_object_candidate(
                '00000000-0000-4000-8000-000000000003',
                'gs://simsa-final/autentikasi/reserved-record.pdf',
                '00000000-0000-4000-8000-000000000004',
                '2099-10-01T00:00:00Z'
            ) AS reserved
        `);
        expect(reserved.rows).toEqual([{ reserved: true }]);
        const recorded = await database.query<{ recorded: boolean }>(`
            SELECT public.simsa_record_api_final_object_candidate(
                '00000000-0000-4000-8000-000000000004',
                'gs://simsa-final/autentikasi/reserved-record.pdf',
                '1735689600888888',
                '2099-10-01T00:00:00Z'
            ) AS recorded
        `);
        expect(recorded.rows).toEqual([{ recorded: true }]);
        const marked = await database.query<{ marked: boolean }>(`
            SELECT public.simsa_mark_api_final_object_referenced(
                '00000000-0000-4000-8000-000000000004',
                'gs://simsa-final/autentikasi/reserved-record.pdf',
                '1735689600888888'
            ) AS marked
        `);
        expect(marked.rows).toEqual([{ marked: true }]);
        await expect(database.exec('SELECT status FROM final_object_orphans'))
            .rejects.toThrow(/permission denied/i);
        await expect(database.exec('DELETE FROM final_object_orphans'))
            .rejects.toThrow(/permission denied/i);

        await database.exec('RESET ROLE; SET ROLE simsa_final_cleanup');
        const queued = await database.query<{ status: string; not_before: string | Date }>(`
            SELECT status, not_before FROM final_object_orphans
        `);
        expect(queued.rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ status: 'reference_check' }),
            expect.objectContaining({ status: 'referenced' }),
        ]));
        const workerCandidate = queued.rows.find(row => row.status === 'reference_check');
        expect(new Date(workerCandidate!.not_before).toISOString()).toBe('2026-10-31T01:00:00.000Z');
        await expect(database.exec(`
            UPDATE final_object_orphans SET status = 'referenced'
        `)).resolves.toBeDefined();
        await expect(database.exec(`
            INSERT INTO final_object_orphans (
                attachment_id, final_locator, final_object_generation,
                source_locator, source_object_generation
            ) VALUES (
                '00000000-0000-4000-8000-000000000002',
                'gs://simsa-final/released/2/record.pdf', '2',
                'gs://simsa-upload/record.pdf', '2'
            )
        `)).rejects.toThrow(/permission denied/i);

        await database.exec('RESET ROLE');
        const apiPrivileges = await database.query<{
            can_select: boolean;
            can_delete: boolean;
            can_reserve: boolean;
            can_record: boolean;
            can_mark: boolean;
        }>(`
            SELECT
                has_table_privilege('simsa_api_runtime', 'final_object_orphans', 'SELECT') AS can_select,
                has_table_privilege('simsa_api_runtime', 'final_object_orphans', 'DELETE') AS can_delete,
                has_function_privilege(
                    'simsa_api_runtime',
                    'simsa_reserve_api_final_object_candidate(uuid,text,uuid,timestamp with time zone)',
                    'EXECUTE'
                ) AS can_reserve,
                has_function_privilege(
                    'simsa_api_runtime',
                    'simsa_record_api_final_object_candidate(uuid,text,text,timestamp with time zone)',
                    'EXECUTE'
                ) AS can_record,
                has_function_privilege(
                    'simsa_api_runtime',
                    'simsa_mark_api_final_object_referenced(uuid,text,text)',
                    'EXECUTE'
                ) AS can_mark
        `);
        expect(apiPrivileges.rows).toEqual([{
            can_select: false,
            can_delete: false,
            can_reserve: true,
            can_record: true,
            can_mark: true,
        }]);
    }, 30_000);
});
