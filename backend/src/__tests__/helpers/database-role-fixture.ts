import type { PGlite } from '@electric-sql/pglite';

/** Reproduce the protected grant-admin bootstrap boundary for PGlite tests. */
export async function enterTestMigratorRole(database: PGlite): Promise<void> {
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
