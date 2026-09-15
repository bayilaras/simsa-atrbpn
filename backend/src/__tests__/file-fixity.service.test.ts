import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileFixityService, loadFixityConfig } from '../services/file-fixity.service.js';

let database: PGlite;
const id = '00000000-0000-4000-8000-000000000001';
const content = Buffer.from('arsip autentik');
const hash = createHash('sha256').update(content).digest('hex');
const config = { batchSize: 5, intervalSeconds: 86400, retrySeconds: 3600, maximumBytes: 1024, timeoutMs: 1000 };
let pool: Pick<Pool, 'query' | 'connect'>;
const download = vi.fn();

// WASM/database bootstrap can exceed Vitest's 10s hook default on a cold or
// busy workstation. Keep this separate from the real 1s inspection deadline.
beforeEach(async () => {
    database = new PGlite();
    await database.exec(`
        CREATE ROLE simsa_api_runtime NOLOGIN;
        CREATE ROLE simsa_worker_runtime NOLOGIN;
        CREATE ROLE simsa_maintenance NOLOGIN;
        CREATE ROLE simsa_backup_reader NOLOGIN;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO simsa_api_runtime;
        CREATE TABLE file_attachments (
            id uuid PRIMARY KEY, file_url text, drive_file_id text, object_generation text,
            sha256 text, size_bytes bigint, storage_access text, malware_scan_status text,
            integrity_status text, last_fixity_check_at timestamp, created_at timestamp DEFAULT now(),
            entity_type text NOT NULL DEFAULT 'arsip', entity_id text
        );
        CREATE TABLE audit_log (id uuid DEFAULT gen_random_uuid(), action text, entity_type text,
            entity_id uuid, changes jsonb, created_at timestamp DEFAULT now());
        CREATE TABLE permanent_transfer_manifest_items(evidence_attachment_id uuid);
        CREATE TABLE permanent_transfer_events(evidence_attachment_id uuid);
        GRANT SELECT, UPDATE ON file_attachments TO simsa_worker_runtime;
        GRANT INSERT ON audit_log TO simsa_worker_runtime;
        SET plan_cache_mode = force_generic_plan;
    `);
    await database.exec(readFileSync(new URL('../db/migrations/0034_scheduled_file_fixity.sql', import.meta.url), 'utf8'));
    await database.exec(readFileSync(new URL('../db/migrations/0042_attachment_identity_guard.sql', import.meta.url), 'utf8'));
    await database.exec(`CREATE TRIGGER file_attachments_transfer_identity_guard_trg
        BEFORE UPDATE OR DELETE ON file_attachments FOR EACH ROW
        EXECUTE FUNCTION public.protect_permanent_transfer_attachment_identity()`);
    await database.query(`INSERT INTO file_attachments
        (id,file_url,object_generation,sha256,size_bytes,storage_access,malware_scan_status,integrity_status)
        VALUES ($1,'gs://private/record.pdf','123',$2,$3,'private','clean','verified')`, [id, hash, content.length]);
    const client = { query: (sql: string, params?: unknown[]) => database.query(sql, params), release() {} };
    pool = { query: client.query, connect: async () => client } as unknown as Pick<Pool, 'query' | 'connect'>;
    download.mockReset().mockImplementation(async () => ({ stream: Readable.from([content]), mimeType: 'application/pdf', fileName: 'record.pdf' }));
}, 30_000);
afterEach(async () => { await database?.close(); });

