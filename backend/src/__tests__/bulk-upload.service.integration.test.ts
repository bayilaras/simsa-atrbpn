import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema/index.js';
import { enterTestMigratorRole } from './helpers/database-role-fixture.js';

const databaseHolder = vi.hoisted(() => ({ db: null as any }));
const storageMocks = vi.hoisted(() => ({
    uploadFile: vi.fn(),
    downloadFile: vi.fn(),
    getFile: vi.fn(),
    deleteFile: vi.fn(),
    deleteFileGeneration: vi.fn(),
}));
const ocrMock = vi.hoisted(() => vi.fn());

vi.mock('../config/database.js', () => ({ db: databaseHolder.db }));
vi.mock('../services/blob-storage.service.js', () => ({
    blobStorageService: {
        ...storageMocks,
        uploadUntrustedFile: storageMocks.uploadFile,
    },
}));
vi.mock('../services/ocr.service.js', () => ({
    ocrService: { processPDF: ocrMock },
}));
vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
) as { entries: Array<{ tag: string }> };

let database: PGlite;
let bulkUploadService: import('../services/bulk-upload.service.js').BulkUploadService;
let BulkUploadServiceClass: typeof import('../services/bulk-upload.service.js').BulkUploadService;
let OcrCapacityServiceClass: typeof import('../services/ocr-capacity.service.js').OcrCapacityService;
let arsipElektronikService: typeof import('../services/arsip-elektronik.service.js').arsipElektronikService;
let blobSequence = 0;
const blobObjects = new Map<string, Buffer>();

async function applyMigrations() {
    for (const { tag } of journal.entries) {
        const path = join(migrationsDir, `${tag}.sql`);
        expect(existsSync(path)).toBe(true);
        const statements = readFileSync(path, 'utf8')
            .split('--> statement-breakpoint')
            .map(statement => statement.trim())
            .filter(Boolean);
        for (const statement of statements) await database.exec(statement);
    }
}

beforeAll(async () => {
    database = new PGlite({ extensions: { pgcrypto } });
    await database.waitReady;
    await enterTestMigratorRole(database);
    await applyMigrations();
    databaseHolder.db = drizzle(database, { schema });
    const module = await import('../services/bulk-upload.service.js');
    BulkUploadServiceClass = module.BulkUploadService;
    bulkUploadService = new BulkUploadServiceClass();
    ({ OcrCapacityService: OcrCapacityServiceClass } = await import('../services/ocr-capacity.service.js'));
    ({ arsipElektronikService } = await import('../services/arsip-elektronik.service.js'));
}, 30_000);

beforeEach(async () => {
    await database.exec(`
        TRUNCATE TABLE bulk_upload_batches, file_attachments, arsip, audit_log,
            arsip_elektronik, autentikasi, users, unit_kerja CASCADE;
        UPDATE ocr_capacity_control
        SET max_concurrency = 2,
            lease_duration_seconds = 360,
            retry_after_seconds = 5,
            updated_at = now()
        WHERE singleton_id = 1;
        INSERT INTO unit_kerja (id, name) VALUES ('unit-durable', 'Unit Durable');
        INSERT INTO users (id, email, role, unit_kerja_id)
        VALUES (
            '10000000-0000-4000-8000-000000000001',
            'bulk-owner@example.test',
            'staff',
            'unit-durable'
        );
    `);
    vi.clearAllMocks();
    blobObjects.clear();
    blobSequence = 0;
    storageMocks.uploadFile.mockImplementation(async ({ fileName, buffer }: any) => {
        const url = `https://fixture.private.blob.vercel-storage.com/${++blobSequence}-${fileName}`;
        blobObjects.set(url, Buffer.from(buffer));
        return { url, id: url, downloadUrl: url, name: fileName, mimeType: 'application/pdf', size: buffer.length };
    });
    storageMocks.downloadFile.mockImplementation(async (url: string) => {
        const buffer = blobObjects.get(url);
        return buffer ? {
            stream: Readable.from([buffer]),
            mimeType: 'application/pdf',
            fileName: 'record.pdf',
        } : null;
    });
    storageMocks.getFile.mockImplementation(async (url: string) => {
        const buffer = blobObjects.get(url);
        return buffer ? { url, size: buffer.length, mimeType: 'application/pdf', name: 'record.pdf' } : null;
    });
    storageMocks.deleteFile.mockImplementation(async (url: string) => blobObjects.delete(url));
    storageMocks.deleteFileGeneration.mockImplementation(async (url: string) => blobObjects.delete(url));
    ocrMock.mockResolvedValue({
        success: true,
        text: 'Nomor: 1 Perihal: Arsip durable',
        metadata: {
            nomorSurat: '1/DURABLE/2026',
            perihal: 'Arsip durable',
            tanggalSurat: '2026-08-28',
            pengirim: 'Unit Durable',
            extractedText: 'Isi arsip durable',
            penerima: null,
            tembusan: [],
            lampiran: null,
            sifatSurat: null,
            klasifikasiKeamanan: null,
            jenisSurat: null,
            keywords: ['durable'],
            summary: null,
        },
    });
});

afterAll(async () => {
    await database.close();
});

function pdfFile(name = 'record.pdf') {
    return {
        fileName: name,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 durable bulk source'),
    };
}

