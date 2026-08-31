import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const testDatabaseUrl = process.env.TEST_POSTGRES_URL;
if (!testDatabaseUrl) {
    throw new Error('TEST_POSTGRES_URL must point to an isolated PostgreSQL test database.');
}
process.env.DATABASE_URL ||= testDatabaseUrl;
const { STORAGE_EVENT_READINESS_SQL } = await import('../src/events/storage-finalized.app.js');
const { DATABASE_SCHEMA_READINESS_SQL } = await import('../src/services/readiness.service.js');
const { pool: applicationPool } = await import('../src/config/database.js');

const principals = {
    api: process.env.TEST_DB_API_PRINCIPAL || 'simsa_ci_api',
    event: process.env.TEST_DB_EVENT_PRINCIPAL || 'simsa_ci_event',
    worker: process.env.TEST_DB_WORKER_PRINCIPAL || 'simsa_ci_worker',
    cleanup: process.env.TEST_DB_FINAL_CLEANUP_PRINCIPAL || 'simsa_ci_cleanup',
    maintenance: process.env.TEST_DB_MAINTENANCE_PRINCIPAL || 'simsa_ci_maintenance',
    migrator: process.env.TEST_DB_MIGRATOR_PRINCIPAL || 'simsa_ci_migrator',
    backup: process.env.TEST_DB_BACKUP_PRINCIPAL || 'simsa_ci_backup',
};
const expectedGrantAdmin = process.env.TEST_DB_GRANT_ADMIN_PRINCIPAL || 'simsa_test';

const sql = postgres(testDatabaseUrl, { max: 1, connect_timeout: 5, idle_timeout: 1 });

async function tablePrivilege(role: string, table: string, privilege: string) {
    const [result] = await sql<{ allowed: boolean }[]>`
        SELECT pg_catalog.has_table_privilege(
            ${role}, ${`public.${table}`}, ${privilege}
        ) AS allowed
    `;
    return result.allowed;
}

async function functionPrivilege(role: string, signature: string) {
    const [result] = await sql<{ allowed: boolean }[]>`
        SELECT pg_catalog.has_function_privilege(
            ${role}, pg_catalog.to_regprocedure(${signature}), 'EXECUTE'
        ) AS allowed
    `;
    return result.allowed;
}

afterAll(async () => {
    await sql.end({ timeout: 1 });
    await applicationPool.end();
});