describe('scheduled file integrity checks', () => {
    it('checks a due file, records an audit, and avoids immediately checking it again', async () => {
        const service = new FileFixityService(pool, download);
        await database.exec('SET ROLE simsa_worker_runtime');
        try {
            expect(await service.run(config)).toMatchObject({ checked: 1, matched: 1, mismatched: 0, failed: 0 });
            expect(await service.run(config)).toMatchObject({ checked: 0 });
        } finally { await database.exec('RESET ROLE'); }
        const audit = await database.query('SELECT action, changes FROM audit_log');
        expect(audit.rows).toMatchObject([{ action: 'verify_integrity', changes: { source: 'scheduled_fixity', result: 'match' } }]);
        expect(download).toHaveBeenCalledTimes(1);
    });

    it('quarantines a mismatch and never silently repairs it during subsequent scheduled runs', async () => {
        download.mockImplementation(async () => ({ stream: Readable.from(['changed']), mimeType: 'application/pdf', fileName: 'record.pdf' }));
        expect(await new FileFixityService(pool, download).run(config)).toMatchObject({ mismatched: 1 });
        const result = await database.query('SELECT integrity_status FROM file_attachments');
        expect(result.rows).toEqual([{ integrity_status: 'mismatch' }]);
        await database.exec("UPDATE file_fixity_jobs SET next_check_at = now() - interval '1 day'");
        expect(await new FileFixityService(pool, download).run(config)).toMatchObject({ checked: 0 });
    });

    it('records unavailable storage without inventing a successful verification or hot-looping', async () => {
        download.mockResolvedValue(null);
        const result = await new FileFixityService(pool, download).run(config);
        expect(result).toMatchObject({ failed: 1, checked: 1, matched: 0 });
        const jobs = await database.query('SELECT last_result,last_error_code FROM file_fixity_jobs');
        expect(jobs.rows).toEqual([{ last_result: 'error', last_error_code: 'OBJECT_UNAVAILABLE' }]);
        expect(download).toHaveBeenCalledTimes(1);
    });

    it('refuses a stale baseline after the download changed its recorded generation', async () => {
        download.mockImplementation(async () => {
            await database.query("UPDATE file_attachments SET object_generation='124' WHERE id=$1", [id]);
            return { stream: Readable.from([content]), mimeType: 'application/pdf', fileName: 'record.pdf' };
        });
        expect(await new FileFixityService(pool, download).run(config)).toMatchObject({ stale: 1, matched: 0 });
        const attachments = await database.query('SELECT last_fixity_check_at FROM file_attachments');
        expect(attachments.rows).toEqual([{ last_fixity_check_at: null }]);
    });

    it('rolls back a verification when the critical audit insert fails', async () => {
        await database.exec("ALTER TABLE audit_log ADD CONSTRAINT deny_audit CHECK (action <> 'verify_integrity')");
        await expect(new FileFixityService(pool, download).run(config)).rejects.toThrow();
        const attachments = await database.query('SELECT last_fixity_check_at FROM file_attachments');
        expect(attachments.rows).toEqual([{ last_fixity_check_at: null }]);
    });

    it('excludes public and unscanned files', async () => {
        await database.exec(`INSERT INTO file_attachments
            SELECT '00000000-0000-4000-8000-000000000002',file_url,drive_file_id,object_generation,
            sha256,size_bytes,'public',malware_scan_status,integrity_status,last_fixity_check_at,created_at,entity_type,entity_id FROM file_attachments`);
        await database.exec("UPDATE file_attachments SET malware_scan_status='not_scanned' WHERE id='00000000-0000-4000-8000-000000000001'");
        expect(await new FileFixityService(pool, download).run(config)).toMatchObject({ checked: 0 });
        expect(download).not.toHaveBeenCalled();
    });

    it('limits actual reads even when more controlled files are due', async () => {
        await database.exec(`INSERT INTO file_attachments
            SELECT '00000000-0000-4000-8000-000000000002',file_url,drive_file_id,object_generation,
            sha256,size_bytes,storage_access,malware_scan_status,integrity_status,last_fixity_check_at,created_at,entity_type,entity_id FROM file_attachments`);
        expect(await new FileFixityService(pool, download).run({ ...config, batchSize: 1 })).toMatchObject({ checked: 1 });
        expect(download).toHaveBeenCalledTimes(1);
        expect(await new FileFixityService(pool, download).run({ ...config, batchSize: 1 })).toMatchObject({ checked: 1 });
    });

    it('does not commit a result after another worker has reclaimed the lease', async () => {
        download.mockImplementation(async () => {
            await database.exec("UPDATE file_fixity_jobs SET claim_token=gen_random_uuid(),lease_expires_at=now()+interval '1 hour'");
            return { stream: Readable.from([content]), mimeType: 'application/pdf', fileName: 'record.pdf' };
        });
        expect(await new FileFixityService(pool, download).run(config)).toMatchObject({ stale: 1, matched: 0 });
        expect((await database.query('SELECT * FROM audit_log')).rows).toHaveLength(0);
        expect((await database.query('SELECT last_fixity_check_at FROM file_attachments')).rows).toEqual([{ last_fixity_check_at: null }]);
    });

    it.each(['surat_masuk', 'surat_keluar'])('excludes old %s attachments from new and already queued fixity work', async entityType => {
        await database.query("UPDATE file_attachments SET entity_type=$1, file_url='https://store.private.blob.vercel-storage.com/record.pdf', object_generation=null", [entityType]);
        const service = new FileFixityService(pool, download);
        expect(await service.run(config)).toMatchObject({ checked: 0 });
        expect((await database.query('SELECT * FROM file_fixity_jobs')).rows).toHaveLength(0);
        await database.query('INSERT INTO file_fixity_jobs (attachment_id) VALUES ($1)', [id]);
        expect(await service.run(config)).toMatchObject({ checked: 0 });
        expect(download).not.toHaveBeenCalled();
        expect((await database.query('SELECT last_fixity_check_at FROM file_attachments')).rows).toEqual([{ last_fixity_check_at: null }]);
    });

    it('does not let the HTTP API write or delete operational check results', async () => {
        await database.exec('SET ROLE simsa_api_runtime');
        await expect(database.query('SELECT * FROM file_fixity_jobs')).resolves.toBeDefined();
        await expect(database.query('INSERT INTO file_fixity_jobs (attachment_id) VALUES ($1)', [id])).rejects.toThrow(/permission denied/i);
        await expect(database.query('DELETE FROM file_fixity_jobs')).rejects.toThrow(/permission denied/i);
    });

    it.each(['surat_masuk', 'surat_keluar'])('preserves scheduled GCS %s integrity checks', async entityType => {
        await database.query('UPDATE file_attachments SET entity_type=$1', [entityType]);
        expect(await new FileFixityService(pool, download).run(config)).toMatchObject({ checked: 1, matched: 1 });
        expect(download).toHaveBeenCalledTimes(1);
    });
});

describe('fixity configuration limits', () => {
    it('rejects invalid/unbounded controls', () => {
        expect(() => loadFixityConfig({ FIXITY_BATCH_SIZE: '0' })).toThrow();
        expect(() => loadFixityConfig({ FIXITY_MAX_BYTES: 'Infinity' })).toThrow();
        expect(() => loadFixityConfig({ FIXITY_TIMEOUT_MS: '999999999' })).toThrow();
    });
});