describe('BulkUploadService durable lifecycle', () => {
    it('requires the PDF header at byte zero', () => {
        expect(bulkUploadService.validateFiles([{
            fileName: 'prepended.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('junk%PDF-1.4'),
        }])).toMatchObject({ valid: false });
    });

    it('returns the newest unexpired resumable batch for exactly one owner and unit', async () => {
        const owner = '10000000-0000-4000-8000-000000000001';
        const older = await bulkUploadService.createBatch(
            [pdfFile('older.pdf')],
            'unit-durable',
            owner,
        );
        await database.exec(`
            UPDATE bulk_upload_batches
            SET created_at = '2026-08-27T00:00:00Z'
            WHERE id = '${older.batchId}';
            INSERT INTO bulk_upload_batches (
                id, unit_kerja_id, created_by, status, total_files,
                processed_files, expires_at, confirmed_at, created_at
            ) VALUES (
                '21000000-0000-4000-8000-000000000001', 'unit-durable', '${owner}',
                'expired', 1, 0, now() - interval '1 minute', null, '2026-08-28T00:00:00Z'
            ), (
                '21000000-0000-4000-8000-000000000002', 'unit-durable', '${owner}',
                'confirmed', 1, 1, now() + interval '1 day', now(), '2026-08-28T01:00:00Z'
            );
        `);

        await expect(
            bulkUploadService.getLatestActiveBatch(owner, 'unit-durable'),
        ).resolves.toMatchObject({ batchId: older.batchId, createdBy: owner });
        await expect(
            bulkUploadService.getLatestActiveBatch(
                '20000000-0000-4000-8000-000000000002',
                'unit-durable',
            ),
        ).resolves.toBeNull();
        await expect(
            bulkUploadService.getLatestActiveBatch(owner, 'unit-lain'),
        ).resolves.toBeNull();

        await database.exec(`
            UPDATE bulk_upload_batches
            SET expires_at = now() - interval '1 minute'
            WHERE id = '${older.batchId}'
        `);
        await expect(
            bulkUploadService.getLatestActiveBatch(owner, 'unit-durable'),
        ).resolves.toBeNull();
    });

    it('enforces one active batch per owner/unit and releases an expired batch safely', async () => {
        const owner = '10000000-0000-4000-8000-000000000001';
        const first = await bulkUploadService.createBatch(
            [pdfFile('first.pdf')],
            'unit-durable',
            owner,
        );
        storageMocks.uploadFile.mockClear();

        await expect(bulkUploadService.createBatch(
            [pdfFile('second.pdf')],
            'unit-durable',
            owner,
        )).rejects.toMatchObject({
            statusCode: 409,
            activeBatchId: first.batchId,
        });
        expect(storageMocks.uploadFile).not.toHaveBeenCalled();

        await database.exec(`
            UPDATE bulk_upload_batches
            SET expires_at = now() - interval '1 minute'
            WHERE id = '${first.batchId}'
        `);
        const replacement = await bulkUploadService.createBatch(
            [pdfFile('replacement.pdf')],
            'unit-durable',
            owner,
        );
        expect(replacement.batchId).not.toBe(first.batchId);
        expect(storageMocks.deleteFile).toHaveBeenCalled();

        const statuses = await database.query<{ id: string; status: string }>(`
            SELECT id, status FROM bulk_upload_batches
            WHERE created_by = '${owner}' AND unit_kerja_id = 'unit-durable'
            ORDER BY created_at
        `);
        expect(statuses.rows).toEqual(expect.arrayContaining([
            { id: first.batchId, status: 'expired' },
            { id: replacement.batchId, status: 'pending' },
        ]));
    });

    it('rejects an aggregate batch above 100 MB before object storage', () => {
        const pretendPdf = (length: number) => ({
            length,
            subarray: () => Buffer.from('%PDF-'),
        }) as unknown as Buffer;
        const result = bulkUploadService.validateFiles([
            { fileName: 'one.pdf', mimeType: 'application/pdf', buffer: pretendPdf(50 * 1024 * 1024) },
            { fileName: 'two.pdf', mimeType: 'application/pdf', buffer: pretendPdf(50 * 1024 * 1024) },
            { fileName: 'three.pdf', mimeType: 'application/pdf', buffer: pretendPdf(1) },
        ]);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Ukuran total satu batch tidak boleh melebihi 100 MB.');
        expect(storageMocks.uploadFile).not.toHaveBeenCalled();
    });

    it('recovers OCR from private Blob and atomically registers the confirmed attachment', async () => {
        const batch = await bulkUploadService.createBatch(
            [pdfFile()],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );
        expect(batch.status).toBe('pending');
        expect(storageMocks.uploadFile).toHaveBeenCalledOnce();

        const processed = await bulkUploadService.processBatch(batch.batchId);
        expect(processed.status).toBe('completed');
        expect(processed.items[0]).toMatchObject({ status: 'completed', progress: 100 });
        expect(storageMocks.downloadFile).toHaveBeenCalledOnce();
        expect(ocrMock).toHaveBeenCalledWith(pdfFile().buffer, expect.any(AbortSignal));

        const confirmation = await bulkUploadService.confirmBatch(batch.batchId, [{
            itemId: processed.items[0].id,
            nomorBerkas: 'BERKAS-001',
            uraianBerkas: 'Arsip hasil bulk upload',
            kodeKlasifikasi: 'UM.01',
            tahun: 2026,
            jenisArsip: 'masuk',
        }], {
            userId: '10000000-0000-4000-8000-000000000001',
            userEmail: 'bulk-owner@example.test',
            ipAddress: '127.0.0.1',
        });
        expect(confirmation).toMatchObject({ created: 1, failed: 0 });

        const persisted = await database.query<{
            batch_status: string;
            item_status: string;
            file_url: string;
            entity_type: string;
        }>(`
            SELECT b.status AS batch_status, i.status AS item_status,
                   f.file_url, f.entity_type
            FROM bulk_upload_batches b
            JOIN bulk_upload_items i ON i.batch_id = b.id
            JOIN file_attachments f ON f.entity_id = i.arsip_id
            WHERE b.id = '${batch.batchId}'
        `);
        expect(persisted.rows).toEqual([expect.objectContaining({
            batch_status: 'confirmed',
            item_status: 'confirmed',
            entity_type: 'arsip',
        })]);
        expect(blobObjects.has(persisted.rows[0].file_url)).toBe(true);

        const audit = await database.query<{ count: number }>(`
            SELECT count(*)::int AS count FROM audit_log
            WHERE entity_type = 'arsip'
              AND action = 'create'
              AND entity_id = '${confirmation.arsipIds[0]}'
        `);
        expect(audit.rows).toEqual([{ count: 1 }]);

        await bulkUploadService.cleanupOldBatches(-1);
        expect(storageMocks.deleteFile).not.toHaveBeenCalled();
    });

    it('pins a GCS source generation through OCR preflight and attachment confirmation', async () => {
        const locator = 'gs://simsa-upload/bulk-upload/pinned-record.pdf';
        const generation = '1735689600123456';
        storageMocks.uploadFile.mockImplementationOnce(async ({ fileName, buffer }: any) => {
            blobObjects.set(locator, Buffer.from(buffer));
            return {
                url: locator,
                generation,
                id: locator,
                name: fileName,
                mimeType: 'application/pdf',
                size: buffer.length,
            };
        });
        const batch = await bulkUploadService.createBatch(
            [pdfFile('pinned-record.pdf')],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );

        const storedItem = await database.query<{
            id: string;
            blob_url: string;
            object_generation: string | null;
        }>(`
            SELECT id, blob_url, object_generation
            FROM bulk_upload_items
            WHERE batch_id = '${batch.batchId}'
        `);
        expect(storedItem.rows).toEqual([expect.objectContaining({
            blob_url: locator,
            object_generation: generation,
        })]);

        const processed = await bulkUploadService.processBatch(batch.batchId);
        expect(storageMocks.downloadFile).toHaveBeenCalledWith(locator, {
            generation,
        });
        const confirmation = await bulkUploadService.confirmBatch(batch.batchId, [{
            itemId: processed.items[0].id,
            tahun: 2026,
            jenisArsip: 'masuk',
        }], {
            userId: '10000000-0000-4000-8000-000000000001',
        });
        expect(storageMocks.getFile).toHaveBeenCalledWith(locator, { generation });

        const attachment = await database.query<{
            file_url: string;
            object_generation: string | null;
        }>(`
            SELECT file_url, object_generation
            FROM file_attachments
            WHERE entity_id = '${confirmation.arsipIds[0]}'
        `);
        expect(attachment.rows).toEqual([{ file_url: locator, object_generation: generation }]);
    });

    it('enforces one global OCR slot across service instances without failing the waiting item', async () => {
        const secondOwner = '10000000-0000-4000-8000-000000000002';
        await database.exec(`
            UPDATE ocr_capacity_control
            SET max_concurrency = 1, retry_after_seconds = 7
            WHERE singleton_id = 1;
            INSERT INTO users (id, email, role, unit_kerja_id)
            VALUES ('${secondOwner}', 'bulk-owner-2@example.test', 'staff', 'unit-durable');
        `);

        const firstBatch = await bulkUploadService.createBatch(
            [pdfFile('first-capacity.pdf')],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );
        const secondBatch = await bulkUploadService.createBatch(
            [pdfFile('second-capacity.pdf')],
            'unit-durable',
            secondOwner,
        );

        let signalOcrStarted!: () => void;
        let finishFirstOcr!: () => void;
        const ocrStarted = new Promise<void>((resolve) => { signalOcrStarted = resolve; });
        const holdFirstOcr = new Promise<void>((resolve) => { finishFirstOcr = resolve; });
        const successfulResult = {
            success: true,
            text: 'Nomor: 1 Perihal: Arsip durable',
            metadata: {
                nomorSurat: '1/DURABLE/2026',
                perihal: 'Arsip durable',
                tanggalSurat: '2026-08-28',
                extractedText: 'Isi arsip durable',
            },
        };
        ocrMock.mockImplementationOnce(async () => {
            signalOcrStarted();
            await holdFirstOcr;
            return successfulResult;
        });

        const firstInstance = new BulkUploadServiceClass();
        const secondInstance = new BulkUploadServiceClass();
        const firstProcessing = firstInstance.processBatch(firstBatch.batchId, 1);
        await ocrStarted;

        await expect(secondInstance.processBatch(secondBatch.batchId, 1))
            .rejects.toMatchObject({ statusCode: 503, retryAfterSeconds: 7 });

        const waitingItem = await database.query<{
            id: string;
            status: string;
            progress: number;
            error: string | null;
        }>(`
            SELECT id, status, progress, error
            FROM bulk_upload_items
            WHERE batch_id = '${secondBatch.batchId}'
        `);
        expect(waitingItem.rows).toEqual([expect.objectContaining({
            status: 'pending',
            progress: 0,
            error: null,
        })]);

        const activeLease = await database.query<{ token: string; item_id: string }>(`
            SELECT token, item_id FROM ocr_processing_leases
        `);
        expect(activeLease.rows).toHaveLength(1);

        // A guessed token cannot release another process's active capacity.
        const capacityService = new OcrCapacityServiceClass();
        await expect(capacityService.release({
            itemId: activeLease.rows[0].item_id,
            token: '00000000-0000-4000-8000-000000000099',
        })).resolves.toBe(false);
        await expect(database.query<{ count: number }>(`
            SELECT count(*)::int AS count FROM ocr_processing_leases
        `)).resolves.toMatchObject({ rows: [{ count: 1 }] });

        finishFirstOcr();
        await expect(firstProcessing).resolves.toMatchObject({ status: 'completed' });
        await expect(database.query<{ count: number }>(`
            SELECT count(*)::int AS count FROM ocr_processing_leases
        `)).resolves.toMatchObject({ rows: [{ count: 0 }] });

        await expect(secondInstance.processBatch(secondBatch.batchId, 1))
            .resolves.toMatchObject({ status: 'completed' });
    });

    it('renews the token-owned global lease throughout Blob download and OCR', async () => {
        await database.exec(`
            UPDATE ocr_capacity_control
            SET max_concurrency = 1, lease_duration_seconds = 240
            WHERE singleton_id = 1
        `);
        const batch = await bulkUploadService.createBatch(
            [pdfFile('renewed-capacity.pdf')],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );
        const source = pdfFile('renewed-capacity.pdf').buffer;
        const delayedStream = new Readable({ read() {} });
        storageMocks.downloadFile.mockResolvedValueOnce({
            stream: delayedStream,
            mimeType: 'application/pdf',
            fileName: 'renewed-capacity.pdf',
        });

        let signalOcrStarted!: () => void;
        let finishOcr!: () => void;
        const ocrStarted = new Promise<void>((resolve) => { signalOcrStarted = resolve; });
        const holdOcr = new Promise<void>((resolve) => { finishOcr = resolve; });
        ocrMock.mockImplementationOnce(async () => {
            signalOcrStarted();
            await holdOcr;
            return {
                success: true,
                text: 'renewed result',
                metadata: { nomorSurat: 'RENEWED/2026', extractedText: 'renewed result' },
            };
        });

        const coordinator = new OcrCapacityServiceClass();
        const renew = vi.spyOn(coordinator, 'renew');
        const service = new BulkUploadServiceClass({
            capacityCoordinator: coordinator,
            capacityRenewIntervalMs: 10,
            blobDownloadTimeoutMs: 2_000,
        });
        const processing = service.processBatch(batch.batchId, 1);

        await vi.waitFor(() => expect(renew.mock.calls.length).toBeGreaterThanOrEqual(1));
        delayedStream.push(source);
        delayedStream.push(null);
        await ocrStarted;
        const renewalsBeforeHeldOcr = renew.mock.calls.length;
        await vi.waitFor(() => {
            expect(renew.mock.calls.length).toBeGreaterThan(renewalsBeforeHeldOcr);
        });

        finishOcr();
        await expect(processing).resolves.toMatchObject({ status: 'completed' });
        expect(renew.mock.calls.length).toBeGreaterThanOrEqual(3);
        expect(renew.mock.calls.every(([lease]) => (
            lease.itemId === batch.items[0].id && typeof lease.token === 'string'
        ))).toBe(true);
    });

    it('aborts active OCR on renew-null and releases capacity only after OCR cleanup', async () => {
        const batch = await bulkUploadService.createBatch(
            [pdfFile('ownership-loss.pdf')],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );
        let allowRenewal!: () => void;
        const renewalGate = new Promise<void>((resolve) => { allowRenewal = resolve; });
        const release = vi.fn(async () => true);
        const coordinator = {
            async acquire(itemId: string) {
                const acquiredAt = new Date();
                return {
                    acquired: true as const,
                    lease: {
                        itemId,
                        token: '00000000-0000-4000-8000-000000000071',
                        acquiredAt,
                        leaseExpiresAt: new Date(acquiredAt.getTime() + 360_000),
                    },
                };
            },
            renew: vi.fn(async () => {
                await renewalGate;
                return null;
            }),
            release,
        };
        let signalOcrStarted!: () => void;
        let signalOcrAborted!: () => void;
        let finishOcrCleanup!: () => void;
        const ocrStarted = new Promise<void>((resolve) => { signalOcrStarted = resolve; });
        const ocrAborted = new Promise<void>((resolve) => { signalOcrAborted = resolve; });
        const holdOcrCleanup = new Promise<void>((resolve) => { finishOcrCleanup = resolve; });
        ocrMock.mockImplementationOnce(async (_buffer: Buffer, signal: AbortSignal) => {
            signalOcrStarted();
            await new Promise<void>((resolve) => {
                const onAbort = () => {
                    signalOcrAborted();
                    resolve();
                };
                if (signal.aborted) onAbort();
                else signal.addEventListener('abort', onAbort, { once: true });
            });
            await holdOcrCleanup;
            throw signal.reason;
        });
        const service = new BulkUploadServiceClass({
            capacityCoordinator: coordinator,
            capacityRenewIntervalMs: 10,
        });

        const processing = service.processBatch(batch.batchId, 1);
        await ocrStarted;
        allowRenewal();
        await ocrAborted;
        expect(release).not.toHaveBeenCalled();

        finishOcrCleanup();
        const result = await processing;
        expect(result.items[0]).toMatchObject({ status: 'pending', progress: 0 });
        expect(release).toHaveBeenCalledOnce();
    });

    it('fences cancel-vs-process, protects the leased Blob, and keeps the slot until abort cleanup', async () => {
        const secondOwner = '10000000-0000-4000-8000-000000000002';
        await database.exec(`
            UPDATE ocr_capacity_control SET max_concurrency = 1 WHERE singleton_id = 1;
            INSERT INTO users (id, email, role, unit_kerja_id)
            VALUES ('${secondOwner}', 'bulk-cancel-waiter@example.test', 'staff', 'unit-durable');
        `);
        const activeBatch = await bulkUploadService.createBatch(
            [pdfFile('cancel-active.pdf')],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );
        const waitingBatch = await bulkUploadService.createBatch(
            [pdfFile('cancel-waiting.pdf')],
            'unit-durable',
            secondOwner,
        );
        const [activeBlob] = (await database.query<{ blob_url: string }>(`
            SELECT blob_url FROM bulk_upload_items WHERE batch_id = '${activeBatch.batchId}'
        `)).rows;
        let signalOcrStarted!: () => void;
        let signalOcrAborted!: () => void;
        let finishOcrCleanup!: () => void;
        const ocrStarted = new Promise<void>((resolve) => { signalOcrStarted = resolve; });
        const ocrAborted = new Promise<void>((resolve) => { signalOcrAborted = resolve; });
        const holdOcrCleanup = new Promise<void>((resolve) => { finishOcrCleanup = resolve; });
        ocrMock.mockImplementationOnce(async (_buffer: Buffer, signal: AbortSignal) => {
            signalOcrStarted();
            await new Promise<void>((resolve) => {
                const onAbort = () => {
                    signalOcrAborted();
                    resolve();
                };
                if (signal.aborted) onAbort();
                else signal.addEventListener('abort', onAbort, { once: true });
            });
            await holdOcrCleanup;
            throw signal.reason;
        });
        const coordinator = new OcrCapacityServiceClass();
        const service = new BulkUploadServiceClass({
            capacityCoordinator: coordinator,
            capacityRenewIntervalMs: 10,
        });

        const processing = service.processBatch(activeBatch.batchId, 1);
        await ocrStarted;
        const cleanup = await service.cancelBatch(activeBatch.batchId);
        expect(cleanup).toMatchObject({ blobsDeleted: 0, blobsProtected: 1 });
        expect(blobObjects.has(activeBlob.blob_url)).toBe(true);
        expect(storageMocks.deleteFile).not.toHaveBeenCalledWith(activeBlob.blob_url);
        await ocrAborted;

        const duringCleanup = await coordinator.acquire(waitingBatch.items[0].id);
        expect(duringCleanup).toMatchObject({ acquired: false });
        await expect(database.query<{ count: number }>(`
            SELECT count(*)::int AS count FROM ocr_processing_leases
        `)).resolves.toMatchObject({ rows: [{ count: 1 }] });

        finishOcrCleanup();
        const cancelled = await processing;
        expect(cancelled.status).toBe('expired');
        expect(cancelled.items[0].status).not.toBe('completed');
        await expect(database.query<{ count: number }>(`
            SELECT count(*)::int AS count FROM ocr_processing_leases
        `)).resolves.toMatchObject({ rows: [{ count: 0 }] });

        const afterCleanup = await coordinator.acquire(waitingBatch.items[0].id);
        expect(afterCleanup).toMatchObject({ acquired: true });
        if (afterCleanup.acquired) await coordinator.release(afterCleanup.lease);
    });

    it('fences a stale OCR completion after a newer item claim finishes', async () => {
        const batch = await bulkUploadService.createBatch(
            [pdfFile('fenced-result.pdf')],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );
        let tokenSequence = 0;
        const permissiveCoordinator = {
            async acquire(itemId: string) {
                tokenSequence += 1;
                const acquiredAt = new Date();
                return {
                    acquired: true as const,
                    lease: {
                        itemId,
                        token: `00000000-0000-4000-8000-${String(tokenSequence).padStart(12, '0')}`,
                        acquiredAt,
                        leaseExpiresAt: new Date(acquiredAt.getTime() + 360_000),
                    },
                };
            },
            async renew(lease: { itemId: string; token: string }) {
                const acquiredAt = new Date();
                return {
                    ...lease,
                    acquiredAt,
                    leaseExpiresAt: new Date(acquiredAt.getTime() + 360_000),
                };
            },
            async release() { return true; },
        };

        let signalFirstOcrStarted!: () => void;
        let finishFirstOcr!: () => void;
        const firstOcrStarted = new Promise<void>((resolve) => { signalFirstOcrStarted = resolve; });
        const holdFirstOcr = new Promise<void>((resolve) => { finishFirstOcr = resolve; });
        let invocation = 0;
        ocrMock.mockImplementation(async () => {
            invocation += 1;
            if (invocation === 1) {
                signalFirstOcrStarted();
                await holdFirstOcr;
                return {
                    success: true,
                    text: 'stale result',
                    metadata: { nomorSurat: 'STALE/2026', extractedText: 'stale result' },
                };
            }
            return {
                success: true,
                text: 'fresh result',
                metadata: { nomorSurat: 'FRESH/2026', extractedText: 'fresh result' },
            };
        });

        const firstService = new BulkUploadServiceClass({
            capacityCoordinator: permissiveCoordinator,
            capacityRenewIntervalMs: 60_000,
        });
        const secondService = new BulkUploadServiceClass({
            capacityCoordinator: permissiveCoordinator,
            capacityRenewIntervalMs: 60_000,
        });
        const firstProcessing = firstService.processBatch(batch.batchId, 1);
        await firstOcrStarted;
        await database.exec(`
            UPDATE bulk_upload_items
            SET processing_started_at = now() - interval '10 minutes'
            WHERE id = '${batch.items[0].id}'
        `);

        await expect(secondService.processBatch(batch.batchId, 1))
            .resolves.toMatchObject({ status: 'completed' });
        finishFirstOcr();
        await expect(firstProcessing).resolves.toMatchObject({ status: 'completed' });

        const persisted = await database.query<{ status: string; metadata: Record<string, unknown> }>(`
            SELECT status, metadata FROM bulk_upload_items WHERE id = '${batch.items[0].id}'
        `);
        expect(persisted.rows[0]).toMatchObject({
            status: 'completed',
            metadata: { nomorSurat: 'FRESH/2026', extractedText: 'fresh result' },
        });
    });

    it('bounds a stalled private Blob stream and releases OCR capacity', async () => {
        const batch = await bulkUploadService.createBatch(
            [pdfFile('stalled-download.pdf')],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );
        const stalledStream = new Readable({ read() {} });
        storageMocks.downloadFile.mockResolvedValueOnce({
            stream: stalledStream,
            mimeType: 'application/pdf',
            fileName: 'stalled-download.pdf',
        });
        const service = new BulkUploadServiceClass({
            blobDownloadTimeoutMs: 25,
            capacityRenewIntervalMs: 10,
        });

        const processed = await service.processBatch(batch.batchId, 1);

        expect(processed).toMatchObject({
            status: 'partial',
            items: [expect.objectContaining({
                status: 'failed',
                error: 'Waktu pengunduhan bitstream sumber habis',
            })],
        });
        expect(stalledStream.destroyed).toBe(true);
        expect(ocrMock).not.toHaveBeenCalled();
        await expect(database.query<{ count: number }>(`
            SELECT count(*)::int AS count FROM ocr_processing_leases
        `)).resolves.toMatchObject({ rows: [{ count: 0 }] });
    });

    it('reclaims an expired OCR lease using database time', async () => {
        const batch = await bulkUploadService.createBatch(
            [pdfFile('expired-capacity.pdf')],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );
        const [item] = (await database.query<{ id: string }>(`
            SELECT id FROM bulk_upload_items WHERE batch_id = '${batch.batchId}'
        `)).rows;
        await database.exec(`
            UPDATE ocr_capacity_control SET max_concurrency = 1 WHERE singleton_id = 1;
            INSERT INTO ocr_processing_leases (token, item_id, acquired_at, lease_expires_at)
            VALUES (
                '00000000-0000-4000-8000-000000000088', '${item.id}',
                now() - interval '10 minutes', now() - interval '1 minute'
            );
        `);

        const capacityService = new OcrCapacityServiceClass();
        const acquired = await capacityService.acquire(item.id);
        expect(acquired).toMatchObject({ acquired: true });
        if (!acquired.acquired) throw new Error('Expected reclaimed OCR capacity');
        expect(acquired.lease.token).not.toBe('00000000-0000-4000-8000-000000000088');
        await expect(capacityService.release(acquired.lease)).resolves.toBe(true);
    });

    it('renews only a live OCR lease with the exact item/token pair', async () => {
        const batch = await bulkUploadService.createBatch(
            [pdfFile('token-renewal.pdf')],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );
        const capacityService = new OcrCapacityServiceClass();
        const acquired = await capacityService.acquire(batch.items[0].id);
        if (!acquired.acquired) throw new Error('Expected OCR capacity');
        await database.exec(`
            UPDATE bulk_upload_items
            SET status = 'processing', processing_started_at = now()
            WHERE id = '${batch.items[0].id}'
        `);

        await expect(capacityService.renew({
            itemId: acquired.lease.itemId,
            token: '00000000-0000-4000-8000-000000000099',
        })).resolves.toBeNull();
        await database.exec(`
            UPDATE ocr_processing_leases
            SET lease_expires_at = now() + interval '30 seconds'
            WHERE token = '${acquired.lease.token}'
        `);
        const renewed = await capacityService.renew(acquired.lease);
        expect(renewed?.token).toBe(acquired.lease.token);
        expect(renewed!.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now() + 200_000);
        await expect(capacityService.release(acquired.lease)).resolves.toBe(true);
    });

    it('compensates every uploaded object if durable batch persistence fails', async () => {
        const transaction = vi.spyOn(databaseHolder.db, 'transaction')
            .mockRejectedValueOnce(new Error('database unavailable'));

        await expect(bulkUploadService.createBatch(
            [pdfFile()],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        )).rejects.toThrow('database unavailable');
        expect(storageMocks.deleteFile).toHaveBeenCalledOnce();
        expect(blobObjects.size).toBe(0);
        transaction.mockRestore();
    });

    it('compensates only the exact GCS generation if durable batch persistence fails', async () => {
        const locator = 'gs://simsa-upload/bulk-upload/request-created.pdf';
        const generation = '1735689600123456';
        storageMocks.uploadFile.mockResolvedValueOnce({
            url: locator,
            generation,
            id: locator,
            name: 'request-created.pdf',
            mimeType: 'application/pdf',
            size: pdfFile().buffer.length,
        });
        const transaction = vi.spyOn(databaseHolder.db, 'transaction')
            .mockRejectedValueOnce(new Error('database unavailable'));

        await expect(bulkUploadService.createBatch(
            [pdfFile()],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        )).rejects.toThrow('database unavailable');
        expect(storageMocks.deleteFileGeneration).toHaveBeenCalledWith(locator, generation);
        expect(storageMocks.deleteFile).not.toHaveBeenCalled();
        transaction.mockRestore();
    });

    it('uses the exact GCS generation when cancelling an unconfirmed batch', async () => {
        const locator = 'gs://simsa-upload/bulk-upload/cancelled.pdf';
        const generation = '1735689600123456';
        storageMocks.uploadFile.mockImplementationOnce(async ({ fileName, buffer }: any) => {
            blobObjects.set(locator, Buffer.from(buffer));
            return {
                url: locator,
                generation,
                id: locator,
                name: fileName,
                mimeType: 'application/pdf',
                size: buffer.length,
            };
        });
        const batch = await bulkUploadService.createBatch(
            [pdfFile('cancelled.pdf')],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );

        await bulkUploadService.cancelBatch(batch.batchId);

        expect(storageMocks.deleteFileGeneration).toHaveBeenCalledWith(locator, generation);
        expect(storageMocks.deleteFile).not.toHaveBeenCalled();
    });

    it('deletes expired unconfirmed sources but never an object referenced by an archive', async () => {
        const secondOwner = '10000000-0000-4000-8000-000000000002';
        await database.exec(`
            INSERT INTO users (id, email, role, unit_kerja_id)
            VALUES ('${secondOwner}', 'bulk-owner-2@example.test', 'staff', 'unit-durable')
        `);
        const disposable = await bulkUploadService.createBatch(
            [pdfFile('disposable.pdf')],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );
        const protectedBatch = await bulkUploadService.createBatch(
            [pdfFile('protected.pdf')],
            'unit-durable',
            secondOwner,
        );
        const protectedLocator = (await database.query<{ blob_url: string }>(`
            SELECT blob_url FROM bulk_upload_items WHERE batch_id = '${protectedBatch.batchId}'
        `)).rows[0].blob_url;
        const archiveId = '40000000-0000-4000-8000-000000000001';
        await database.exec(`
            INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, created_by)
            VALUES (
                '${archiveId}', 'unit-durable', 'masuk', 2026,
                '10000000-0000-4000-8000-000000000001'
            );
            INSERT INTO file_attachments (
                entity_type, entity_id, file_name, file_url, drive_file_id,
                mime_type, size_bytes, sha256, storage_access
            ) VALUES (
                'arsip', '${archiveId}', 'protected.pdf', '${protectedLocator}', '${protectedLocator}',
                'application/pdf', 28, repeat('a', 64), 'private'
            );
        `);

        await bulkUploadService.cleanupOldBatches(-1);

        const disposableCount = await database.query<{ count: number; expired_count: number }>(`
            SELECT count(*)::int AS count,
                   count(*) FILTER (WHERE status = 'expired')::int AS expired_count
            FROM bulk_upload_batches
            WHERE id IN ('${disposable.batchId}', '${protectedBatch.batchId}')
        `);
        expect(disposableCount.rows).toEqual([{ count: 2, expired_count: 2 }]);
        expect(blobObjects.has(protectedLocator)).toBe(true);
        expect(storageMocks.deleteFile).not.toHaveBeenCalledWith(protectedLocator);
        expect(storageMocks.deleteFile).toHaveBeenCalledTimes(1);
    });

    it('keeps an expired tombstone and retries a failed object deletion', async () => {
        const batch = await bulkUploadService.createBatch(
            [pdfFile('retry.pdf')],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );
        storageMocks.deleteFile.mockResolvedValueOnce(false);

        await bulkUploadService.cleanupOldBatches(-1);
        let tombstone = await database.query<{ status: string; blob_deleted_at: Date | null }>(`
            SELECT b.status, i.blob_deleted_at
            FROM bulk_upload_batches b
            JOIN bulk_upload_items i ON i.batch_id = b.id
            WHERE b.id = '${batch.batchId}'
        `);
        expect(tombstone.rows).toEqual([{ status: 'expired', blob_deleted_at: null }]);

        storageMocks.deleteFile.mockImplementationOnce(async (url: string) => blobObjects.delete(url));
        await bulkUploadService.cleanupOldBatches(-1);
        tombstone = await database.query<{ status: string; blob_deleted_at: Date | null }>(`
            SELECT b.status, i.blob_deleted_at
            FROM bulk_upload_batches b
            JOIN bulk_upload_items i ON i.batch_id = b.id
            WHERE b.id = '${batch.batchId}'
        `);
        expect(tombstone.rows[0].status).toBe('expired');
        expect(tombstone.rows[0].blob_deleted_at).not.toBeNull();
        expect(storageMocks.deleteFile).toHaveBeenCalledTimes(2);
    });

    it('cancels an unconfirmed batch, keeps its tombstone, and deletes unreferenced sources', async () => {
        const batch = await bulkUploadService.createBatch(
            [pdfFile('cancelled.pdf')],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );

        const cleanup = await bulkUploadService.cancelBatch(batch.batchId);
        const persisted = await database.query<{ status: string; blob_deleted_at: Date | null }>(`
            SELECT b.status, i.blob_deleted_at
            FROM bulk_upload_batches b
            JOIN bulk_upload_items i ON i.batch_id = b.id
            WHERE b.id = '${batch.batchId}'
        `);

        expect(cleanup).toMatchObject({ batchesExpired: 1, blobsDeleted: 1, blobsFailed: 0 });
        expect(persisted.rows[0].status).toBe('expired');
        expect(persisted.rows[0].blob_deleted_at).not.toBeNull();
    });

    it('keeps a mixed batch partial and cleans only its failed, unreferenced source', async () => {
        const batch = await bulkUploadService.createBatch(
            [pdfFile('confirmed.pdf'), pdfFile('failed.pdf')],
            'unit-durable',
            '10000000-0000-4000-8000-000000000001',
        );
        ocrMock
            .mockResolvedValueOnce({
                success: true,
                metadata: {
                    nomorSurat: '1/MIXED/2026',
                    perihal: 'Confirmed source',
                    tanggalSurat: '2026-08-28',
                    extractedText: 'Confirmed source',
                },
            })
            .mockResolvedValueOnce({ success: false, error: 'OCR unreadable' });
        const processed = await bulkUploadService.processBatch(batch.batchId);
        const completed = processed.items.find(item => item.status === 'completed')!;

        await bulkUploadService.confirmBatch(batch.batchId, [{
            itemId: completed.id,
            tahun: 2026,
            jenisArsip: 'masuk',
        }], {
            userId: '10000000-0000-4000-8000-000000000001',
        });

        const beforeCleanup = await database.query<{
            batch_status: string;
            item_status: string;
            blob_url: string;
        }>(`
            SELECT b.status AS batch_status, i.status AS item_status, i.blob_url
            FROM bulk_upload_batches b
            JOIN bulk_upload_items i ON i.batch_id = b.id
            WHERE b.id = '${batch.batchId}'
            ORDER BY i.status
        `);
        expect(beforeCleanup.rows.every(row => row.batch_status === 'partial')).toBe(true);
        const confirmedLocator = beforeCleanup.rows.find(row => row.item_status === 'confirmed')!.blob_url;
        const failedLocator = beforeCleanup.rows.find(row => row.item_status === 'failed')!.blob_url;

        const cleanup = await bulkUploadService.cleanupOldBatches(-1);

        expect(cleanup).toMatchObject({ blobsDeleted: 1, blobsProtected: 1, blobsFailed: 0 });
        expect(blobObjects.has(confirmedLocator)).toBe(true);
        expect(blobObjects.has(failedLocator)).toBe(false);
    });
});

