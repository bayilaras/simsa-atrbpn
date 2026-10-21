#!/usr/bin/env node
// Diagnostics for a failing `neon-backup.mjs create`: the same configuration,
// connection and snapshot steps as the checkout's helper, but each failure is
// shown with its code and a filtered message. Writes neither a bundle nor a
// key. Run via `rilis-neon.ps1 -Action diag-backup`, which supplies
// NEON_BACKUP_DATABASE_URL and the pinned host/database.
import { createRequire } from 'node:module';
import { getCACertificates } from 'node:tls';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** Removes URLs, SCRAM verifiers and anything that follows "password". */
export const redact = value => String(value ?? '')
  .replace(/postgres(?:ql)?:\/\/\S+/gi, '<url>')
  .replace(/SCRAM-SHA-256\$\S+/g, '<verifier>')
  .replace(/(password|passwd|pwd)\S*/gi, '$1<hidden>')
  .slice(0, 400);

async function diagnose({ checkout, pgBin, output }) {
  const load = file => import(pathToFileURL(join(checkout, 'scripts', file)).href);
  const { Client } = createRequire(join(checkout, 'backend', 'package.json'))('pg');
  const { parseNeonBackupOperation } = await load('neon-backup-core.mjs');
  const { makeBackupWorkspace } = await load('neon-backup-runtime.mjs');
  const { captureNeonSnapshot } = await load('neon-backup.mjs');
  const report = (step, error) => console.log(`${step}: GAGAL code=${redact(error?.code) || '-'} pesan=${redact(error?.message)}`);

  let operation;
  try {
    operation = parseNeonBackupOperation(['create', '--pg-bin', pgBin, '--output', output, '--key-directory', output], process.env);
    console.log('konfigurasi: ok');
  } catch (error) { report('konfigurasi', error); return 1; }

  const client = new Client(operation.clientConfig);
  client.on('error', () => {});
  try {
    await client.connect();
    const { rows: [row] } = await client.query(`SELECT current_user AS role, current_database() AS db,
      current_setting('server_version') AS server, (SELECT count(*) FROM drizzle.__drizzle_migrations)::int AS migrations`);
    console.log('koneksi:', JSON.stringify(row));
  } catch (error) { report('koneksi', error); return 1; }
  finally { await client.end().catch(() => {}); }

  let plain;
  try {
    const workspace = await makeBackupWorkspace(pgBin, output, 'neon-diag-');
    const certificate = join(workspace.directory, 'trusted-roots.pem');
    await writeFile(certificate, getCACertificates('default').join('\n'), { flag: 'wx', mode: 0o600 });
    const c = operation.clientConfig;
    const environment = { ...workspace.environment, PGHOST: c.host, PGPORT: '5432', PGDATABASE: c.database, PGUSER: c.user, PGPASSWORD: c.password,
      PGSSLMODE: 'verify-full', PGSSLROOTCERT: certificate, PGCHANNELBINDING: 'require', PGCONNECT_TIMEOUT: '15',
      PGOPTIONS: '-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=120000' };
    plain = await captureNeonSnapshot({ client: new Client(c), command: workspace.command, environment, source: operation.source });
    console.log(`snapshot: ok archive=${plain.archive.length} byte evidence=${plain.evidence.length} byte snapshot_at=${plain.snapshot_at}`);
    console.log(`folder diagnostik (tanpa data): ${workspace.directory}`);
    return 0;
  } catch (error) {
    report('snapshot', error);
    console.log(redact(error?.stack).split('\n').slice(1, 4).join(' | '));
    return 1;
  } finally { plain?.archive.fill(0); plain?.evidence.fill(0); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { checkout: { type: 'string' }, 'pg-bin': { type: 'string' }, output: { type: 'string' } } });
  if (!values.checkout || !values['pg-bin'] || !values.output) {
    console.error('Gunakan: rilis-neon.ps1 -Action diag-backup (memerlukan --checkout, --pg-bin, --output).');
    process.exitCode = 1;
  } else process.exitCode = await diagnose({ checkout: resolve(values.checkout), pgBin: resolve(values['pg-bin']), output: resolve(values.output) });
}
