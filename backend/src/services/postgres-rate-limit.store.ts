import { createHmac } from 'node:crypto';
import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';
import type { QueryConfig } from 'pg';
import { ServiceUnavailableError } from '../utils/errors.js';

export type RateLimitQuery = (text: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export const INCREMENT_RATE_LIMIT_SQL = `
    INSERT INTO public.shared_rate_limits (bucket, key_hash, hits, reset_at)
    VALUES ($1, $2, 1, statement_timestamp() + $3 * interval '1 millisecond')
    ON CONFLICT (bucket, key_hash) DO UPDATE SET
        hits = CASE WHEN shared_rate_limits.reset_at <= statement_timestamp() THEN 1
            ELSE LEAST(shared_rate_limits.hits::bigint + 1, 2147483647)::integer END,
        reset_at = CASE WHEN shared_rate_limits.reset_at <= statement_timestamp()
            THEN statement_timestamp() + $3 * interval '1 millisecond' ELSE shared_rate_limits.reset_at END
    RETURNING hits, reset_at`;

const CLEANUP_RATE_LIMIT_SQL = `DELETE FROM public.shared_rate_limits WHERE (bucket, key_hash) IN (
    SELECT bucket, key_hash FROM public.shared_rate_limits WHERE reset_at <= statement_timestamp()
    ORDER BY reset_at FOR UPDATE SKIP LOCKED LIMIT 1000)`;

// Better Auth uses a rolling inactivity window. Only admitted requests extend
// it; rejected attempts still increment so RETURNING can decide atomically.
const CONSUME_RATE_LIMIT_SQL = `
    INSERT INTO public.shared_rate_limits (bucket, key_hash, hits, reset_at)
    VALUES ($1, $2, 1, statement_timestamp() + $3 * interval '1 millisecond')
    ON CONFLICT (bucket, key_hash) DO UPDATE SET
        hits = CASE WHEN shared_rate_limits.reset_at <= statement_timestamp() THEN 1
            ELSE LEAST(shared_rate_limits.hits::bigint + 1, 2147483647)::integer END,
        reset_at = CASE WHEN shared_rate_limits.reset_at <= statement_timestamp() OR shared_rate_limits.hits < $4
            THEN statement_timestamp() + $3 * interval '1 millisecond' ELSE shared_rate_limits.reset_at END
    RETURNING hits, reset_at`;

async function databaseQuery(text: string, values: unknown[]) {
    const { pool } = await import('../config/database.js');
    // pg supports a per-query read timeout; its QueryConfig type omits it.
    const config: QueryConfig & { query_timeout: number } = { text, values, query_timeout: 5000 };
    return pool.query<Record<string, unknown>>(config);
}

/** One atomic database upsert per attempt; no per-instance counter or timer. */
export class PostgresRateLimitStore implements Store {
    readonly localKeys = false;
    readonly prefix: string;
    private windowMs = 60_000;
    private cleanupAfter = 0;

    constructor(private readonly bucket: string, private readonly secret: string,
        private readonly query: RateLimitQuery = databaseQuery) {
        if (!/^[a-z][a-z0-9_-]{0,63}$/.test(bucket) || secret.length < 32) {
            throw new Error('Shared rate limits require a valid bucket and a stable secret of at least 32 characters.');
        }
        this.prefix = `${bucket}:`;
    }

    init(options: Options) {
        if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1 || options.windowMs > 86_400_000) {
            throw new Error('Invalid shared rate limit window.');
        }
        this.windowMs = options.windowMs;
    }

    private key(key: string) {
        return createHmac('sha256', this.secret).update(this.prefix).update(key).digest('hex');
    }

    async increment(key: string): Promise<ClientRateLimitInfo> {
        return this.hit(key, this.windowMs);
    }

    async consume(key: string, rule: { window: number; max: number }) {
        const milliseconds = rule.window * 1000;
        if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 86_400_000
            || !Number.isSafeInteger(rule.max) || rule.max < 1 || rule.max > 1_000_000) throw new ServiceUnavailableError();
        const result = await this.hit(key, milliseconds, rule.max);
        const allowed = result.totalHits <= rule.max;
        return { allowed, retryAfter: allowed ? null : Math.max(1, Math.ceil((result.resetTime!.getTime() - Date.now()) / 1000)) };
    }

    private async hit(key: string, windowMs: number, maximum?: number): Promise<ClientRateLimitInfo> {
        try {
            // Opportunistic bounded cleanup also runs on cold starts; suspended
            // serverless processes do not need a timer to expire old counters.
            if (Date.now() >= this.cleanupAfter) {
                this.cleanupAfter = Date.now() + 60_000;
                await this.query(CLEANUP_RATE_LIMIT_SQL, []);
            }
            const { rows } = await this.query(maximum === undefined ? INCREMENT_RATE_LIMIT_SQL : CONSUME_RATE_LIMIT_SQL,
                [this.bucket, this.key(key), windowMs, ...(maximum === undefined ? [] : [maximum])]);
            const hits = Number(rows[0]?.hits);
            const resetTime = new Date(rows[0]?.reset_at as string | Date);
            if (!Number.isSafeInteger(hits) || hits < 1 || !Number.isFinite(resetTime.getTime())) throw new Error('Invalid counter');
            return { totalHits: hits, resetTime };
        } catch {
            // Store failures must not open the gate or reveal database details.
            throw new ServiceUnavailableError();
        }
    }

    async decrement(_key: string): Promise<void> {
        // Unconditional refunds could decrement a newer window. Only the auth
        // response boundary may refund, using its captured window identity.
    }

    async decrementInWindow(key: string, resetTime: Date): Promise<void> {
        if (!Number.isFinite(resetTime.getTime())) throw new ServiceUnavailableError();
        try {
            // PostgreSQL keeps microseconds while node-postgres Date keeps only
            // milliseconds. Match the returned precision without replacing the
            // actual database expiry or relying on the application clock.
            await this.query(`UPDATE public.shared_rate_limits SET hits = GREATEST(0, hits - 1)
                WHERE bucket = $1 AND key_hash = $2
                  AND date_trunc('milliseconds', reset_at) = $3::timestamptz`,
            [this.bucket, this.key(key), resetTime]);
        } catch { throw new ServiceUnavailableError(); }
    }

    async resetKey(key: string): Promise<void> {
        try { await this.query('DELETE FROM public.shared_rate_limits WHERE bucket = $1 AND key_hash = $2', [this.bucket, this.key(key)]); }
        catch { throw new ServiceUnavailableError(); }
    }
}