describe('Autentikasi picker eligibility', () => {
    it('returns only immutable, unlinked records backed by private verified clean attachments', async () => {
        await database.exec(`
            INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, created_by) VALUES
                ('41000000-0000-4000-8000-000000000001', 'unit-durable', 'masuk', 2026, '10000000-0000-4000-8000-000000000001'),
                ('41000000-0000-4000-8000-000000000002', 'unit-durable', 'masuk', 2026, '10000000-0000-4000-8000-000000000001'),
                ('41000000-0000-4000-8000-000000000003', 'unit-durable', 'masuk', 2026, '10000000-0000-4000-8000-000000000001');
            INSERT INTO file_attachments (
                id, entity_type, entity_id, file_name, file_url, mime_type,
                size_bytes, sha256, storage_access, integrity_status, malware_scan_status
            ) VALUES
                (
                    '42000000-0000-4000-8000-000000000001', 'arsip',
                    '41000000-0000-4000-8000-000000000001', 'eligible.pdf',
                    'https://fixture.private.blob.vercel-storage.com/eligible.pdf', 'application/pdf',
                    12, repeat('a', 64), 'private', 'verified', 'clean'
                ),
                (
                    '42000000-0000-4000-8000-000000000002', 'arsip',
                    '41000000-0000-4000-8000-000000000002', 'public.pdf',
                    'https://fixture.public.blob.vercel-storage.com/public.pdf', 'application/pdf',
                    12, repeat('b', 64), 'public', 'verified', 'clean'
                ),
                (
                    '42000000-0000-4000-8000-000000000003', 'arsip',
                    '41000000-0000-4000-8000-000000000003', 'unscanned.pdf',
                    'https://fixture.private.blob.vercel-storage.com/unscanned.pdf', 'application/pdf',
                    12, repeat('c', 64), 'private', 'verified', 'not_scanned'
                );
            INSERT INTO arsip_elektronik (
                id, arsip_id, file_attachment_id, format_file, hash_sha256,
                status_verifikasi, immutable
            ) VALUES
                (
                    '43000000-0000-4000-8000-000000000001',
                    '41000000-0000-4000-8000-000000000001',
                    '42000000-0000-4000-8000-000000000001', 'PDF', repeat('a', 64),
                    'verified', true
                ),
                (
                    '43000000-0000-4000-8000-000000000002',
                    '41000000-0000-4000-8000-000000000002',
                    '42000000-0000-4000-8000-000000000002', 'PDF', repeat('b', 64),
                    'verified', true
                ),
                (
                    '43000000-0000-4000-8000-000000000003',
                    '41000000-0000-4000-8000-000000000003',
                    '42000000-0000-4000-8000-000000000003', 'PDF', repeat('c', 64),
                    'verified', true
                );
        `);

        const result = await arsipElektronikService.findAll({
            eligibleForAutentikasi: true,
            unitKerjaId: 'unit-durable',
            limit: 100,
        });

        expect(result.data.map(record => record.id)).toEqual([
            '43000000-0000-4000-8000-000000000001',
        ]);
    });
});
