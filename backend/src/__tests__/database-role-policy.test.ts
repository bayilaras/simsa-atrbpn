import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const bootstrapSql = readFileSync(fileURLToPath(new URL(
    '../db/grants/0001_bootstrap_cloud_sql_roles.sql',
    import.meta.url,
)), 'utf8');
const grantMigration = readFileSync(fileURLToPath(new URL(
    '../db/migrations/0032_versioned_runtime_grants.sql',
    import.meta.url,
)), 'utf8');
const bootstrapRunner = readFileSync(fileURLToPath(new URL(
    '../../scripts/apply-database-role-bootstrap.mjs',
    import.meta.url,
)), 'utf8');
const convergenceSql = readFileSync(fileURLToPath(new URL(
    '../db/grants/0002_converge_application_grants.sql',
    import.meta.url,
)), 'utf8');
const convergenceRunner = readFileSync(fileURLToPath(new URL(
    '../../scripts/apply-database-grant-convergence.mjs',
    import.meta.url,
)), 'utf8');
const readinessSource = readFileSync(fileURLToPath(new URL(
    '../services/readiness.service.ts',
    import.meta.url,
)), 'utf8');
const eventReadinessSource = readFileSync(fileURLToPath(new URL(
    '../events/storage-finalized.app.ts',
    import.meta.url,
)), 'utf8');

