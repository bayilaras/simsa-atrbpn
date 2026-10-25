import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';

const holder = vi.hoisted(() => ({ db: null as any }));
const storage = vi.hoisted(() => ({ downloadFile: vi.fn() }));
vi.mock('../config/database', () => ({ db: holder.db }));
vi.mock('../services/blob-storage.service', () => ({ blobStorageService: storage }));

let database: PGlite;
let service: typeof import('../services/file-attachment.service').fileAttachmentService;
const id = '10000000-0000-4000-8000-000000000001';
const bytes = Buffer.from('Original controlled bytes');
const hash = createHash('sha256').update(bytes).digest('hex');

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`CREATE TABLE file_attachments (
        id uuid PRIMARY KEY, entity_type varchar(20) NOT NULL, entity_id uuid NOT NULL,
        file_name varchar(255), file_url text, object_generation varchar(32), drive_file_id varchar(255),
        mime_type varchar(100), size_bytes bigint, sha256 varchar(64), storage_access varchar(20) NOT NULL,
        uploaded_by uuid, integrity_status varchar(30) NOT NULL, last_fixity_check_at timestamp,
        malware_scan_status varchar(30) NOT NULL, created_at timestamp NOT NULL DEFAULT now()
    );`);
    holder.db = drizzle(database, { schema });
    ({ fileAttachmentService: service } = await import('../services/file-attachment.service'));
}, 20_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    await database.exec('TRUNCATE file_attachments');
    await database.query(`INSERT INTO file_attachments (id,entity_type,entity_id,file_name,file_url,object_generation,size_bytes,sha256,storage_access,integrity_status,malware_scan_status)
        VALUES ($1,'arsip',$1,'original.pdf','gs://private/original.pdf','123',$2,$3,'private','verified','clean')`, [id, bytes.length, hash]);
    storage.downloadFile.mockReset();
});

describe('manual fixity cannot overwrite concurrent quarantine', () => {
    it.each([
        ['integrity_status', 'mismatch'],
        ['malware_scan_status', 'infected'],
    ])('rejects the stale successful read after %s changes', async (column, status) => {
        storage.downloadFile.mockImplementation(async () => {
            // A concurrent scanner/fixity transaction commits after the reader selected its baseline.
            await database.query(`UPDATE file_attachments SET ${column}=$1 WHERE id=$2`, [status, id]);
            return { stream: Readable.from([bytes]), mimeType: 'application/pdf', fileName: 'original.pdf' };
        });
        await expect(service.verifyIntegrity(id)).rejects.toThrow(/berubah|pemeriksaan/i);
        const result = await database.query<any>('SELECT integrity_status,malware_scan_status,last_fixity_check_at FROM file_attachments WHERE id=$1', [id]);
        expect(result.rows[0][column]).toBe(status);
        expect(result.rows[0].last_fixity_check_at).toBeNull();
    });
});
