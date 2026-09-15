#!/usr/bin/env node
/** Encrypted backup of the pinned local database; recovery only into a NEW cluster. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve, dirname } from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';
import { createServer, createConnection } from 'node:net';
import { createWriteStream } from 'node:fs';
import { lstat, realpath, readFile, writeFile, mkdir, mkdtemp, appendFile, open, rename } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { assertReviewedMigrationManifest } from './migration-manifest.mjs';
import { MAX_ARCHIVE_BYTES, MAX_EVIDENCE_BYTES, sha256, requireCondition, strictPath, sterileEnvironment,
  createEncryptor, encryptBuffer, normalizeEvidence, extractBackupGuard,
  WINDOWS_ACL_PROBE_SCRIPT, assertWindowsPrivateAcl, LOCAL_POSTGRES_ISOLATION_CONFIG,
  nativePostgresOptions, CLUSTER_IDENTITY_SQL, awaitPostgresLauncherExit, isPermittedMetadataInputClose,
} from './local-backup-drill-core.mjs';
import { CURRENT_FORMAT, SOURCE, samePath, assertTargetLocation, assertTargetIdentity,
  assertSourceIdentity, SOURCE_IDENTITY_SQL, parseCurrentArguments, sealManifest, authenticateManifest,
  decryptRecoveryContents, assertSeparateKey, sourceProbeEnvironment, finalizeWithOwnedLock, releaseOwnedLock,
  monitorSnapshotConnection, parsePrivateJson } from './local-current-backup-core.mjs';

const repository = resolve(import.meta.dirname, '..');
const runtime = join(repository, 'output/local-runtime');
const helpers = ['.github/scripts/build-migration-manifest.py', '.github/scripts/collect-backup-evidence.sql',
  '.github/scripts/prepare-restore-role-aliases.py', '.github/workflows/backup-cloud-sql.yml',
  'backend/src/db/grants/0001_bootstrap_cloud_sql_roles.sql', 'backend/src/db/grants/0002_converge_application_grants.sql',
  'scripts/migration-manifest.mjs', 'backend/scripts/migrate-database.mjs'];
const sourceProofScript = `$ErrorActionPreference='Stop'; . (Join-Path $env:SIMSA_BACKUP_REPOSITORY 'scripts/windows/local-runtime.ps1');
  $c=Read-LauncherConfiguration $env:SIMSA_BACKUP_REPOSITORY; $s=Get-DatabaseStatus $c;
  if(-not $s.running){throw 'Pinned source is not running'};
  $p=@(Get-Content -LiteralPath (Join-Path $c.dataDirectory 'postmaster.pid'));
  @{systemIdentifier=[string]$c.systemIdentifier;port=$c.postgresPort;major=$c.postgresMajor;
    running=$s.running;startedEpoch=[double]$p[2]} | ConvertTo-Json -Compress`;

async function boundedFile(file, maximum) {
  const stat = await lstat(file);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maximum,
    'Input file is missing, unsafe, or exceeds its bounded size');
  requireCondition(samePath(await realpath(file), file), 'Input file must have a canonical physical path');
  return readFile(file);
}

export async function runCurrentBackup(options) {
  requireCondition(process.platform === 'win32' && process.versions.node.split('.')[0] === '24', 'Requires Windows and prepared Node 24');
  const config = JSON.parse(await boundedFile(join(runtime, 'local-launcher.json'), 8192));
  requireCondition(config.format === 1 && config.postgresPort === SOURCE.port && config.postgresMajor === SOURCE.major
    && config.systemIdentifier === SOURCE.systemIdentifier && samePath(config.dataDirectory, join(runtime, 'postgres-data'))
    && samePath(process.execPath, config.nodePath), 'Pinned launcher metadata does not match this checkout');
  const pgBin = strictPath(config.postgresBin, 'PostgreSQL bin');
  const binary = name => join(pgBin, `${name}.exe`);
  for (const file of [options.python, ...['initdb', 'pg_ctl', 'pg_controldata', 'psql', 'pg_dump', 'pg_restore'].map(binary)]) {
    requireCondition((await lstat(file)).isFile() && samePath(await realpath(file), file), 'Prepared tool path is not a physical file');
  }
  const operationId = randomBytes(16).toString('hex');
  const parent = join(repository, options.action === 'backup' ? 'output/local-backups' : 'output/backup-verification');
  await mkdir(parent, { recursive: true });
  requireCondition(!(await lstat(parent)).isSymbolicLink() && samePath(await realpath(parent), parent), 'Output directory must be physical');
  const runDir = await mkdtemp(join(parent, `${operationId}-`));
  const privateDir = join(runDir, 'private');
  let environment = sterileEnvironment(process.env, { privateDir: runDir, pgBin, nodePath: process.execPath });
  const powershell = join(environment.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const secrets = [];
  let sequence = 0, snapshotClient, snapshotMonitor, target, failure, completed = false;
  const snapshotAbort = new AbortController();
  const started = Date.now();
  const report = { format: CURRENT_FORMAT, action: options.action, operation_id: operationId,
    scope: 'database-only', started_at: new Date(started).toISOString(), source: SOURCE, steps: [] };
  const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), String(value));

  async function command(label, executable, args, { input, env = environment, maximum = 4 * 1024 * 1024,
    timeout = 120_000, capture = true, metadata = false } = {}) {
    snapshotAbort.signal.throwIfAborted();
    const child = spawn(executable, args, { cwd: runDir, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], signal: snapshotAbort.signal });
    const out = [], err = []; let size = 0, error;
    const collect = items => data => { size += data.length; if (size > maximum) { error = new Error(`${label}: output limit exceeded`); child.kill(); } else items.push(data); };
    if (capture) child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    child.stdin.on('error', value => { if (!isPermittedMetadataInputClose(value, { allowEarlyStdinClose: metadata })) error = value; });
    const done = new Promise((yes, no) => { child.once('error', no); child.once('close', yes); }); done.catch(() => {});
    const timer = setTimeout(() => { error = new Error(`${label}: timeout`); child.kill(); }, timeout);
    child.stdin.end(input);
    const finish = async () => {
      let code; try { code = await done; } finally { clearTimeout(timer); }
      const output = Buffer.concat(out).toString('utf8'), stderr = Buffer.concat(err).toString('utf8');
      if ((await lstat(privateDir).catch(() => null))?.isDirectory()) await writeFile(join(privateDir, `${++sequence}-${label}.log`), redact(output + stderr), { flag: 'wx' });
      if (error) throw error;
      requireCondition(code === 0, `${label} failed (exit ${code}); inspect private logs`);
      return output;
    };
    return capture ? finish() : { child, finish };
  }
  const sid = (await command('current-user', join(environment.SystemRoot, 'System32/whoami.exe'), ['/user', '/fo', 'csv', '/nh'])).match(/S-1-5-[0-9-]+/g);
  requireCondition(sid?.length === 1, 'Cannot establish exact Windows user');
  async function secureDirectory(directory) {
    await command('restrict-acl', join(environment.SystemRoot, 'System32/icacls.exe'), [directory, '/inheritance:r', '/grant:r', `*${sid[0]}:(OI)(CI)F`]);
    await verifyPrivateDirectory(directory);
  }
  async function verifyPrivateDirectory(directory) {
    const proof = await command('verify-acl', powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_ACL_PROBE_SCRIPT],
      { env: { ...environment, SIMSA_DRILL_ACL_TARGET: directory } });
    assertWindowsPrivateAcl(JSON.parse(proof), sid[0]);
  }
  async function sourceProof() {
    return JSON.parse(await command('pinned-source-identity', powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', sourceProofScript],
      { env: sourceProbeEnvironment(environment, repository) }));
  }
  function connection(cluster, user = cluster.admin, database = 'postgres', readonly = false) {
    return { ...environment, PGPORT: String(cluster.port), PGUSER: user, PGDATABASE: database, PGPASSWORD: cluster.password,
      PGOPTIONS: environment.PGOPTIONS + (readonly ? ' -c default_transaction_read_only=on' : '') };
  }
  async function psql(cluster, sql, { user = cluster.admin, database = 'postgres', variables = {}, readonly = false, mutation = false, label = 'psql' } = {}) {
    if (mutation) { requireCondition(cluster === target, 'Only the newly owned restore target can be mutated'); await guardTarget(); }
    const args = ['--no-psqlrc', '--no-password', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=on'];
    for (const [key, value] of Object.entries(variables)) args.push('--set', `${key}=${value}`);
    return command(label, binary('psql'), args, { input: sql, env: connection(cluster, user, database, readonly) });
  }
  async function targetDisk() {
    assertTargetLocation(repository, target.dataDir, target.port);
    requireCondition(dirname(target.dataDir) === privateDir && samePath(await realpath(target.dataDir), target.dataDir)
      && !(await lstat(target.dataDir)).isSymbolicLink(), 'Restore directory physical ownership mismatch');
    const control = await command('restore-control', binary('pg_controldata'), [target.dataDir]);
    const identifier = /^Database system identifier:\s+([0-9]{10,30})\s*$/m.exec(control)?.[1];
    requireCondition(identifier && identifier !== SOURCE.systemIdentifier && (!target.systemIdentifier || target.systemIdentifier === identifier), 'Restore system identifier mismatch');
    return identifier;
  }
  async function guardTarget() {
    await targetDisk();
    assertTargetIdentity(JSON.parse((await psql(target, CLUSTER_IDENTITY_SQL, { label: 'restore-identity' })).trim()), target, repository);
  }
  async function freePort(port) {
    requireCondition(port !== SOURCE.port, 'Source port is forbidden');
    await new Promise((yes, no) => { const server = createServer(); server.once('error', no);
      server.listen({ host: SOURCE.host, port, exclusive: true }, () => server.close(yes)); });
  }
  async function createTarget() {
    let port;
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = randomInt(40000, 60000); if (candidate === SOURCE.port) continue;
      try { await freePort(candidate); port = candidate; break; } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
    }
    requireCondition(port, 'No unused generated loopback port');
    target = { dataDir: join(privateDir, 'restore-data'), admin: 'simsa_restore_admin', port, password: randomBytes(32).toString('hex') };
    secrets.push(target.password); assertTargetLocation(repository, target.dataDir, port);
    requireCondition(!(await lstat(target.dataDir).catch(() => null)), 'Existing target directory is forbidden');
    const passwordFile = join(privateDir, 'init-password.txt'); await writeFile(passwordFile, target.password + '\n', { flag: 'wx' });
    await command('initdb-restore', binary('initdb'), ['--pgdata', target.dataDir, '--username', target.admin, '--pwfile', passwordFile,
      '--encoding=UTF8', '--no-locale', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256']);
    target.systemIdentifier = await targetDisk();
    await appendFile(join(target.dataDir, 'postgresql.conf'), LOCAL_POSTGRES_ISOLATION_CONFIG);
    await freePort(port);
    const log = await open(join(privateDir, 'start-restore.log'), 'wx'); target.startAttempted = true;
    try {
      const child = spawn(binary('pg_ctl'), ['--pgdata', target.dataDir, '--log', join(privateDir, 'restore-postgres.log'),
        '-o', nativePostgresOptions(port), '-w', '-t', '30', 'start'],
      { cwd: privateDir, env: environment, shell: false, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
      await awaitPostgresLauncherExit(child);
    } finally { await log.close(); }
    await guardTarget();
  }
  async function stopTarget() {
    if (!target?.startAttempted) return;
    await targetDisk();
    const pid = await readFile(join(target.dataDir, 'postmaster.pid'), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (pid !== null) {
      const fields = pid.replaceAll('\r\n', '\n').split('\n');
      requireCondition(/^[1-9][0-9]*$/.test(fields[0]) && samePath(fields[1], target.dataDir) && Number(fields[3]) === target.port, 'Restore PID identity changed; refusing stop');
      await guardTarget();
      await command('stop-owned-restore', binary('pg_ctl'), ['--pgdata', target.dataDir, '-m', 'fast', '-w', '-t', '30', 'stop']);
    }
    requireCondition(!(await lstat(join(target.dataDir, 'postmaster.pid')).catch(() => null)), 'Restore PID remains after stop');
    await new Promise((yes, no) => { const socket = createConnection({ host: SOURCE.host, port: target.port });
      socket.once('connect', () => { socket.destroy(); no(new Error('Restore socket is still listening')); });
      socket.once('error', error => error.code === 'ECONNREFUSED' ? yes() : no(error));
      socket.setTimeout(3000, () => { socket.destroy(); no(new Error('Cannot verify restore shutdown')); }); });
    report.target_stopped = true;
  }
  async function helperHashes() { return Object.fromEntries(await Promise.all(helpers.map(async file => [file, sha256(await readFile(join(repository, file)))]))); }
  async function publishStatus() {
    const file = join(runtime, 'local-backup-status.json');
    const previous = JSON.parse(await readFile(file, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return '{"format":1}'; }));
    const item = { status: report.status, at: report.finished_at, snapshot_at: report.snapshot_at, run_id: report.run_id,
      duration_seconds: report.duration_seconds, report_path: join(runDir, 'result.json'), scope: report.scope };
    previous.lastAttempt = { ...item, action: options.action };
    if (report.status === 'passed') previous[options.action === 'backup' ? 'lastBackup' : 'lastVerification'] = item;
    await writeFile(file + `.${operationId}.tmp`, JSON.stringify(previous, null, 2) + '\n', { flag: 'wx' });
    await rename(file + `.${operationId}.tmp`, file);
  }
  const lockPath = join(runtime, 'local-backup.lock'); let lock;
  try {
    lock = await open(lockPath, 'wx'); await lock.writeFile(JSON.stringify({ pid: process.pid, operation_id: operationId }));
    await secureDirectory(runDir); await mkdir(privateDir);
    environment = sterileEnvironment(process.env, { privateDir, pgBin, nodePath: process.execPath });
    for (const name of ['empty.pgpass', 'empty.pgservice']) await writeFile(join(privateDir, name), '', { flag: 'wx' });
    for (const name of ['initdb', 'pg_ctl', 'pg_controldata', 'psql', 'pg_dump', 'pg_restore']) {
      requireCondition(/\(PostgreSQL\) 18(?:\.|\s|$)/.test(await command(`${name}-version`, binary(name), ['--version'])), 'All PostgreSQL tools must be version 18');
    }
    const migrations = JSON.parse((await command('migration-manifest', options.python, ['-I', join(repository, helpers[0])])).trim());
    assertReviewedMigrationManifest(migrations);
    const hashes = await helperHashes();
    const collector = await readFile(join(repository, helpers[1]), 'utf8');
    if (options.action === 'backup') {
      const proof = await sourceProof();
      const credentials = parsePrivateJson(await boundedFile(join(runtime, 'credentials.json'), 32768));
      requireCondition(credentials.host === SOURCE.host && credentials.port === SOURCE.port && credentials.database === SOURCE.database
        && credentials.names?.backup === SOURCE.backupUser && typeof credentials.secrets?.backup === 'string' && credentials.secrets.backup.length >= 16,
      'Prepared read-only backup credential does not match pinned metadata');
      const source = { port: SOURCE.port, admin: SOURCE.backupUser, password: credentials.secrets.backup }; secrets.push(source.password);
      const { Client } = createRequire(join(repository, 'backend/package.json'))('pg');
      snapshotClient = new Client({ host: SOURCE.host, port: SOURCE.port, database: SOURCE.database, user: SOURCE.backupUser,
        password: source.password, ssl: false, connectionTimeoutMillis: 5000,
        options: '-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=120000', application_name: 'simsa-current-backup-readonly' });
      snapshotMonitor = monitorSnapshotConnection(snapshotClient, snapshotAbort);
      await snapshotClient.connect(); await snapshotClient.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE');
      assertSourceIdentity((await snapshotClient.query(SOURCE_IDENTITY_SQL)).rows[0].identity, proof);
      const safe = await psql(source, extractBackupGuard(await readFile(join(repository, helpers[3]), 'utf8')), { database: SOURCE.database, readonly: true,
        variables: { expected_database: SOURCE.database, expected_user: SOURCE.backupUser, expected_postgres_major: '18' }, label: 'backup-role-closure' });
      requireCondition(safe.trim() === 't', 'Existing backup role is not the exact reviewed read-only role; no grants were changed');
      const snapshot = (await snapshotClient.query('SELECT pg_export_snapshot() AS snapshot, clock_timestamp() AS taken_at')).rows[0];
      requireCondition(/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/.test(snapshot.snapshot), 'Unsafe snapshot identifier');
      report.snapshot_at = new Date(snapshot.taken_at).toISOString(); report.run_id = operationId;
      const evidence = normalizeEvidence(await psql(source, `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET TRANSACTION SNAPSHOT '${snapshot.snapshot}';\n${collector}\nCOMMIT;`,
        { database: SOURCE.database, readonly: true, variables: { backup_profile: 'post_migration', expected_migrations_json: JSON.stringify(migrations) }, label: 'snapshot-fingerprints' }));
      const keyParent = join(repository, 'output/local-backup-keys'); await mkdir(keyParent, { recursive: true });
      requireCondition(samePath(await realpath(keyParent), keyParent), 'Key parent must be physical');
      const keyDirectory = await mkdtemp(join(keyParent, `${operationId}-`)); await secureDirectory(keyDirectory);
      const key = randomBytes(32); secrets.push(key.toString('base64'));
      const keyPath = join(keyDirectory, 'recovery-key.json'); assertSeparateKey(runDir, keyPath);
      await writeFile(keyPath, JSON.stringify({ format: CURRENT_FORMAT, run_id: operationId, key_base64: key.toString('base64') }) + '\n', { flag: 'wx' });
      const archivePath = join(runDir, 'database.dump.aesgcm'), evidencePath = join(runDir, 'source.evidence.aesgcm');
      const encrypted = createEncryptor(key, operationId, 'archive'); await writeFile(archivePath, encrypted.header, { flag: 'wx' });
      const dump = await command('encrypted-pg-dump', binary('pg_dump'), ['--no-password', '--format=custom', '--create', '--compress=9', '--no-owner', '--no-privileges',
        `--snapshot=${snapshot.snapshot}`, '--lock-wait-timeout=60000'], { env: connection(source, SOURCE.backupUser, SOURCE.database, true), capture: false });
      let bytes = 0;
      try {
        await pipeline(dump.child.stdout, new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length;
          callback(bytes > MAX_ARCHIVE_BYTES ? new Error('Archive exceeds the supported 64 MiB bound; arrange a larger managed backup workflow') : null, chunk); } }),
        encrypted.cipher, createWriteStream(archivePath, { flags: 'a' })); await dump.finish();
      } catch (error) { dump.child.kill(); await dump.finish().catch(() => {}); throw error; }
      await appendFile(archivePath, encrypted.cipher.getAuthTag());
      await snapshotClient.query('COMMIT');
      assertSourceIdentity((await snapshotClient.query(SOURCE_IDENTITY_SQL)).rows[0].identity, await sourceProof());
      await snapshotClient.end(); snapshotClient = null;
      await writeFile(evidencePath, encryptBuffer(evidence, key, operationId, 'evidence'), { flag: 'wx' });
      requireCondition(JSON.stringify(await helperHashes()) === JSON.stringify(hashes), 'Reviewed helpers changed during backup');
      const body = { format: CURRENT_FORMAT, run_id: operationId, source: SOURCE, scope: 'database-only', snapshot_at: report.snapshot_at,
        backup_role_membership_closure: 'exact', migrations, helpers: hashes, archive_sha256: sha256(await readFile(archivePath)),
        evidence_sha256: sha256(await readFile(evidencePath)), archive_plaintext_bytes: bytes };
      await writeFile(join(runDir, 'manifest.json'), JSON.stringify(sealManifest(body, key), null, 2) + '\n', { flag: 'wx' }); key.fill(0);
      report.archive_plaintext_bytes = bytes; report.archive_encrypted_bytes = (await lstat(archivePath)).size;
      report.bundle = runDir; report.key_file = keyPath; report.evidence_lines = evidence.toString().trimEnd().split('\n').length;
      report.steps.push('pinned-source-readonly', 'exact-backup-role-closure', 'same-snapshot-dump-and-fingerprints', 'encrypted-and-authenticated-bundle');
    } else {
      assertSeparateKey(options.bundle, options['key-file']); await verifyPrivateDirectory(dirname(options['key-file']));
      const keyRecord = parsePrivateJson(await boundedFile(options['key-file'], 1024));
      requireCondition(keyRecord.format === CURRENT_FORMAT && /^[A-Za-z0-9+/]{43}=$/.test(keyRecord.key_base64), 'Invalid recovery key metadata');
      const key = Buffer.from(keyRecord.key_base64, 'base64'); secrets.push(keyRecord.key_base64);
      const body = authenticateManifest(JSON.parse(await boundedFile(join(options.bundle, 'manifest.json'), 65536)), key);
      requireCondition(keyRecord.run_id === body.run_id, 'Recovery key and bundle identity differ');
      requireCondition(JSON.stringify(body.helpers) === JSON.stringify(hashes) && JSON.stringify(body.migrations) === JSON.stringify(migrations), 'Restore helpers or migration manifest differ from the authenticated backup; recover with the matching reviewed checkout');
      const archive = await boundedFile(join(options.bundle, 'database.dump.aesgcm'), MAX_ARCHIVE_BYTES + 128);
      const evidence = await boundedFile(join(options.bundle, 'source.evidence.aesgcm'), MAX_EVIDENCE_BYTES + 128);
      const { plaintext, expectedEvidence: expected } = decryptRecoveryContents(body, key, archive, evidence); key.fill(0);
      report.run_id = body.run_id; report.snapshot_at = body.snapshot_at; report.archive_encrypted_bytes = archive.length;
      report.steps.push('independent-process-bundle-authenticated-before-target');
      const tocPath = join(privateDir, 'archive.toc.list'), selectedPath = join(privateDir, 'selected.list'), propertiesPath = join(privateDir, 'properties.sql');
      await writeFile(tocPath, await command('authenticated-toc', binary('pg_restore'), ['--create', '--list'], { input: plaintext, metadata: true }), { flag: 'wx' });
      const helper = join(repository, helpers[2]);
      await command('select-properties', options.python, ['-I', helper, 'select-toc', '--database', SOURCE.database, '--schema-profile', 'post_migration', '--input', tocPath, '--output', selectedPath]);
      await writeFile(propertiesPath, await command('authenticated-properties', binary('pg_restore'), ['--create', '--no-owner', '--no-privileges', '--use-list', selectedPath, '--file=-'],
        { input: plaintext, metadata: true, maximum: 128 * 1024 }), { flag: 'wx' });
      await createTarget();
      const project = `simsa-restore-${operationId.slice(0, 8)}`;
      const roles = [...['simsa-api-runtime', 'simsa-event-runtime', 'simsa-malware-worker', 'simsa-final-cleanup'].map(account => `${account}@${project}.iam`),
        'simsa_restore_maintenance', 'simsa_restore_migrator', 'simsa_restore_backup'];
      const variables = { database_name: SOURCE.database, expected_owner: target.admin, identity_project_id: project,
        ...Object.fromEntries(['api', 'event', 'worker', 'final_cleanup'].flatMap((kind, index) => [[`${kind}_principal`, roles[index]], [`${kind}_service_account`, `${roles[index]}.gserviceaccount.com`]])),
        maintenance_principal: roles[4], migrator_principal: roles[5], backup_principal: roles[6], expected_migrations_json: JSON.stringify(migrations) };
      const aliases = join(privateDir, 'aliases');
      await command('prepare-aliases', options.python, ['-I', helper, 'prepare', '--database', SOURCE.database, '--schema-profile', 'post_migration', '--target-admin', target.admin,
        ...roles.flatMap(role => ['--target-role', role]), '--toc-input', tocPath, '--input', propertiesPath, '--output-dir', aliases]);
      await psql(target, roles.map(role => `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD '${target.password}';`).join('\n'), { mutation: true, label: 'create-new-target-principals' });
      await psql(target, await readFile(join(aliases, 'prepare-aliases.sql'), 'utf8'), { mutation: true, label: 'create-inert-aliases' });
      await guardTarget();
      await command('full-independent-restore', binary('pg_restore'), ['--no-password', '--exit-on-error', '--create', '--no-owner', '--no-privileges', '--dbname', 'postgres'],
        { input: plaintext, env: connection(target), timeout: 300_000 }); plaintext.fill(0);
      await psql(target, await readFile(join(aliases, 'cleanup-aliases.sql'), 'utf8'), { mutation: true, label: 'remove-inert-aliases' });
      await psql(target, await readFile(join(repository, helpers[4]), 'utf8'), { mutation: true, database: SOURCE.database, variables, label: 'target-role-bootstrap' });
      await psql(target, await readFile(join(repository, helpers[5]), 'utf8'), { mutation: true, database: SOURCE.database, user: roles[5], variables, label: 'target-grant-convergence' });
      const actual = normalizeEvidence(await psql(target, `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${collector}\nCOMMIT;`,
        { database: SOURCE.database, user: roles[6], readonly: true, variables: { backup_profile: 'post_migration', expected_migrations_json: JSON.stringify(migrations) }, label: 'restored-fingerprints' }));
      requireCondition(actual.equals(expected), 'Restored schema, data, or normalized grants differ from the authenticated source evidence');
      const apiProbe = JSON.parse((await psql(target, `SELECT json_build_object('users', (SELECT count(*) FROM public.users),
        'surat_masuk', (SELECT count(*) FROM public.surat_masuk), 'surat_keluar', (SELECT count(*) FROM public.surat_keluar),
        'arsip', (SELECT count(*) FROM public.arsip), 'audit_logs', (SELECT count(*) FROM public.audit_log),
        'superuser', (SELECT rolsuper FROM pg_roles WHERE rolname=current_user), 'schema_create', has_schema_privilege(current_user,'public','CREATE'));`,
      { database: SOURCE.database, user: roles[0], readonly: true, label: 'api-role-read-probe' })).trim());
      requireCondition(apiProbe.superuser === false && apiProbe.schema_create === false, 'Restored API role has elevated privileges');
      requireCondition(JSON.stringify(await helperHashes()) === JSON.stringify(hashes), 'Reviewed helpers changed during recovery');
      report.target = { port: target.port, data_directory: target.dataDir, system_identifier: target.systemIdentifier, host: SOURCE.host };
      report.evidence_sha256 = sha256(actual); report.evidence_lines = actual.toString().trimEnd().split('\n').length; report.api_role_probe = apiProbe;
      report.snapshot_age_seconds_at_verification = Math.round((Date.now() - Date.parse(body.snapshot_at)) / 1000);
      report.steps.push('full-create-archive-restored', 'target-only-grants-converged', 'exact-fingerprints-match', 'api-role-read-probe');
    }
    snapshotMonitor?.assertHealthy(); completed = true;
  } catch (error) { failure = snapshotMonitor?.failure || error; report.failure = redact(failure.message); }
  finally {
    if (snapshotClient) await snapshotClient.end().catch(() => {});
    if (snapshotMonitor?.failure) { failure ||= snapshotMonitor.failure; report.failure = redact(failure.message); }
    snapshotMonitor?.dispose();
    try { await stopTarget(); } catch (error) { failure ||= error; report.shutdown_failure = redact(error.message); }
    report.finished_at = new Date().toISOString(); report.duration_seconds = (Date.now() - started) / 1000;
    report.status = completed && !failure ? 'passed' : 'failed';
    // Fresh private directories only; no source files, source SQL, or source processes are mutated.
    await finalizeWithOwnedLock({
      writeReport: () => writeFile(join(runDir, 'result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }),
      publishStatus: async () => { if (lock) await publishStatus(); },
      releaseLock: async () => { if (lock) await releaseOwnedLock(lockPath, lock, { pid: process.pid, operation_id: operationId }); },
    });
    console.log(`${options.action}: ${report.status}. Report: ${join(runDir, 'result.json')}`);
  }
  if (failure) throw new Error(redact(failure.message));
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseCurrentArguments(process.argv.slice(2));
    if (options.help) console.log('Node 24: local-current-backup.mjs backup --python ABS\nNode 24: local-current-backup.mjs restore-verify --python ABS --bundle ABS --key-file ABS\nOnly the pinned local database is backed up, read-only. Recovery always creates and stops a separate private loopback cluster. See docs/BACKUP_LOKAL.md.');
    else await runCurrentBackup(options);
  } catch (error) { console.error(`Local backup operation failed: ${error.message}`); process.exitCode = 1; }
}