describe('versioned PostgreSQL role policy', () => {
    it('keeps credentials out of SQL/argv and requires distinct injected principals', () => {
        expect(bootstrapSql).not.toMatch(/PASSWORD\s+['\":]|PGPASSWORD|private[_-]?key|credentials_json/i);
        expect(bootstrapRunner).not.toContain('DATABASE_URL');
        expect(bootstrapRunner).toContain("spawnSync('psql'");
        expect(bootstrapRunner).not.toContain('--password');
        expect(bootstrapRunner).toContain('env: process.env');
        expect(bootstrapRunner).toContain('new Set(principalNames).size');
        for (const name of [
            'DB_API_PRINCIPAL',
            'DB_EVENT_PRINCIPAL',
            'DB_WORKER_PRINCIPAL',
            'DB_FINAL_CLEANUP_PRINCIPAL',
            'DB_MAINTENANCE_PRINCIPAL',
            'DB_MIGRATOR_PRINCIPAL',
            'DB_BACKUP_PRINCIPAL',
            'DB_IDENTITY_PROJECT_ID',
            'DB_API_SERVICE_ACCOUNT',
            'DB_EVENT_SERVICE_ACCOUNT',
            'DB_WORKER_SERVICE_ACCOUNT',
            'DB_FINAL_CLEANUP_SERVICE_ACCOUNT',
        ]) {
            expect(bootstrapRunner).toContain(name);
        }
        expect(convergenceRunner).not.toContain('DATABASE_URL');
        expect(convergenceRunner).not.toContain('--password');
        expect(convergenceRunner).toContain("spawnSync('psql'");
        expect(convergenceRunner).toContain('env: process.env');
        expect(convergenceRunner).toContain('DB_IDENTITY_PROJECT_ID');
        expect(convergenceRunner).toContain('Runtime database identity is not the canonical');
    });

    it('separates CREATEROLE bootstrap from the application migration', () => {
        expect(bootstrapSql).toContain('role bootstrap requires a separately approved CREATEROLE');
        expect(bootstrapSql).toContain(
            'application database must be owned by the approved grant administrator',
        );
        expect(bootstrapSql).toContain('CREATE ROLE %I NOLOGIN NOSUPERUSER');
        expect(grantMigration).not.toMatch(/CREATE\s+ROLE/i);
        expect(grantMigration).toContain('run db:roles:bootstrap first');
        expect(grantMigration).toContain("pg_has_role(session_user, 'simsa_migrator', 'MEMBER')");
        expect(grantMigration).toContain("current_user <> 'simsa_migrator'");
        expect(grantMigration).not.toMatch(/GRANT\s+CREATE\s+ON\s+SCHEMA\s+public\s+TO\s+simsa_(api|event|worker|final_cleanup|maintenance)/i);
    });

    it('excludes extension-owned objects from ownership convergence', () => {
        expect(bootstrapSql).toContain('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public');
        expect(bootstrapSql).toContain('extension_record.extversion <> extension_record.default_version');
        expect(bootstrapSql).toContain("extension_record.schema_name <> 'public'");
        expect(bootstrapSql).toContain('extension_record.owner_name <> expected_owner');
        for (const catalog of ['pg_class', 'pg_proc', 'pg_type']) {
            expect(bootstrapSql).toContain(
                `d.classid = 'pg_catalog.${catalog}'::pg_catalog.regclass`,
            );
        }
        expect(bootstrapSql.match(/d\.deptype = 'e'/g)?.length ?? 0)
            .toBeGreaterThanOrEqual(6);
    });

    it('memasang pg_trgm hanya lewat langkah privileged 0003 administrator grant, tidak pernah di 0001 atau migrasi', () => {
        const baca = (relatif: string) => readFileSync(fileURLToPath(new URL(relatif, import.meta.url)), 'utf8');
        // Review I-1: drill restore Cloud SQL menjalankan ulang 0001 setelah pg_restore lalu
        // membandingkan bukti (termasuk baris extension) secara persis; arsip pre_migration /
        // pre_upgrade_0038 tidak memuat pg_trgm. 0001 karena itu tidak boleh menyentuhnya.
        expect(bootstrapSql).not.toMatch(/pg_trgm/);
        const trgm = baca('../db/grants/0003_optional_pg_trgm.sql');
        expect(trgm).not.toContain('\r');
        expect(trgm).toMatch(/^\\set ON_ERROR_STOP on$/m);
        expect(trgm).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public');
        expect(trgm).toContain('extension_record.extversion <> extension_record.default_version');
        expect(trgm).toContain("extension_record.schema_name <> 'public'");
        expect(trgm).toContain('extension_record.owner_name <> current_user');
        expect(trgm).toContain("pg_catalog.pg_has_role(current_user, 'simsa_migrator', 'USAGE')");
        expect(trgm.indexOf('$trgm_actor$')).toBeLessThan(trgm.indexOf('CREATE EXTENSION'));
        // GCP maintenance/preview: db:roles:bootstrap = 0001 lalu 0003, identitas yang sama,
        // sebelum fase migrate. Drill restore Cloud SQL memanggil psql 0001 langsung.
        expect(bootstrapRunner.indexOf("'../src/db/grants/0001_bootstrap_cloud_sql_roles.sql'"))
            .toBeLessThan(bootstrapRunner.indexOf("'../src/db/grants/0003_optional_pg_trgm.sql'"));
        expect(bootstrapRunner).toContain("'--set', 'ON_ERROR_STOP=on', '--file', trgmFile");
        const akar = (relatif: string) => baca(`../../../${relatif}`);
        const restoreDrill = akar('.github/workflows/backup-cloud-sql.yml');
        expect(restoreDrill).toContain('--file /grants/0001_bootstrap_cloud_sql_roles.sql');
        expect(restoreDrill).not.toMatch(/0003_optional_pg_trgm|db:roles:bootstrap/);
        // CI PG16/17/18: 0003 sebagai administrator grant setelah 0001, sebelum db:migrate.
        const ci = akar('.github/workflows/ci.yml');
        const bootstrapCi = ci.indexOf('--file /grants/0001_bootstrap_cloud_sql_roles.sql');
        const trgmCi = ci.indexOf('--file /grants/0003_optional_pg_trgm.sql');
        expect(bootstrapCi).toBeGreaterThan(0);
        expect(trgmCi).toBeGreaterThan(bootstrapCi);
        expect(trgmCi).toBeLessThan(ci.indexOf('DATABASE_URL="$MIGRATOR_DATABASE_URL" npm run db:migrate'));
        // Profil backup-upgrade: 0003 setelah bukti 0038, sebelum upgrade ke head; migrator ditolak.
        const upgrade = akar('.github/scripts/test-backup-upgrade-profile.mjs');
        expect(upgrade).toContain("psql('migrator cannot run the privileged pg_trgm step', trgmStep, { role: principals[5], rejected: true })");
        expect(upgrade.indexOf("psql('privileged pg_trgm step before 0049', trgmStep)"))
            .toBeLessThan(upgrade.indexOf('await migrateDatabase(upgrade)'));
        // Drill backup lokal (sumber) dan harness Postgres memakai berkas 0003 yang sama.
        expect(akar('scripts/local-backup-drill.mjs')).toContain("'backend/src/db/grants/0003_optional_pg_trgm.sql'");
        expect(baca('../../integration/helpers/rangkaian-db.ts')).toContain("'../../src/db/grants/0003_optional_pg_trgm.sql'");
        const migration = baca('../db/migrations/0049_lacak_trgm.sql');
        expect(migration).not.toMatch(/CREATE\s+EXTENSION/i);
        expect(migration).toContain("RAISE EXCEPTION '0049: extension pg_trgm belum dipasang");
        expect(migration).not.toContain('\r');
    });

    it('keeps event, worker, cleanup, and seed roles on explicit table grants', () => {
        expect(grantMigration).toContain('GRANT SELECT, UPDATE ON TABLE public.client_blob_uploads');
        expect(grantMigration).toContain('GRANT INSERT ON TABLE public.audit_log');
        expect(grantMigration).toContain('public.srikandi_outbox');
        expect(grantMigration).toContain('GRANT INSERT ON TABLE public.srikandi_outbox_audit');
        expect(grantMigration).toContain('public.ocr_processing_leases');
        expect(grantMigration).toContain(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.operational_heartbeats',
        );
        expect(grantMigration).toContain('TO simsa_maintenance');
        expect(grantMigration).not.toMatch(/ALL TABLES IN SCHEMA public\s+TO simsa_(event|worker|final_cleanup|maintenance)/i);
        // The cleanup table does not exist until 0033. 0032 only establishes
        // the identity boundary; 0033 owns its exact grants.
        expect(grantMigration).not.toMatch(/final_object_orphans/i);
    });

    it('provides fail-closed grant convergence for no-privileges disaster restores', () => {
        expect(convergenceSql).toContain("current_user <> 'simsa_migrator'");
        expect(convergenceSql).toContain("cardinality(actual_timestamps) <> pg_catalog.jsonb_array_length(expected_manifest)");
        expect(convergenceSql).toContain("value->'accepted_sha256' ? applied.hash");
        expect(convergenceRunner).toContain('EXPECTED_MIGRATIONS_JSON');
        expect(bootstrapSql).toContain('REVOKE %I FROM %I');
        expect(bootstrapSql).toContain('WITH ADMIN FALSE, INHERIT TRUE, SET FALSE');
        expect(bootstrapSql).toContain('WITH ADMIN FALSE, INHERIT TRUE, SET TRUE');
        expect(bootstrapSql).toContain('$stale_application_acl_convergence$');
        expect(convergenceSql).toContain('$final_acl_preflight$');
        expect(bootstrapSql).toContain("'simsa_backup_reader'");
        expect(bootstrapSql).toContain('GRANT pg_read_all_data TO simsa_backup_reader');
        const databaseAclConvergence = bootstrapSql.slice(
            bootstrapSql.indexOf('DO $database_acl_convergence$'),
            bootstrapSql.indexOf('$database_acl_convergence$;',
                bootstrapSql.indexOf('DO $database_acl_convergence$')),
        );
        expect(databaseAclConvergence).not.toContain('pg_read_all_data');
        expect(bootstrapSql).toContain('REVOKE ALL ON DATABASE :"database_name" FROM');
        expect(convergenceSql).toContain(
            "acl_grantee.grantee_name = 'simsa_backup_reader'",
        );
        expect(convergenceSql).toContain("'simsa_migrator', pg_catalog.current_database(), 'CREATE'");
        expect(convergenceSql).toContain('REVOKE ALL PRIVILEGES (%s) ON TABLE');
        expect(convergenceSql).toContain('d.deptype = \'e\'');
        expect(convergenceSql).toContain('FROM PUBLIC');
        expect(grantMigration).toContain(
            'ALTER DEFAULT PRIVILEGES FOR ROLE simsa_migrator\n    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
        );
        expect(convergenceSql).toContain(
            'ALTER DEFAULT PRIVILEGES FOR ROLE simsa_migrator\n    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
        );
        expect(convergenceSql).toContain(
            'GRANT EXECUTE ON FUNCTION public.simsa_mark_final_object_reference_candidate',
        );
        expect(convergenceSql).toContain(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.operational_heartbeats',
        );
        expect(convergenceSql).toContain('public.srikandi_outbox');
        expect(convergenceSql).not.toMatch(/PASSWORD\s+['":]|PGPASSWORD|credentials_json/i);
    });

    it('rejects every unexpected direct, transitive, and SET ROLE path', () => {
        for (const sql of [bootstrapSql, convergenceSql]) {
            expect(sql).toContain('WITH RECURSIVE expected(principal, policy_role)');
            expect(sql).toContain('membership_closure(principal, reachable_role)');
            expect(sql).toMatch(/(?:member\.rolname|expected\.policy_role) = 'simsa_backup_reader'/);
            expect(sql).toContain("parent.rolname = 'pg_read_all_data'");
            expect(sql).toContain('membership.set_option = expected.allows_set');
            expect(sql).toContain('SIMSA policy roles expose an unexpected parent or SET ROLE path');
        }
        expect(bootstrapSql).toContain(
            'unexpected direct or transitive workload role membership must be removed before bootstrap',
        );
        expect(readinessSource).toContain('runtime_membership_closure(role_name)');
        expect(readinessSource).toContain(
            "NOT pg_catalog.pg_has_role(current_user, 'simsa_migrator', 'MEMBER')",
        );
        expect(readinessSource).toContain("role_name <> 'simsa_api_runtime'");
        expect(eventReadinessSource).toContain('runtime_membership_closure(role_name)');
        expect(eventReadinessSource).toContain("role_name <> 'simsa_event_runtime'");
        expect(eventReadinessSource).toContain('AND NOT membership.set_option');
    });

    it('binds runtime logins to canonical Terraform service accounts in one project', () => {
        for (const source of [bootstrapSql, convergenceSql]) {
            expect(source).toContain('simsa_grants.identity_project_id');
            expect(source).toContain('simsa-api-runtime@');
            expect(source).toContain('simsa-event-runtime@');
            expect(source).toContain('simsa-malware-worker@');
            expect(source).toContain('simsa-final-cleanup@');
            expect(source).toContain('[.]gserviceaccount[.]com$');
        }
    });

    it('keeps rangkaian berkas tables append-only for the API across convergence', () => {
        for (const table of [
            'rangkaian_surat',
            'rangkaian_anggota',
            'rangkaian_relasi',
            'rangkaian_peserta',
            'rangkaian_koreksi_berkas',
        ]) {
            expect(convergenceSql).toContain(`'${table}'`);
        }
        expect(convergenceSql).toContain(
            "EXECUTE pg_catalog.format('REVOKE DELETE ON TABLE public.%I FROM simsa_api_runtime', relation_name)",
        );
        // Restore/upgrade drill memakai skema lama (0038): tabel yang belum ada dilewati.
        expect(convergenceSql).toContain("pg_catalog.to_regclass(pg_catalog.format('public.%I', relation_name))");
        const grantIndex = convergenceSql.indexOf('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public');
        const revokeIndex = convergenceSql.indexOf('$rangkaian_append_only$');
        expect(grantIndex).toBeGreaterThan(0);
        expect(revokeIndex).toBeGreaterThan(grantIndex);
    });
});
