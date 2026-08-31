import { sql, type SQL } from 'drizzle-orm';
import { buildCloudPlatformConfig } from '../config/cloud-platform.js';
import { pool } from '../config/database.js';
import { loadFinalObjectRetentionPolicy } from '../config/final-object-retention.js';
import {
    GcsStorageAdapter,
    type ApiFinalObjectPlan,
} from '../storage/gcs.adapter.js';
import { requireImmutableObjectGeneration } from '../storage/locator.js';
import type { CopyFileOptions, StoredFile, UploadFileOptions } from '../storage/types.js';
import { createLogger } from '../utils/logger.js';
import { blobStorageService } from './blob-storage.service.js';

const log = createLogger('DurableFinalObjectService');

export interface DurableFinalObjectCandidate {
    provider: 'gcs';
    ownerId: string;
    cleanupToken: string;
    locator: string;
    generation: string;
}

export interface FinalObjectWrite {
    stored: StoredFile;
    candidate: DurableFinalObjectCandidate | null;
}

export interface FinalObjectSqlExecutor {
    execute(query: SQL): Promise<unknown>;
}

export interface ApiFinalObjectRepository {
    reserve(plan: ApiFinalObjectPlan, notBefore: Date): Promise<boolean>;
    record(plan: ApiFinalObjectPlan, generation: string, notBefore: Date): Promise<boolean>;
    markReferenced(
        executor: FinalObjectSqlExecutor,
        candidate: DurableFinalObjectCandidate,
    ): Promise<boolean>;
}

function resultBoolean(result: any, field: string): boolean {
    const row = result?.rows?.[0] ?? result?.[0];
    return row?.[field] === true;
}

export class PostgresApiFinalObjectRepository implements ApiFinalObjectRepository {
    async reserve(plan: ApiFinalObjectPlan, notBefore: Date): Promise<boolean> {
        const result = await pool.query<{ reserved: boolean }>(`
            SELECT public.simsa_reserve_api_final_object_candidate(
                $1::uuid, $2::text, $3::uuid, $4::timestamptz
            ) AS reserved
        `, [plan.ownerId, plan.locator, plan.cleanupToken, notBefore]);
        return result.rows[0]?.reserved === true;
    }

    async record(
        plan: ApiFinalObjectPlan,
        generation: string,
        notBefore: Date,
    ): Promise<boolean> {
        const result = await pool.query<{ recorded: boolean }>(`
            SELECT public.simsa_record_api_final_object_candidate(
                $1::uuid, $2::text, $3::text, $4::timestamptz
            ) AS recorded
        `, [plan.cleanupToken, plan.locator, generation, notBefore]);
        return result.rows[0]?.recorded === true;
    }

    async markReferenced(
        executor: FinalObjectSqlExecutor,
        candidate: DurableFinalObjectCandidate,
    ): Promise<boolean> {
        const result = await executor.execute(sql`
            SELECT public.simsa_mark_api_final_object_referenced(
                ${candidate.cleanupToken}::uuid,
                ${candidate.locator}::text,
                ${candidate.generation}::text
            ) AS marked
        `);
        return resultBoolean(result, 'marked');
    }
}

interface DurableFinalObjectServiceOptions {
    provider?: () => 'gcs' | 'vercel-blob';
    repository?: ApiFinalObjectRepository;
    gcs?: () => GcsStorageAdapter;
    now?: () => Date;
    minimumObjectAgeMs?: () => number;
    legacy?: Pick<typeof blobStorageService, 'uploadFile' | 'copyFile' | 'deleteFile'>;
}

export class DurableFinalObjectService {
    private readonly provider: () => 'gcs' | 'vercel-blob';
    private readonly repository: ApiFinalObjectRepository;
    private readonly gcs: () => GcsStorageAdapter;
    private readonly now: () => Date;
    private readonly minimumObjectAgeMs: () => number;
    private readonly legacy: Pick<
        typeof blobStorageService,
        'uploadFile' | 'copyFile' | 'deleteFile'
    >;

