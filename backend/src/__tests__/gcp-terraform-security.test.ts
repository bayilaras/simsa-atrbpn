import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function terraformFile(name: string): string {
    return readFileSync(new URL(
        `../../../docs/infra/firebase-gcp/terraform/${name}`,
        import.meta.url,
    ), 'utf8');
}

function repositoryFile(path: string): string {
    return readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

function terraformResourceBody(source: string, type: string, name: string): string {
    const body = source.match(new RegExp(
        `resource "${type}" "${name}" \\{(?<body>[\\s\\S]*?)\\n\\}`,
    ))?.groups?.body;
    expect(body, `missing Terraform resource ${type}.${name}`).toBeDefined();
    return body!;
}

describe('GCP Terraform least-privilege contract', () => {
    it('does not allow caller labels to override environment identity labels', () => {
        const locals = terraformFile('locals.tf');
        const labels = locals.match(/labels\s*=\s*merge\((?<body>[\s\S]*?)\n\s*\)/)?.groups?.body;

        expect(labels).toBeDefined();
        expect(labels!.indexOf('var.labels')).toBeLessThan(labels!.indexOf('application = "simsa"'));
        expect(labels).toContain('environment = var.environment');
        expect(labels).toContain('managed_by  = "terraform"');
        expect(labels).toContain('data_class  = "internal"');
    });

    it('pins API and Eventarc to one reviewed digest in the isolated environment registry', () => {
        const locals = terraformFile('locals.tf');

        expect(locals).toContain('check "backend_image_boundary"');
        expect(locals).toContain(
            'startswith(var.api_image, "${var.region}-docker.pkg.dev/${var.project_id}/")',
        );
        expect(locals).toContain(
            'startswith(var.event_image, "${var.region}-docker.pkg.dev/${var.project_id}/")',
        );
        expect(locals).toContain('check "backend_image_parity"');
        expect(locals).toContain('var.event_image == var.api_image');
    });

    it('rejects Firebase Hosting default domains from a sibling environment project', () => {
        const locals = terraformFile('locals.tf');

        expect(locals).toContain('check "firebase_hosting_origin_boundary"');
        expect(locals).toContain('"https://${var.project_id}.web.app"');
        expect(locals).toContain('"https://${var.project_id}.firebaseapp.com"');
    });

    it('enables both APIs required by the enforced reCAPTCHA Enterprise App Check flow', () => {
        const services = terraformFile('services.tf');
        const cloudRun = terraformFile('cloud-run.tf');
        const variables = terraformFile('variables.tf');

        expect(services).toContain('"firebaseappcheck.googleapis.com"');
        expect(services).toContain('"recaptchaenterprise.googleapis.com"');
        expect(variables).toContain('variable "firebase_app_check_app_ids"');
        expect(cloudRun).toContain('FIREBASE_APP_CHECK_APP_IDS');
        expect(cloudRun).toContain('var.firebase_app_check_app_ids');
    });

    it('does not grant the storage event receiver access to the final bucket', () => {
        const storage = terraformFile('storage.tf');
        const finalMembers = storage.match(
            /final_bucket_members\s*=\s*\{(?<members>[\s\S]*?)\n\s*\}/,
        )?.groups?.members;

        expect(finalMembers).toBeDefined();
        expect(finalMembers).toContain('google_service_account.api.member');
        expect(finalMembers).not.toContain('google_service_account.events.member');
    });

    it('limits the event receiver on the upload bucket to exact-object deletion', () => {
        const storage = terraformFile('storage.tf');
        const serviceAccounts = terraformFile('service-accounts.tf');
        const eventRole = terraformResourceBody(
            serviceAccounts,
            'google_project_iam_custom_role',
            'event_upload_cleanup',
        );

        expect(storage).toContain('google_project_iam_custom_role.event_upload_cleanup.name');
        expect(storage).toContain('member = google_service_account.events.member');
        expect(eventRole).toContain('"storage.objects.delete"');
        expect(eventRole).not.toContain('"storage.objects.get"');
        expect(eventRole).not.toContain('"storage.objects.list"');
        expect(storage.match(/upload_bucket_members\s*=\s*\{[\s\S]*?\n\s*\}/)?.[0])
            .not.toContain('google_service_account.events.member');
    });

    it('scopes API object access per bucket without objectUser, list, update, or final delete', () => {
        const storage = terraformFile('storage.tf');
        const serviceAccounts = terraformFile('service-accounts.tf');
        const quarantineRole = terraformResourceBody(
            serviceAccounts,
            'google_project_iam_custom_role',
            'api_quarantine_runtime',
        );
        const finalRole = terraformResourceBody(
            serviceAccounts,
            'google_project_iam_custom_role',
            'api_final_runtime',
        );

        for (const permission of [
            'storage.objects.create',
            'storage.objects.delete',
            'storage.objects.get',
        ]) {
            expect(quarantineRole).toContain(`"${permission}"`);
        }
        expect(quarantineRole).not.toContain('"storage.objects.list"');
        expect(quarantineRole).not.toContain('"storage.objects.update"');
        expect(quarantineRole).not.toContain('"storage.buckets.get"');
        expect(finalRole).not.toContain('"storage.buckets.get"');
        expect(finalRole).toContain('"storage.objects.create"');
        expect(finalRole).toContain('"storage.objects.get"');
        expect(finalRole).not.toContain('"storage.buckets.list"');
        expect(finalRole).not.toContain('"storage.objects.delete"');
        expect(finalRole).not.toContain('"storage.objects.list"');
        expect(finalRole).not.toContain('"storage.objects.update"');
        expect(storage).not.toContain('roles/storage.objectUser');
        expect(storage).toContain('google_project_iam_custom_role.api_quarantine_runtime.name');
        expect(storage).toContain('google_project_iam_custom_role.api_final_runtime.name');
    });

    it('lets the database evidence identity read only project and bucket metadata', () => {
        const serviceAccounts = terraformFile('service-accounts.tf');
        const evidenceRole = terraformResourceBody(
            serviceAccounts,
            'google_project_iam_custom_role',
            'database_evidence_metadata_reader',
        );

        expect(evidenceRole).toContain('"resourcemanager.projects.get"');
        expect(evidenceRole).toContain('"storage.buckets.get"');
        expect(evidenceRole).not.toContain('"storage.buckets.list"');
        expect(evidenceRole).not.toContain('"storage.objects.');
        expect(serviceAccounts).toContain(
            'member  = google_service_account.grant_admin.member',
        );
        expect(serviceAccounts).toContain(
            'role    = google_project_iam_custom_role.database_evidence_metadata_reader.name',
        );
    });

    it('gives the worker exact bucket-level permissions without final delete or object listing', () => {
        const storage = terraformFile('storage.tf');
        const serviceAccounts = terraformFile('service-accounts.tf');
        const quarantineRole = terraformResourceBody(
            serviceAccounts,
            'google_project_iam_custom_role',
            'worker_quarantine_runtime',
        );
        const finalRole = terraformResourceBody(
            serviceAccounts,
            'google_project_iam_custom_role',
            'worker_final_runtime',
        );

        expect(quarantineRole).toContain('"storage.objects.get"');
        expect(quarantineRole).toContain('"storage.objects.delete"');
        expect(quarantineRole).not.toContain('"storage.objects.list"');
        expect(quarantineRole).not.toContain('"storage.objects.create"');
        expect(finalRole).toContain('"storage.objects.get"');
        expect(finalRole).toContain('"storage.objects.create"');
        expect(finalRole).not.toContain('"storage.objects.delete"');
        expect(finalRole).not.toContain('"storage.objects.list"');
        expect(storage).toContain('google_storage_bucket_iam_member" "worker_quarantine_runtime');
        expect(storage).toContain('google_storage_bucket_iam_member" "worker_final_runtime');
    });

    it('isolates exact-generation final cleanup from both API and malware worker identities', () => {
        const storage = terraformFile('storage.tf');
        const serviceAccounts = terraformFile('service-accounts.tf');
        const cloudRun = terraformFile('cloud-run.tf');
        const database = terraformFile('database.tf');
        const cleanupRole = terraformResourceBody(
            serviceAccounts,
            'google_project_iam_custom_role',
            'final_cleanup_runtime',
        );

        expect(cleanupRole).toContain('"storage.objects.get"');
        expect(cleanupRole).toContain('"storage.objects.delete"');
        expect(cleanupRole).not.toContain('"storage.objects.list"');
        expect(cleanupRole).not.toContain('"storage.objects.create"');
        expect(cleanupRole).not.toContain('"storage.objects.update"');
        expect(storage).toContain('google_storage_bucket_iam_member" "final_cleanup_runtime');
        expect(storage).toContain('member = google_service_account.final_cleanup.member');
        expect(database).toContain('google_sql_user" "final_cleanup');
        expect(cloudRun).toContain('google_cloud_run_v2_job" "final_cleanup');
        expect(cloudRun).toContain('service_account = google_service_account.final_cleanup.email');
        expect(cloudRun).toContain('dist/workers/final-object-orphan-reconciliation.js');
        expect(cloudRun).toContain('google_cloud_scheduler_job" "final_cleanup');
        expect(cloudRun).toContain('google_service_account.cleanup_scheduler.email');
        expect(cloudRun).toContain('"--quitquitquit"');
        expect(cloudRun).toContain('CLOUD_SQL_PROXY_SHUTDOWN_URL');
        expect(cloudRun).toContain('FINAL_RETENTION_SECONDS');
        expect(cloudRun).toContain('tostring(var.final_retention_seconds)');
    });

    it('fences the orphan queue with narrowly versioned PostgreSQL privileges', () => {
        const migration = repositoryFile(
            'backend/src/db/migrations/0033_final_object_orphan_queue.sql',
        );

        expect(migration).toContain('SECURITY DEFINER');
        expect(migration).toContain('SET search_path = pg_catalog, public');
        expect(migration).toContain("status IN ('pending', 'retry')");
        expect(migration).toContain(
            "greatest(not_before, candidate_not_before, now() + interval '1 hour')",
        );
        expect(migration).toContain(
            'GRANT INSERT ON TABLE public.final_object_orphans TO simsa_worker_runtime',
        );
        expect(migration).toContain(
            'GRANT SELECT (final_locator, final_object_generation)',
        );
        expect(migration).toContain(
            'GRANT SELECT, UPDATE ON TABLE public.final_object_orphans TO simsa_final_cleanup',
        );
        expect(migration).not.toContain(
            'GRANT SELECT, UPDATE ON TABLE public.final_object_orphans TO simsa_worker_runtime',
        );
        expect(migration).toContain('simsa_api_runtime');
        expect(migration).toContain('REVOKE ALL ON TABLE public.final_object_orphans');
        expect(migration).toContain('simsa_reserve_api_final_object_candidate');
        expect(migration).toContain('simsa_record_api_final_object_candidate');
        expect(migration).toContain('simsa_mark_api_final_object_referenced');
        expect(migration).toContain("'api_final'");
        expect(migration).toContain('cleanup_token');
        expect(migration).toContain('TO simsa_api_runtime');
        expect(migration).not.toContain(
            'GRANT DELETE ON TABLE public.final_object_orphans TO simsa_api_runtime',
        );
    });

    it('keeps the persistent worker private, shielded, keyless, and digest-pinned', () => {
        const worker = terraformFile('worker.tf');
        const serviceAccounts = terraformFile('service-accounts.tf');

        expect(worker).not.toMatch(/\n\s*access_config\s*\{/);
        expect(worker).toContain('enable_secure_boot          = true');
        expect(worker).toContain('enable_vtpm                 = true');
        expect(worker).toContain('enable_integrity_monitoring = true');
        expect(worker).toContain('scopes = ["https://www.googleapis.com/auth/cloud-platform"]');
        expect(worker).toContain('attached_disk {');
        expect(worker).toContain('prevent_destroy = true');
        expect(worker).not.toContain('GOOGLE_APPLICATION_CREDENTIALS');
        expect(serviceAccounts).not.toContain('google_service_account_key');
    });

    it('uses VM ADC and Unix sockets for Compose without a Blob sentinel or JSON key', () => {
        const compose = repositoryFile('deploy/workers/compose.gcp.yml');
        const bootstrap = repositoryFile('deploy/workers/bootstrap-gcp.sh');

        expect(compose).toContain('--auto-iam-authn');
        expect(compose).toContain('--private-ip');
        expect(compose).toContain('--unix-socket=/cloudsql');
        expect(compose).toContain('BLOB_READ_WRITE_TOKEN: ""');
        expect(compose).not.toContain('unused-with-gcs');
        expect(compose).not.toContain('GOOGLE_APPLICATION_CREDENTIALS');
        expect(bootstrap).toContain('gcloud --quiet auth print-access-token');
        expect(bootstrap).toContain('-d 169.254.169.254/32 -j REJECT');
        expect(bootstrap).not.toContain('service-account.json');
    });

    it('schedules exact-generation quarantine reconciliation on the persistent host', () => {
        const timer = repositoryFile('deploy/workers/simsa-blob-reconciler.timer');
        const service = repositoryFile('deploy/workers/simsa-blob-reconciler.service');

        expect(timer).toContain('OnUnitActiveSec=1h');
        expect(timer).toContain('Persistent=true');
        expect(service).toContain('--profile maintenance');
        expect(service).toContain('blob-reconciler');
    });

    it('validates Terraform in CI with full-SHA-pinned official actions', () => {
        const workflow = repositoryFile('.github/workflows/terraform-validate.yml');

        expect(workflow).toMatch(
            /uses: actions\/checkout@[0-9a-f]{40}\s+# v4/,
        );
        expect(workflow).toMatch(
            /uses: hashicorp\/setup-terraform@[0-9a-f]{40}\s+# v3\.1\.2/,
        );
        expect(workflow).toContain('terraform fmt -check -recursive -diff');
        expect(workflow).toContain('terraform init -backend=false -input=false');
        expect(workflow).toContain('terraform validate -no-color');
    });

    it('uses a minimal Firebase session role instead of Firebase Auth Admin', () => {
        const serviceAccounts = terraformFile('service-accounts.tf');

        expect(serviceAccounts).not.toContain('roles/firebaseauth.admin');
        expect(serviceAccounts).toContain('google_project_iam_custom_role');
        for (const permission of [
            'firebaseauth.configs.get',
            'firebaseauth.users.create',
            'firebaseauth.users.createSession',
            'firebaseauth.users.delete',
            'firebaseauth.users.get',
            'firebaseauth.users.update',
        ]) {
            expect(serviceAccounts).toContain(`"${permission}"`);
        }
        for (const forbidden of [
            'firebaseauth.configs.update',
        ]) {
            expect(serviceAccounts).not.toContain(`"${forbidden}"`);
        }
    });

    it('provisions a dedicated keyless Cloud SQL backup reader without storage IAM', () => {
        const serviceAccounts = terraformFile('service-accounts.tf');
        const database = terraformFile('database.tf');
        const outputs = terraformFile('outputs.tf');
        const storage = terraformFile('storage.tf');

        expect(serviceAccounts).toContain('google_service_account" "backup');
        expect(serviceAccounts).toContain('backup      = google_service_account.backup.member');
        expect(database).toContain('google_sql_user" "backup');
        expect(database).toContain('google_service_account.backup.email');
        expect(outputs).toContain('output "cloud_sql_backup_identity"');
        expect(outputs).toContain('backup_principal');
        expect(storage).not.toContain('google_service_account.backup.member');
    });
});
