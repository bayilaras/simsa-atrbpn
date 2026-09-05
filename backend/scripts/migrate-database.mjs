#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Client } from 'pg';

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
const sha256 = value => createHash('sha256').update(value).digest('hex');

// Share the exact historical allowlist with backup/grant verification. Never
// accept an arbitrary hash simply because its migration timestamp is old.
export function loadMigrations(directory = migrationsDirectory) {
  const journal = JSON.parse(readFileSync(join(directory, 'meta/_journal.json'), 'utf8'));
  const legacy = JSON.parse(readFileSync(join(directory, 'meta/approved_legacy_hashes.json'), 'utf8'));
  if (!journal || typeof journal !== 'object' || Array.isArray(journal)
    || !Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error('Migration journal must contain a non-empty ordered chain');
  }
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)
    || Object.keys(legacy).length !== 10 || Array.from({ length: 10 }, (_, i) => i)
    .some(index => typeof legacy[index] !== 'string' || !/^[a-f0-9]{64}$/.test(legacy[index]))) {
    throw new Error('Approved legacy migration hashes must cover exactly 0000-0009');
  }
  let previousTimestamp = -1;
  return journal.entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || entry.idx !== index || !Number.isSafeInteger(entry.when) || entry.when <= previousTimestamp
      || typeof entry.tag !== 'string' || !new RegExp(`^${String(index).padStart(4, '0')}_[a-z0-9_]+$`).test(entry.tag)) {
      throw new Error(`Invalid migration journal entry at index ${index}`);
    }
    previousTimestamp = entry.when;
    const bytes = readFileSync(join(directory, `${entry.tag}.sql`));
    if (!isUtf8(bytes)) throw new Error(`Migration is not valid UTF-8: ${entry.tag}`);
    const sql = bytes.toString('utf8').replaceAll('\r\n', '\n');
    if (sql.includes('\r') || sql.split('\n').some(line => line.startsWith('\\'))) {
      throw new Error(`Unsupported migration encoding or psql command in ${entry.tag}`);
    }
    const hash = sha256(sql);
    const acceptedHashes = [hash];
    if (legacy[index]) {
      if (legacy[index] === hash || ([0, 1, 2, 3, 6, 7, 8, 9].includes(index)
        && sha256(sql.replaceAll('\n', '\r\n')) !== legacy[index])) {
        throw new Error(`Historical migration hash no longer matches ${entry.tag}`);
      }
      acceptedHashes.push(legacy[index]);
    }
    return {
      tag: entry.tag, timestamp: entry.when, hash, acceptedHashes,
      statements: sql.split('--> statement-breakpoint').map(statement => statement.trim()).filter(Boolean),
    };
  });
}

export function validateAppliedMigrations(migrations, applied) {
  if (applied.length > migrations.length) throw new Error('Database migration chain is ahead of this release');
  for (const [index, row] of applied.entries()) {
    const expected = migrations[index];
    if (row.created_at == null || String(row.created_at) !== String(expected.timestamp)
      || !expected.acceptedHashes.includes(row.hash)) {
      throw new Error(`Database migration chain diverges at index ${index}; refusing changes`);
    }
  }
  return migrations.slice(applied.length);
}

/** Run against one pinned connection: serialize, verify, and commit atomically. */
export async function migrateDatabase(client, migrations = loadMigrations()) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '30s'");
    // This CLI does not use the application's pool startup settings. Keep
    // timestamp-without-time-zone defaults/backfills on the same UTC basis,
    // without changing the caller's session or the database-wide timezone.
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('simsa:database-migrations', 0))");
    const preflight = (await client.query(`SELECT current_user AS role,
      current_setting('server_version_num')::int AS version,
      (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='public') AS public_owner,
      (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='drizzle') AS journal_owner`)).rows[0];
    if (preflight?.role !== 'simsa_migrator' || preflight.public_owner !== 'simsa_migrator'
      || preflight.journal_owner !== 'simsa_migrator' || preflight.version < 160000) {
      throw new Error('Run the approved database role bootstrap first; migrations require PostgreSQL 16+ and the owning simsa_migrator role');
    }
    // The grant administrator already owns/creates the schemas. Do not issue
    // CREATE SCHEMA IF NOT EXISTS: PostgreSQL checks database CREATE even when
    // a schema exists, and that privilege is deliberately revoked after setup.
    await client.query(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
    )`);
    await client.query('LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE');
    const applied = (await client.query(
      'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id',
    )).rows;
    const pending = validateAppliedMigrations(migrations, applied);
    for (const migration of pending) {
      for (const statement of migration.statements) await client.query(statement);
      await client.query(
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
        [migration.hash, migration.timestamp],
      );
    }
    await client.query('COMMIT');
    return { applied: pending.length, total: migrations.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  dotenv.config({ quiet: true });
  if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required for db:migrate');
  const migrations = loadMigrations();
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    const result = await migrateDatabase(client, migrations);
    console.log(`Database migrations complete: ${result.applied} applied, ${result.total} verified.`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Do not dump connection configuration, SQL parameters, or credentials.
    console.error(`Database migration failed${error.code ? ` [${error.code}]` : ''}: ${error.message}`);
    process.exitCode = 1;
  });
}
