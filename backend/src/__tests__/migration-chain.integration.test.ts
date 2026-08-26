import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterEach, describe, expect, it } from 'vitest';

type JournalEntry = {
    idx: number;
    when: number;
    tag: string;
};

const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
) as { entries: JournalEntry[] };

const openDatabases: PGlite[] = [];

function migrationStatements(tag: string): string[] {
    return readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);
}

async function createDatabase(): Promise<PGlite> {
    const database = new PGlite({ extensions: { pgcrypto } });
    openDatabases.push(database);
    await database.waitReady;
    return database;
}

async function applyMigration(database: PGlite, entry: JournalEntry): Promise<void> {
    for (const statement of migrationStatements(entry.tag)) {
        await database.exec(statement);
    }
}

async function repairedTables(database: PGlite): Promise<string[]> {
    const result = await database.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'arsip_elektronik',
            'tunjuk_silang',
            'klasifikasi_jra_mapping'
          )
        ORDER BY table_name
    `);

    return result.rows.map(({ table_name }) => table_name);
}

afterEach(async () => {
    await Promise.all(openDatabases.splice(0).map((database) => database.close()));
});

describe('PostgreSQL migration chain', () => {
    it('has a contiguous, chronological journal with a SQL file for every entry', () => {
        expect(journal.entries.length).toBeGreaterThan(0);

        journal.entries.forEach((entry, index) => {
            expect(entry.idx).toBe(index);
            expect(existsSync(join(migrationsDir, `${entry.tag}.sql`))).toBe(true);
            if (index > 0) {
                expect(entry.when).toBeGreaterThan(journal.entries[index - 1].when);
            }
        });
    });

    it('applies every journaled migration to a fresh PostgreSQL database', async () => {
        const database = await createDatabase();

        for (const entry of journal.entries) {
            await applyMigration(database, entry);
        }

        await expect(repairedTables(database)).resolves.toEqual([
            'arsip_elektronik',
            'klasifikasi_jra_mapping',
            'tunjuk_silang',
        ]);

        const disposisi = await database.query<{ udt_name: string }>(`
            SELECT udt_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'surat_masuk'
              AND column_name = 'disposisi'
        `);
        expect(disposisi.rows).toEqual([{ udt_name: '_text' }]);
    }, 30_000);

    it('recovers when legacy 0004 was recorded without its snapshot tables', async () => {
        const database = await createDatabase();
        const migration0004Index = journal.entries.findIndex(
            ({ tag }) => tag === '0004_amazing_rawhide_kid',
        );
        const migration0005Index = journal.entries.findIndex(
            ({ tag }) => tag === '0005_first_fantastic_four',
        );

        expect(migration0004Index).toBeGreaterThan(0);
        expect(migration0005Index).toBe(migration0004Index + 1);

        for (const entry of journal.entries.slice(0, migration0004Index)) {
            await applyMigration(database, entry);
        }

        // This is the complete SQL shipped in the old/truncated 0004 file. A
        // real database in this state skips the repaired 0004 because Drizzle
        // already recorded its journal timestamp.
        await database.exec(`
            ALTER TABLE "surat_masuk"
            ALTER COLUMN "disposisi" SET DATA TYPE text[]
            USING CASE
              WHEN "disposisi" IS NULL THEN NULL
              ELSE ARRAY["disposisi"]
            END
        `);

        for (const entry of journal.entries.slice(migration0005Index)) {
            await applyMigration(database, entry);
        }

        await expect(repairedTables(database)).resolves.toEqual([
            'arsip_elektronik',
            'klasifikasi_jra_mapping',
            'tunjuk_silang',
        ]);
    }, 30_000);
});
