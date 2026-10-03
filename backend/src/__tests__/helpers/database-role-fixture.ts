import type { PGlite } from '@electric-sql/pglite';

/**
 * Reproduce the protected grant-admin bootstrap boundary for PGlite tests.
 * `pgTrgm: true` juga memasang pg_trgm sebagai administrator (seperti grants
 * 0001/0003) — wajib untuk rantai yang menjalankan 0049_lacak_trgm; PGlite
 * harus dibuat dengan `extensions: { pgcrypto, pg_trgm }`.
 */
export async function enterTestMigratorRole(database: PGlite, options: { pgTrgm?: boolean } = {}): Promise<void> {
    if (options.pgTrgm) await database.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await database.exec(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
        CREATE ROLE simsa_api_runtime NOLOGIN
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT NOBYPASSRLS;
        CREATE ROLE simsa_event_runtime NOLOGIN
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT NOBYPASSRLS;
        CREATE ROLE simsa_worker_runtime NOLOGIN
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT NOBYPASSRLS;
        CREATE ROLE simsa_final_cleanup NOLOGIN
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT NOBYPASSRLS;
        CREATE ROLE simsa_maintenance NOLOGIN
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT NOBYPASSRLS;
        CREATE ROLE simsa_migrator NOLOGIN
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT NOBYPASSRLS;
        CREATE ROLE simsa_backup_reader NOLOGIN
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT NOBYPASSRLS;
        GRANT simsa_migrator TO postgres;
        ALTER SCHEMA public OWNER TO simsa_migrator;
        SET ROLE simsa_migrator;
    `);
}
