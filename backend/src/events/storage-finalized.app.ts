import express, { type Express, type Request } from 'express';
import { z } from 'zod';
import {
    assertGcpIamDatabaseRuntimeEnvironment,
    assertValidCloudPlatformEnvironment,
} from '../config/cloud-platform.js';
import { pool } from '../config/database.js';
import {
    clientBlobUploadService,
    type FinalizedGcsUpload,
    type GcsFinalizationResult,
} from '../services/client-blob-upload.service.js';
import { GcsStorageAdapter } from '../storage/gcs.adapter.js';
import { toGcsLocator } from '../storage/locator.js';
import { AppError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('StorageFinalizedEvent');
const FINALIZED_EVENT_TYPE = 'google.cloud.storage.object.v1.finalized';

export const STORAGE_EVENT_GCS_ACCESS_CONTRACT = {
    required: ['storage.objects.delete'],
    forbidden: [
        'storage.buckets.get',
        'storage.objects.create',
        'storage.objects.get',
        'storage.objects.list',
        'storage.objects.update',
    ],
} as const;

export const STORAGE_EVENT_READINESS_SQL = `
    WITH RECURSIVE relations AS (
        SELECT
            to_regclass('public.client_blob_uploads') AS uploads,
            to_regclass('public.users') AS users,
            to_regclass('public.final_object_orphans') AS final_orphans
    ), required_columns(column_name) AS (
        VALUES
            ('id'), ('blob_url'), ('pathname'), ('provider'), ('bucket'),
            ('purpose'), ('uploaded_by'), ('status'), ('object_generation'),
            ('event_id'), ('expected_size_bytes'), ('expected_content_type'),
            ('authorized_at'), ('finalized_at'), ('expires_at')
    ), runtime_membership_closure(role_name) AS (
        SELECT parent.rolname
        FROM pg_catalog.pg_roles member
        JOIN pg_catalog.pg_auth_members membership ON membership.member = member.oid
        JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
        WHERE member.rolname = current_user
        UNION
        SELECT parent.rolname
        FROM runtime_membership_closure closure
        JOIN pg_catalog.pg_roles member ON member.rolname = closure.role_name
        JOIN pg_catalog.pg_auth_members membership ON membership.member = member.oid
        JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
    ), membership_state AS (
        SELECT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_roles member
            JOIN pg_catalog.pg_auth_members membership ON membership.member = member.oid
            JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
            WHERE member.rolname = current_user
              AND parent.rolname = 'simsa_event_runtime'
              AND NOT membership.admin_option
              AND membership.inherit_option
              AND NOT membership.set_option
        )
        AND (SELECT count(*) FROM runtime_membership_closure) = 1
        AND NOT EXISTS (
            SELECT 1 FROM runtime_membership_closure
            WHERE role_name <> 'simsa_event_runtime'
        ) AS ready
    )
    SELECT
        uploads IS NOT NULL
        AND users IS NOT NULL
        AND final_orphans IS NOT NULL
        AND has_schema_privilege(current_user, 'public', 'USAGE')
        AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
        AND has_table_privilege(current_user, uploads, 'SELECT')
        AND has_table_privilege(current_user, uploads, 'UPDATE')
        AND NOT has_table_privilege(current_user, uploads, 'INSERT')
        AND NOT has_table_privilege(current_user, uploads, 'DELETE')
        AND NOT has_table_privilege(current_user, users, 'SELECT')
        AND NOT has_table_privilege(current_user, final_orphans, 'SELECT')
        AND NOT has_function_privilege(
            current_user,
            to_regprocedure(
                'public.simsa_mark_final_object_reference_candidate(uuid,text,text,text,text,timestamp with time zone)'
            ),
            'EXECUTE'
        )
        AND NOT has_function_privilege(
            current_user,
            to_regprocedure(
                'public.simsa_reserve_api_final_object_candidate(uuid,text,uuid,timestamp with time zone)'
            ),
            'EXECUTE'
        )
        AND NOT has_function_privilege(
            current_user,
            to_regprocedure(
                'public.simsa_record_api_final_object_candidate(uuid,text,text,timestamp with time zone)'
            ),
            'EXECUTE'
        )
        AND NOT has_function_privilege(
            current_user,
            to_regprocedure('public.simsa_mark_api_final_object_referenced(uuid,text,text)'),
            'EXECUTE'
        )
        AND membership_state.ready
        AND NOT pg_catalog.pg_has_role(current_user, 'simsa_migrator', 'MEMBER')
        AND NOT EXISTS (
            SELECT 1
            FROM required_columns AS required
            WHERE NOT EXISTS (
                SELECT 1
                FROM pg_attribute AS actual
                WHERE actual.attrelid = uploads
                  AND actual.attname = required.column_name
                  AND actual.attnum > 0
                  AND NOT actual.attisdropped
            )
        ) AS ready
    FROM relations, membership_state
`;

const metadataSchema = z.object({
    simsaUploadId: z.string().uuid(),
    simsaUploadedBy: z.string().uuid(),
    simsaPurpose: z.enum(['surat_masuk', 'surat_keluar', 'regulatory_source']),
}).passthrough();

export interface StorageEventDependencies {
    uploadBucket: string;
    recordFinalized(input: FinalizedGcsUpload): Promise<GcsFinalizationResult | void>;
    cancelAuthorization(uploadId: string, reason: string): Promise<void>;
    deleteGeneration(locator: string, generation: string): Promise<boolean>;
    probeReady?(): Promise<void>;
}

interface ParsedStorageObject {
    eventId: string;
    bucket: string;
    name: string;
    generation: string;
    sizeBytes: number;
    contentType: string;
    rawMetadata: unknown;
}

function header(req: Request, name: string): string {
    const value = req.get(name);
    return typeof value === 'string' ? value.trim() : '';
}

function parseSize(value: unknown): number | null {
    const normalized = typeof value === 'number'
        ? value
        : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN);
    return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

function matchesObjectSubject(subject: string, objectName: string): boolean {
    const prefix = 'objects/';
    if (!subject.startsWith(prefix)) return false;
    const subjectName = subject.slice(prefix.length);
    if (subjectName === objectName) return true;
    try {
        // CloudEvents subjects are URI references. Accept the equivalent
        // percent-encoded representation while still binding it to the exact
        // object name carried by StorageObjectData.
        return decodeURIComponent(subjectName) === objectName;
    } catch {
        return false;
    }
}

function parseFinalizedObject(req: Request): ParsedStorageObject | null {
    if (
        header(req, 'ce-type') !== FINALIZED_EVENT_TYPE
        || header(req, 'ce-specversion') !== '1.0'
    ) return null;
    const eventId = header(req, 'ce-id');
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const possibleData = body.data && typeof body.data === 'object'
        ? body.data as Record<string, unknown>
        : body;
    const bucket = typeof possibleData.bucket === 'string' ? possibleData.bucket : '';
    const name = typeof possibleData.name === 'string' ? possibleData.name : '';
    const generation = typeof possibleData.generation === 'string'
        ? possibleData.generation
        : String(possibleData.generation ?? '');
    const contentType = typeof possibleData.contentType === 'string'
        ? possibleData.contentType
        : 'application/octet-stream';
    const sizeBytes = parseSize(possibleData.size);
    const source = header(req, 'ce-source');
    const subject = header(req, 'ce-subject');
    if (
        !eventId
        || !bucket
        || !name
        || name.startsWith('/')
        || name.includes('\\')
        || name.split('/').includes('..')
        || !/^\d+$/.test(generation)
        || sizeBytes === null
        || source !== `//storage.googleapis.com/projects/_/buckets/${bucket}`
        || !matchesObjectSubject(subject, name)
    ) {
        return null;
    }
    return {
        eventId,
        bucket,
        name,
        generation,
        sizeBytes,
        contentType,
        rawMetadata: possibleData.metadata,
    };
}

function defaultDependencies(): StorageEventDependencies {
    const config = assertValidCloudPlatformEnvironment(process.env, {
        requireAuth: false,
        requireStorage: true,
    });
    if (config.storageProvider !== 'gcs' || !config.gcsUploadBucket) {
        throw new Error('The storage event service requires OBJECT_STORAGE_PROVIDER=gcs');
    }
    assertGcpIamDatabaseRuntimeEnvironment(process.env, config.projectId);
    const storage = GcsStorageAdapter.uploadFromEnvironment();
    return {
        uploadBucket: config.gcsUploadBucket,
        recordFinalized: input => clientBlobUploadService.recordGcsFinalized(input),
        cancelAuthorization: (uploadId, reason) => (
            clientBlobUploadService.cancelGcsAuthorization(uploadId, reason)
        ),
        deleteGeneration: (locator, generation) => storage.deleteObjectGeneration(locator, generation),
        probeReady: async () => {
            const [result] = await Promise.all([
                pool.query<{ ready: boolean }>(STORAGE_EVENT_READINESS_SQL),
                storage.probeAccessContract(STORAGE_EVENT_GCS_ACCESS_CONTRACT),
            ]);
            if (result.rows[0]?.ready !== true) {
                throw new Error('storage event schema or runtime grants are not ready');
            }
        },
    };
}

async function rejectObject(
    dependencies: StorageEventDependencies,
    object: ParsedStorageObject,
    uploadId?: string,
    reason = 'Cloud Storage finalization did not match an authorized upload',
): Promise<void> {
    const locator = toGcsLocator(object.bucket, object.name);
    const deleted = await dependencies.deleteGeneration(locator, object.generation);
    if (!deleted) throw new Error('Rejected Cloud Storage generation could not be deleted');
    if (uploadId) await dependencies.cancelAuthorization(uploadId, reason);
}

export function createStorageFinalizedApp(
    dependencies: StorageEventDependencies = defaultDependencies(),
): Express {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '256kb', type: ['application/json', 'application/cloudevents+json'] }));

    app.get('/health', (_req, res) => res.status(200).json({ status: 'alive' }));
    app.get('/ready', async (_req, res) => {
        try {
            await dependencies.probeReady?.();
            res.status(200).json({ status: 'ready' });
        } catch (error) {
            log.error({ err: error }, 'Storage event receiver is not ready');
            res.status(503).json({ status: 'not_ready' });
        }
    });

    const handlerPath = process.env.EVENTARC_HANDLER_PATH?.trim() || '/';
    if (!/^\/[a-z0-9/_-]*$/i.test(handlerPath) || handlerPath.includes('//')) {
        throw new Error('EVENTARC_HANDLER_PATH must be a canonical absolute path');
    }
    app.post(handlerPath, async (req, res) => {
        const object = parseFinalizedObject(req);
        if (!object) {
            // Eventarc retries every non-2xx response. An unsupported or
            // malformed event cannot become valid on retry, so acknowledge it.
            log.warn({ eventId: header(req, 'ce-id') || undefined }, 'Ignored invalid storage event');
            res.status(204).end();
            return;
        }
        if (object.bucket !== dependencies.uploadBucket) {
            // Never mutate an object outside the dedicated upload bucket.
            log.warn({ eventId: object.eventId, bucket: object.bucket }, 'Ignored event from another bucket');
            res.status(204).end();
            return;
        }

        const metadata = metadataSchema.safeParse(object.rawMetadata);
        if (!metadata.success) {
            try {
                await rejectObject(dependencies, object);
                log.warn({ eventId: object.eventId }, 'Deleted upload with invalid SIMSA metadata');
                res.status(204).end();
            } catch (error) {
                log.error({ err: error, eventId: object.eventId }, 'Could not reject invalid upload');
                res.status(503).json({ error: 'Temporary storage event failure' });
            }
            return;
        }

        try {
            const result = await dependencies.recordFinalized({
                eventId: object.eventId,
                uploadId: metadata.data.simsaUploadId,
                bucket: object.bucket,
                pathname: object.name,
                generation: object.generation,
                sizeBytes: object.sizeBytes,
                contentType: object.contentType,
                uploadedBy: metadata.data.simsaUploadedBy,
                purpose: metadata.data.simsaPurpose,
            });
            if (result?.disposition === 'duplicate') {
                log.info({
                    eventId: object.eventId,
                    uploadId: metadata.data.simsaUploadId,
                    generation: object.generation,
                    uploadStatus: result.upload.status,
                }, 'Acknowledged duplicate finalized storage event');
            }
            res.status(204).end();
        } catch (error) {
            if (error instanceof AppError && [400, 409, 410].includes(error.statusCode)) {
                try {
                    await rejectObject(
                        dependencies,
                        object,
                        metadata.data.simsaUploadId,
                        error.message,
                    );
                    log.warn({
                        eventId: object.eventId,
                        uploadId: metadata.data.simsaUploadId,
                        reason: error.name,
                    }, 'Rejected storage event that violated its upload intent');
                    res.status(204).end();
                } catch (cleanupError) {
                    log.error({
                        err: cleanupError,
                        eventId: object.eventId,
                    }, 'Could not clean up a rejected storage event');
                    res.status(503).json({ error: 'Temporary storage event failure' });
                }
                return;
            }
            log.error({ err: error, eventId: object.eventId }, 'Storage event processing failed');
            res.status(503).json({ error: 'Temporary storage event failure' });
        }
    });

    return app;
}

export { parseFinalizedObject };
