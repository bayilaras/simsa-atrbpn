import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null as any, audit: vi.fn() }));
vi.mock('../config/database.js', () => ({
    db: {
        select: (fields: any) => holder.db.select(fields),
        transaction: (run: (tx: any) => unknown) => holder.db.transaction(run),
    },
    pool: { end: async () => {} },
}));
vi.mock('../services/audit-log.service.js', () => ({ default: { logActionOrThrow: holder.audit } }));
vi.mock('../services/blob-storage.service.js', () => ({ default: { downloadFile: vi.fn() } }));

const letterUrl = 'https://store.private.blob.vercel-storage.com/surat-masuk/old.pdf';
const pdf = Buffer.from('%PDF-1.7 legacy letter');
const pdfHash = createHash('sha256').update(pdf).digest('hex');

let database: PGlite;
let backfill: typeof import('../scripts/backfill-letter-attachment-scan.js').backfillLetterAttachmentScan;

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`CREATE TABLE file_attachments (
        id uuid PRIMARY KEY, entity_type varchar(20) NOT NULL, entity_id uuid NOT NULL,
        file_name varchar(255), file_url text, object_generation varchar(32), drive_file_id varchar(255),
        mime_type varchar(100), size_bytes bigint, sha256 varchar(64),
        storage_access varchar(20) NOT NULL DEFAULT 'private', uploaded_by uuid,
        integrity_status varchar(30) NOT NULL DEFAULT 'unverified', last_fixity_check_at timestamp,
        malware_scan_status varchar(30) NOT NULL DEFAULT 'not_scanned', created_at timestamp NOT NULL DEFAULT now()
    );`);
    holder.db = drizzle(database);
    ({ backfillLetterAttachmentScan: backfill } = await import('../scripts/backfill-letter-attachment-scan.js'));
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    holder.audit.mockReset();
    await database.exec(`TRUNCATE file_attachments;
        INSERT INTO file_attachments (id, entity_type, entity_id, file_url, size_bytes, sha256, integrity_status, malware_scan_status) VALUES
        ('00000000-0000-4000-8000-000000000001', 'surat_masuk', '00000000-0000-4000-8000-0000000000a1', '${letterUrl}', ${pdf.length}, NULL, 'not_required', 'not_required'),
        ('00000000-0000-4000-8000-000000000002', 'arsip', '00000000-0000-4000-8000-0000000000a2', 'gs://final/arsip.pdf', 10, '${'b'.repeat(64)}', 'verified', 'clean');`);
});

const rows = async () => (await database.query<{ id: string; sha256: string | null; integrity_status: string; malware_scan_status: string }>(
    'SELECT id, sha256, integrity_status, malware_scan_status FROM file_attachments ORDER BY id')).rows;
const serving = (bytes: Buffer) => vi.fn(async () => ({ stream: Readable.from([bytes]), mimeType: 'application/pdf', fileName: 'old.pdf' }));

describe('legacy letter attachment scan backfill', () => {
    it('only reports the plan without changing rows in dry-run mode', async () => {
        const download = serving(pdf);
        expect(await backfill(false, download)).toMatchObject({ planned: 1, queued: 0 });
        expect(download).toHaveBeenCalledWith(letterUrl, expect.objectContaining({ throwOnError: true }));
        expect((await rows())[0]).toMatchObject({ sha256: null, malware_scan_status: 'not_required' });
        expect(holder.audit).not.toHaveBeenCalled();
    });

    it('records the stored hash and queues the attachment for the malware scan', async () => {
        expect(await backfill(true, serving(pdf))).toMatchObject({ queued: 1 });
        const [letter, arsip] = await rows();
        expect(letter).toMatchObject({ sha256: pdfHash, integrity_status: 'baseline_recorded', malware_scan_status: 'not_scanned' });
        expect(arsip).toMatchObject({ malware_scan_status: 'clean' });
        expect(holder.audit).toHaveBeenCalledWith(expect.objectContaining({
            entityType: 'file_attachment', entityId: letter.id, userEmail: 'system:letter-attachment-scan-backfill',
        }), expect.anything());
        expect(await backfill(true, serving(pdf))).toMatchObject({ queued: 0, planned: 0 });
    });

    it('leaves the attachment blocked when the stored size no longer matches', async () => {
        expect(await backfill(true, serving(Buffer.concat([pdf, Buffer.from('tampered')])))).toMatchObject({ size_mismatch: 1, queued: 0 });
        expect((await rows())[0]).toMatchObject({ sha256: null, malware_scan_status: 'not_required' });
    });

    it('leaves the attachment blocked when the object cannot be read', async () => {
        expect(await backfill(true, vi.fn(async () => null))).toMatchObject({ unavailable: 1 });
        expect(await backfill(true, vi.fn(async () => { throw new Error('private store offline'); }))).toMatchObject({ failed: 1 });
        expect((await rows())[0]).toMatchObject({ malware_scan_status: 'not_required' });
    });
});
