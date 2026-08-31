import { sql } from 'drizzle-orm';
import {
    check,
    bigint,
    index,
    integer,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core';

/**
 * Durable lease for objects created through @vercel/blob/client.
 *
 * The completion callback is the only producer of these rows. Business
 * transactions atomically change pending -> claimed when they persist the
 * object locator. An expiry reconciler can therefore delete only callback-
 * proven, unclaimed objects without guessing ownership from a user-supplied
 * URL or racing a database commit.
 */
export const clientBlobUploads = pgTable('client_blob_uploads', {
    id: uuid('id').primaryKey().defaultRandom(),
    blobUrl: text('blob_url').notNull(),
    pathname: text('pathname').notNull(),
    provider: varchar('provider', { length: 24 }).default('vercel_blob').notNull(),
    bucket: text('bucket'),
    objectGeneration: varchar('object_generation', { length: 32 }),
    eventId: text('event_id'),
    expectedSizeBytes: bigint('expected_size_bytes', { mode: 'number' }),
    expectedContentType: varchar('expected_content_type', { length: 160 }),
    purpose: varchar('purpose', { length: 40 }).notNull(),
    uploadedBy: uuid('uploaded_by').notNull(),
    status: varchar('status', { length: 24 }).default('pending').notNull(),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedEntityType: varchar('claimed_entity_type', { length: 40 }),
    claimedEntityId: uuid('claimed_entity_id'),
    cleanupStartedAt: timestamp('cleanup_started_at', { withTimezone: true }),
    cleanupPreviousStatus: varchar('cleanup_previous_status', { length: 24 }),
    cleanupAttempts: integer('cleanup_attempts').default(0).notNull(),
    lastCleanupError: text('last_cleanup_error'),
    completedAt: timestamp('completed_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('client_blob_uploads_blob_url_unique').on(table.blobUrl),
    uniqueIndex('client_blob_uploads_event_id_unique').on(table.eventId),
    index('client_blob_uploads_expiry_idx').on(table.status, table.expiresAt),
    check(
        'client_blob_uploads_purpose_check',
        sql`${table.purpose} in ('surat_masuk', 'surat_keluar', 'regulatory_source')`,
    ),
    check(
        'client_blob_uploads_status_check',
        sql`${table.status} in ('authorized', 'pending', 'cleanup_started', 'claimed', 'release_cleanup', 'deleted')`,
    ),
    check(
        'client_blob_uploads_provider_check',
        sql`${table.provider} in ('vercel_blob', 'gcs')`,
    ),
    check(
        'client_blob_uploads_gcs_metadata_check',
        sql`(
            ${table.provider} <> 'gcs'
            or (${table.bucket} is not null and ${table.authorizedAt} is not null)
        )`,
    ),
    check(
        'client_blob_uploads_cleanup_previous_status_check',
        sql`${table.cleanupPreviousStatus} is null or ${table.cleanupPreviousStatus} in ('authorized', 'pending', 'release_cleanup')`,
    ),
    check(
        'client_blob_uploads_claim_check',
        sql`(
            ${table.status} <> 'claimed'
            or (
                ${table.claimedAt} is not null
                and ${table.claimedEntityType} is not null
                and ${table.claimedEntityId} is not null
            )
        )`,
    ),
]);

export type ClientBlobUpload = typeof clientBlobUploads.$inferSelect;
export type NewClientBlobUpload = typeof clientBlobUploads.$inferInsert;
