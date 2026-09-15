import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const originalSql = readFileSync(new URL('../db/migrations/0020_permanent_transfer_lifecycle.sql', import.meta.url), 'utf8');
const originalFunction = originalSql.slice(
    originalSql.indexOf('CREATE OR REPLACE FUNCTION protect_permanent_transfer_attachment_identity()'),
    originalSql.indexOf('DROP TRIGGER IF EXISTS "file_attachments_transfer_identity_guard_trg"'),
).replace('--> statement-breakpoint', '');
const correction = readFileSync(new URL('../db/migrations/0042_attachment_identity_guard.sql', import.meta.url), 'utf8');
let database: PGlite;
let originalBoundary: unknown;
async function boundary() {
    return (await database.query(`SELECT proowner, proacl, prosecdef, proconfig FROM pg_proc
        WHERE oid='public.protect_permanent_transfer_attachment_identity()'::regprocedure`)).rows;
}

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`CREATE ROLE attachment_guard_worker NOLOGIN;
        CREATE TABLE file_attachments(id text PRIMARY KEY, entity_type text, entity_id text,
            file_url text, drive_file_id text, sha256 text, storage_access text,
            malware_scan_status text, integrity_status text, last_fixity_check_at timestamptz);
        CREATE TABLE permanent_transfer_manifest_items(evidence_attachment_id text);
        CREATE TABLE permanent_transfer_events(evidence_attachment_id text);
        GRANT USAGE ON SCHEMA public TO attachment_guard_worker;
        GRANT SELECT, UPDATE ON file_attachments TO attachment_guard_worker;
        SET plan_cache_mode = force_generic_plan;`);
    await database.exec(originalFunction);
    await database.exec(`CREATE TRIGGER file_attachments_transfer_identity_guard_trg
        BEFORE UPDATE OR DELETE ON file_attachments FOR EACH ROW
        EXECUTE FUNCTION public.protect_permanent_transfer_attachment_identity();`);
    originalBoundary = await boundary();
}, 45_000);
beforeEach(async () => {
    await database.exec(correction);
    await database.exec(`TRUNCATE file_attachments, permanent_transfer_manifest_items, permanent_transfer_events;
        INSERT INTO file_attachments VALUES ('attachment', 'arsip', 'archive', 'gs://private/record.pdf',
            NULL, 'baseline', 'private', 'not_scanned', 'baseline_recorded', NULL);`);
});
afterAll(async () => { await database?.close(); });

describe('transfer attachment identity guard under generic plans', () => {
    it('reproduces the old worker permission error and fixes status/fixity updates without new privileges', async () => {
        await database.exec(originalFunction);
        await database.exec('SET ROLE attachment_guard_worker');
        try {
            await expect(database.exec("UPDATE file_attachments SET malware_scan_status='scanning'"))
                .rejects.toThrow(/permission denied for table permanent_transfer_manifest_items/);
        } finally { await database.exec('RESET ROLE'); }
        await database.exec(correction);
        await database.exec('SET ROLE attachment_guard_worker');
        try {
            expect((await database.query(`SELECT
                has_table_privilege(current_user,'public.permanent_transfer_manifest_items','SELECT') AS items,
                has_table_privilege(current_user,'public.permanent_transfer_events','SELECT') AS events`)).rows)
                .toEqual([{ items: false, events: false }]);
            await database.exec("UPDATE file_attachments SET malware_scan_status='clean', integrity_status='verified', last_fixity_check_at=now()");
        } finally { await database.exec('RESET ROLE'); }
        expect((await database.query('SELECT malware_scan_status, integrity_status, last_fixity_check_at IS NOT NULL AS checked FROM file_attachments')).rows)
            .toEqual([{ malware_scan_status: 'clean', integrity_status: 'verified', checked: true }]);
    });

    it.each(['permanent_transfer_manifest_items', 'permanent_transfer_events'])('preserves every guarded identity field and deletion for %s evidence', async table => {
        await database.exec(`INSERT INTO ${table} VALUES ('attachment')`);
        for (const column of ['entity_type', 'entity_id', 'file_url', 'drive_file_id', 'sha256', 'storage_access']) {
            await expect(database.exec(`UPDATE file_attachments SET ${column}='changed'`))
                .rejects.toThrow(/transfer evidence attachment identity is immutable/);
        }
        await expect(database.exec('DELETE FROM file_attachments'))
            .rejects.toThrow(/transfer evidence attachment identity is immutable/);
        await database.exec('SET ROLE attachment_guard_worker');
        try { await database.exec("UPDATE file_attachments SET integrity_status='mismatch', last_fixity_check_at=now()"); }
        finally { await database.exec('RESET ROLE'); }
        expect((await database.query('SELECT integrity_status FROM file_attachments')).rows).toEqual([{ integrity_status: 'mismatch' }]);
    });

    it('retains owner, invoker security and ACLs when applied again', async () => {
        expect(await boundary()).toEqual(originalBoundary);
        await database.exec(correction);
        expect(await boundary()).toEqual(originalBoundary);
    });

    it('still allows an authorized identity edit when the attachment is not transfer evidence', async () => {
        await database.exec("UPDATE file_attachments SET file_url='gs://private/replaced.pdf'");
        expect((await database.query('SELECT file_url FROM file_attachments')).rows).toEqual([{ file_url: 'gs://private/replaced.pdf' }]);
        await database.exec('DELETE FROM file_attachments');
        expect((await database.query('SELECT id FROM file_attachments')).rows).toHaveLength(0);
    });
});