    constructor(options: DurableFinalObjectServiceOptions = {}) {
        this.provider = options.provider
            ?? (() => buildCloudPlatformConfig().storageProvider);
        this.repository = options.repository ?? new PostgresApiFinalObjectRepository();
        this.gcs = options.gcs ?? (() => GcsStorageAdapter.fromEnvironment());
        this.now = options.now ?? (() => new Date());
        this.minimumObjectAgeMs = options.minimumObjectAgeMs
            ?? (() => loadFinalObjectRetentionPolicy(process.env, { requireExplicit: true }).minimumAgeMs);
        this.legacy = options.legacy ?? blobStorageService;
    }

    private notBefore(): Date {
        return new Date(this.now().getTime() + this.minimumObjectAgeMs());
    }

    private async reserve(
        storage: GcsStorageAdapter,
        ownerId: string,
        fileName: string,
        folder: string,
    ): Promise<{ plan: ApiFinalObjectPlan; notBefore: Date }> {
        const plan = storage.planApiFinalObject({ ownerId, fileName, folder });
        const notBefore = this.notBefore();
        if (!await this.repository.reserve(plan, notBefore)) {
            throw new Error('Could not reserve the final object in the durable cleanup queue');
        }
        return { plan, notBefore };
    }

    private async finish(
        plan: ApiFinalObjectPlan,
        notBefore: Date,
        stored: StoredFile,
    ): Promise<FinalObjectWrite> {
        const generation = requireImmutableObjectGeneration(stored.url, stored.generation);
        if (!generation) throw new Error('GCS final object did not return an immutable generation');
        const storageNotBefore = stored.retentionExpiresAt
            ? new Date(stored.retentionExpiresAt)
            : null;
        const durableNotBefore = storageNotBefore && Number.isFinite(storageNotBefore.getTime())
            && storageNotBefore > notBefore
            ? storageNotBefore
            : notBefore;
        if (!await this.repository.record(plan, generation, durableNotBefore)) {
            // The pre-write reservation remains durable. The isolated cleanup
            // principal can recover the generation from fenced object metadata.
            throw new Error('Could not record the final object generation in the durable cleanup queue');
        }
        return {
            stored,
            candidate: {
                provider: 'gcs',
                ownerId: plan.ownerId,
                cleanupToken: plan.cleanupToken,
                locator: plan.locator,
                generation,
            },
        };
    }

    async upload(ownerId: string, options: UploadFileOptions): Promise<FinalObjectWrite> {
        if (this.provider() !== 'gcs') {
            return { stored: await this.legacy.uploadFile(options), candidate: null };
        }
        const storage = this.gcs();
        const { plan, notBefore } = await this.reserve(
            storage,
            ownerId,
            options.fileName,
            options.folder || 'uploads',
        );
        const stored = await storage.uploadApiFinalObject(plan, {
            fileName: options.fileName,
            mimeType: options.mimeType,
            buffer: options.buffer,
        });
        return this.finish(plan, notBefore, stored);
    }

    async copy(ownerId: string, options: CopyFileOptions): Promise<FinalObjectWrite> {
        if (this.provider() !== 'gcs') {
            return { stored: await this.legacy.copyFile(options), candidate: null };
        }
        const storage = this.gcs();
        const { plan, notBefore } = await this.reserve(
            storage,
            ownerId,
            options.fileName,
            options.folder,
        );
        const stored = await storage.copyApiFinalObject(plan, {
            sourceUrl: options.sourceUrl,
            sourceGeneration: options.sourceGeneration,
            fileName: options.fileName,
            mimeType: options.mimeType,
        });
        return this.finish(plan, notBefore, stored);
    }

    async markReferenced(
        executor: FinalObjectSqlExecutor,
        write: FinalObjectWrite,
    ): Promise<void> {
        if (!write.candidate) return;
        if (!await this.repository.markReferenced(executor, write.candidate)) {
            throw new Error('Final object cleanup reservation could not be bound to its database reference');
        }
    }

    async compensate(write: FinalObjectWrite | null, cause: unknown): Promise<void> {
        if (!write) return;
        if (write.candidate) {
            log.warn({
                locator: write.candidate.locator,
                generation: write.candidate.generation,
                err: cause,
            }, 'Final object remains fenced in the durable cleanup queue after transaction rollback');
            return;
        }
        const deleted = await this.legacy.deleteFile(write.stored.url);
        if (!deleted) {
            log.error({ locator: write.stored.url, err: cause },
                'Legacy Blob compensation failed; manual cleanup is required');
        }
    }
}

export const durableFinalObjectService = new DurableFinalObjectService();