describe('least-privilege PostgreSQL runtime grants', () => {
    const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
    it('preinstalls the exact pgcrypto extension outside migrator ownership', async () => {
        const [extension] = await sql<{
            extversion: string;
            default_version: string;
            schema_name: string;
            owner_name: string;
        }[]>`
            SELECT e.extversion,
                   available.default_version,
                   n.nspname AS schema_name,
                   pg_catalog.pg_get_userbyid(e.extowner) AS owner_name
            FROM pg_catalog.pg_extension e
            JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
            JOIN pg_catalog.pg_available_extensions available ON available.name = e.extname
            WHERE e.extname = 'pgcrypto'
        `;
        expect(extension).toEqual({
            extversion: extension.default_version,
            default_version: extension.default_version,
            schema_name: 'public',
            owner_name: expectedGrantAdmin,
        });
    });

    it('keeps every workload principal unprivileged and outside the owner role', async () => {
        const rows = await sql<{
            rolname: string;
            safe: boolean;
            is_migrator: boolean;
        }[]>`
            SELECT rolname,
                   NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
                     AND NOT rolreplication AND NOT rolbypassrls AS safe,
                   pg_catalog.pg_has_role(rolname, 'simsa_migrator', 'MEMBER') AS is_migrator
            FROM pg_catalog.pg_roles
            WHERE rolname IN ${sql([
                principals.api,
                principals.event,
                principals.worker,
                principals.cleanup,
                principals.maintenance,
                principals.migrator,
                principals.backup,
            ])}
            ORDER BY rolname
        `;
        expect(rows).toHaveLength(7);
        expect(rows.every(({ safe }) => safe)).toBe(true);
        expect(rows.filter(({ is_migrator }) => is_migrator).map(({ rolname }) => rolname))
            .toEqual([principals.migrator]);
    });

    it('separates inheriting migrator login from SET-only grant administration', async () => {
        const memberships = await sql<{
            member_name: string;
            admin_option: boolean;
            inherit_option: boolean;
            set_option: boolean;
        }[]>`
            SELECT member.rolname AS member_name,
                   membership.admin_option,
                   membership.inherit_option,
                   membership.set_option
            FROM pg_catalog.pg_auth_members membership
            JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
            JOIN pg_catalog.pg_roles member ON member.oid = membership.member
            WHERE parent.rolname = 'simsa_migrator'
            ORDER BY member.rolname
        `;
        expect(memberships).toEqual([
            {
                member_name: expectedGrantAdmin,
                admin_option: false,
                inherit_option: false,
                set_option: true,
            },
            {
                member_name: principals.migrator,
                admin_option: false,
                inherit_option: true,
                set_option: true,
            },
        ].sort((left, right) => left.member_name.localeCompare(right.member_name)));
    });

    it('maps only the configured backup login to an exact read-only policy role', async () => {
        const [backup] = await sql<{
            backup_member: boolean;
            read_all: boolean;
            write_all: boolean;
            can_create: boolean;
            can_temp: boolean;
            direct_database_acl: boolean;
        }[]>`
            SELECT pg_catalog.pg_has_role(${principals.backup}, 'simsa_backup_reader', 'MEMBER')
                       AS backup_member,
                   pg_catalog.pg_has_role(${principals.backup}, 'pg_read_all_data', 'MEMBER')
                       AS read_all,
                   pg_catalog.pg_has_role(${principals.backup}, 'pg_write_all_data', 'MEMBER')
                       AS write_all,
                   pg_catalog.has_database_privilege(
                       ${principals.backup}, pg_catalog.current_database(), 'CREATE'
                   ) AS can_create,
                   pg_catalog.has_database_privilege(
                       ${principals.backup}, pg_catalog.current_database(), 'TEMPORARY'
                   ) AS can_temp,
                   EXISTS (
                       SELECT 1
                       FROM pg_catalog.pg_database database_record
                       CROSS JOIN LATERAL pg_catalog.aclexplode(database_record.datacl) privilege
                       WHERE database_record.datname = pg_catalog.current_database()
                         AND privilege.grantee = (
                             SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ${principals.backup}
                         )
                   ) AS direct_database_acl
        `;
        expect(backup).toEqual({
            backup_member: true,
            read_all: true,
            write_all: false,
            can_create: false,
            can_temp: false,
            direct_database_acl: false,
        });
        const directMemberships = await sql<{
            role_name: string;
            admin_option: boolean;
            inherit_option: boolean;
            set_option: boolean;
        }[]>`
            SELECT parent.rolname AS role_name,
                   membership.admin_option,
                   membership.inherit_option,
                   membership.set_option
            FROM pg_catalog.pg_roles member
            JOIN pg_catalog.pg_auth_members membership ON membership.member = member.oid
            JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
            WHERE member.rolname = ${principals.backup}
            ORDER BY parent.rolname
        `;
        expect(directMemberships).toEqual([{
            role_name: 'simsa_backup_reader',
            admin_option: false,
            inherit_option: true,
            set_option: false,
        }]);

        const policyMemberships = await sql<{
            role_name: string;
            admin_option: boolean;
            inherit_option: boolean;
            set_option: boolean;
        }[]>`
            SELECT parent.rolname AS role_name,
                   membership.admin_option,
                   membership.inherit_option,
                   membership.set_option
            FROM pg_catalog.pg_roles member
            JOIN pg_catalog.pg_auth_members membership ON membership.member = member.oid
            JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
            WHERE member.rolname = 'simsa_backup_reader'
            ORDER BY parent.rolname
        `;
        expect(policyMemberships).toEqual([{
            role_name: 'pg_read_all_data',
            admin_option: false,
            inherit_option: true,
            set_option: false,
        }]);

        const closure = await sql<{ role_name: string }[]>`
            WITH RECURSIVE membership_closure(role_name) AS (
                SELECT parent.rolname
                FROM pg_catalog.pg_roles member
                JOIN pg_catalog.pg_auth_members membership ON membership.member = member.oid
                JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
                WHERE member.rolname = ${principals.backup}
                UNION
                SELECT parent.rolname
                FROM membership_closure closure
                JOIN pg_catalog.pg_roles member ON member.rolname = closure.role_name
                JOIN pg_catalog.pg_auth_members membership ON membership.member = member.oid
                JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
            )
            SELECT role_name FROM membership_closure ORDER BY role_name
        `;
        expect(closure).toEqual([
            { role_name: 'pg_read_all_data' },
            { role_name: 'simsa_backup_reader' },
        ]);
        await expect(tablePrivilege(principals.backup, 'users', 'SELECT')).resolves.toBe(true);
        await expect(tablePrivilege(principals.backup, 'users', 'UPDATE')).resolves.toBe(false);
    });

    it('gives the API data access but not DDL or mutable audit evidence', async () => {
        await expect(tablePrivilege(principals.api, 'users', 'SELECT')).resolves.toBe(true);
        await expect(tablePrivilege(principals.api, 'users', 'UPDATE')).resolves.toBe(true);
        await expect(tablePrivilege(principals.api, 'audit_log', 'INSERT')).resolves.toBe(true);
        await expect(tablePrivilege(principals.api, 'audit_log', 'UPDATE')).resolves.toBe(false);
        await expect(tablePrivilege(principals.api, 'final_object_orphans', 'SELECT'))
            .resolves.toBe(false);
        await expect(tablePrivilege(principals.api, 'final_object_orphans', 'DELETE'))
            .resolves.toBe(false);
        await expect(functionPrivilege(
            principals.api,
            'public.simsa_reserve_api_final_object_candidate(uuid,text,uuid,timestamp with time zone)',
        )).resolves.toBe(true);
        await expect(functionPrivilege(
            principals.api,
            'public.simsa_record_api_final_object_candidate(uuid,text,text,timestamp with time zone)',
        )).resolves.toBe(true);
        await expect(functionPrivilege(
            principals.api,
            'public.simsa_mark_api_final_object_referenced(uuid,text,text)',
        )).resolves.toBe(true);
        const [schema] = await sql<{ can_create: boolean }[]>`
            SELECT pg_catalog.has_schema_privilege(${principals.api}, 'public', 'CREATE') AS can_create
        `;
        expect(schema.can_create).toBe(false);
    });

    it('limits event and malware workers to their operational queues', async () => {
        await expect(tablePrivilege(principals.event, 'client_blob_uploads', 'UPDATE'))
            .resolves.toBe(true);
        await expect(tablePrivilege(principals.event, 'users', 'SELECT')).resolves.toBe(false);
        await expect(tablePrivilege(principals.worker, 'file_attachments', 'UPDATE'))
            .resolves.toBe(true);
        await expect(tablePrivilege(principals.worker, 'audit_log', 'INSERT')).resolves.toBe(true);
        await expect(tablePrivilege(principals.worker, 'operational_heartbeats', 'DELETE'))
            .resolves.toBe(true);
        await expect(tablePrivilege(principals.worker, 'srikandi_outbox', 'SELECT'))
            .resolves.toBe(true);
        await expect(tablePrivilege(principals.worker, 'srikandi_outbox', 'UPDATE'))
            .resolves.toBe(true);
        await expect(tablePrivilege(principals.worker, 'srikandi_outbox_audit', 'INSERT'))
            .resolves.toBe(true);
        await expect(tablePrivilege(principals.worker, 'users', 'SELECT')).resolves.toBe(false);
    });

    it('isolates final cleanup and maintenance from unrelated business data', async () => {
        await expect(tablePrivilege(principals.cleanup, 'final_object_orphans', 'SELECT'))
            .resolves.toBe(true);
        await expect(tablePrivilege(principals.cleanup, 'final_object_orphans', 'UPDATE'))
            .resolves.toBe(true);
        await expect(tablePrivilege(principals.cleanup, 'final_object_orphans', 'INSERT'))
            .resolves.toBe(false);
        await expect(tablePrivilege(principals.cleanup, 'file_attachments', 'SELECT'))
            .resolves.toBe(true);
        await expect(tablePrivilege(principals.cleanup, 'file_attachments', 'UPDATE'))
            .resolves.toBe(false);
        await expect(tablePrivilege(principals.maintenance, 'regulatory_rule_sets', 'UPDATE'))
            .resolves.toBe(true);
        await expect(tablePrivilege(principals.maintenance, 'users', 'SELECT'))
            .resolves.toBe(false);
    });

    it('keeps every application relation owned by the NOLOGIN migrator role', async () => {
        const unexpected = await sql<{ schema_name: string; object_name: string; owner_name: string }[]>`
            SELECT n.nspname AS schema_name,
                   c.relname AS object_name,
                   pg_catalog.pg_get_userbyid(c.relowner) AS owner_name
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('public', 'drizzle')
              AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
              AND NOT EXISTS (
                  SELECT 1 FROM pg_catalog.pg_depend d
                  WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
                    AND d.objid = c.oid
                    AND d.deptype = 'e'
              )
              AND pg_catalog.pg_get_userbyid(c.relowner) <> 'simsa_migrator'
        `;
        expect(unexpected).toEqual([]);
    });

    it('makes API and event readiness fail closed on non-exact membership closure', async () => {
        const rogueRole = 'simsa_ci_readiness_rogue';
        let rogueRoleCreated = false;
        try {
            await sql.unsafe(`DROP ROLE IF EXISTS ${quoteIdentifier(rogueRole)}`);
            await sql.unsafe(`SET ROLE ${quoteIdentifier(principals.api)}`);
            const [apiReadiness] = await sql.unsafe<{ schema_ready: boolean }[]>(
                DATABASE_SCHEMA_READINESS_SQL,
            );
            expect(apiReadiness.schema_ready).toBe(true);
            await sql.unsafe('RESET ROLE');

            await sql.unsafe(`SET ROLE ${quoteIdentifier(principals.event)}`);
            const [eventReadiness] = await sql.unsafe<{ ready: boolean }[]>(
                STORAGE_EVENT_READINESS_SQL,
            );
            expect(eventReadiness.ready).toBe(true);
            await sql.unsafe('RESET ROLE');

            await sql.unsafe(`CREATE ROLE ${quoteIdentifier(rogueRole)} NOLOGIN`);
            rogueRoleCreated = true;
            await sql.unsafe(
                `GRANT ${quoteIdentifier(rogueRole)} TO ${quoteIdentifier(principals.api)}, `
                + `${quoteIdentifier(principals.event)} WITH INHERIT FALSE, SET TRUE`,
            );

            await sql.unsafe(`SET ROLE ${quoteIdentifier(principals.api)}`);
            const [driftedApiReadiness] = await sql.unsafe<{ schema_ready: boolean }[]>(
                DATABASE_SCHEMA_READINESS_SQL,
            );
            expect(driftedApiReadiness.schema_ready).toBe(false);
            await sql.unsafe('RESET ROLE');

            await sql.unsafe(`SET ROLE ${quoteIdentifier(principals.event)}`);
            const [driftedEventReadiness] = await sql.unsafe<{ ready: boolean }[]>(
                STORAGE_EVENT_READINESS_SQL,
            );
            expect(driftedEventReadiness.ready).toBe(false);
        } finally {
            await sql.unsafe('RESET ROLE');
            if (rogueRoleCreated) {
                await sql.unsafe(
                    `REVOKE ${quoteIdentifier(rogueRole)} FROM ${quoteIdentifier(principals.api)}, `
                    + quoteIdentifier(principals.event),
                );
                await sql.unsafe(`DROP ROLE ${quoteIdentifier(rogueRole)}`);
            }
        }
    });
});
