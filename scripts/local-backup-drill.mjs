#!/usr/bin/env node
/** Native PostgreSQL 18 synthetic drill. Never a Cloud SQL/age/Production proof. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';
import { createServer, createConnection } from 'node:net';
import { createWriteStream } from 'node:fs';
import { lstat, realpath, readFile, writeFile, mkdir, mkdtemp, chmod, appendFile, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import {
  FORMAT, MAX_ARCHIVE_BYTES, MAX_EVIDENCE_BYTES, sha256, requireCondition, strictPath,
  parseArguments, sterileEnvironment, assertPort, assertClusterIdentity, inside,
  createEncryptor, encryptBuffer, decryptBuffer, validateManifest, normalizeEvidence, extractBackupGuard,
  WINDOWS_ACL_PROBE_SCRIPT, assertWindowsPrivateAcl,
  LOCAL_POSTGRES_ISOLATION_CONFIG, nativePostgresOptions,
  CLUSTER_IDENTITY_SQL, awaitPostgresLauncherExit,
  buildLocalMaintenanceScripts,
  isPermittedMetadataInputClose,
} from './local-backup-drill-core.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const help = `Usage: node scripts/local-backup-drill.mjs \\
  --pg-bin <absolute PostgreSQL-18 bin directory> \\
  --python <absolute Python-3 executable> \\
  --npm-cli <absolute npm/bin/npm-cli.js> \\
  --git <absolute Git executable> \\
  --output-parent <existing absolute directory outside the repository>

Requires Node 24 and already-installed backend dependencies; does not install packages.
Creates two NEW private native clusters on generated loopback ports, migrates and
seeds ONLY its synthetic source, encrypts a backup, stops source, and independently
restores the complete archive. Never connects to existing databases or cloud APIs.
No connection-string, database, password, target-port, or cloud flags are accepted.
All output is preserved. recovery/recovery-key.json must be retained privately and
separately from artifacts/. Local AES-256-GCM is NOT the cloud age/WIF workflow.
No Production gate is satisfied by this local-only rehearsal.
`;

async function runLocalDrill(options) {
  requireCondition(process.versions.node.split('.')[0] === '24', 'This drill requires Node.js 24');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const binary = name => join(options.pgBin, name + suffix);
  // Do not read .env, browser storage, ADC, user npm configuration or credentials.
  for (const target of [options.outputParent, options.pgBin, options.python, options.npmCli, options.git,
    ...['initdb', 'pg_ctl', 'pg_controldata', 'psql', 'pg_dump', 'pg_restore'].map(binary)]) {
    requireCondition(!(await lstat(target)).isSymbolicLink(), 'Symlink tool/output paths are not supported');
  }
  requireCondition((await lstat(options.outputParent)).isDirectory(), 'Output parent must already be a directory');
  requireCondition(await realpath(options.outputParent) === options.outputParent,
    'Output parent must be its canonical physical path');
  requireCondition(basename(options.npmCli) === 'npm-cli.js', '--npm-cli must name npm-cli.js');
  const nodePath = strictPath(process.execPath, 'Node executable');
  const runId = randomBytes(16).toString('hex');
  const runDir = await mkdtemp(join(options.outputParent, 'simsa-local-drill-'));
  const privateDir = join(runDir, 'private');
  // Restrict the newly-created empty root BEFORE any key/password/DB is written.
  let environment = sterileEnvironment(process.env, { privateDir: runDir, pgBin: options.pgBin, nodePath });
  const secrets = [];
  const clusters = [];
  const controller = new AbortController();
  let commandNumber = 0;
  let snapshotClient;
  let failure;
  let completed = false;
  const report = {
    format: FORMAT, run_id: runId, scope: 'local-synthetic-only',
    started_at: new Date().toISOString(), production_ready: false, cloud_drill_executed: false,
    steps: [], shutdown: [],
  };
  const signal = () => controller.abort();
  const redacted = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value);

  async function command(label, executable, args, {
    input, env = environment, timeout = 120_000, maximum = 4 * 1024 * 1024,
    allowFailure = false, stopping = false, capture = true, allowEarlyStdinClose = false,
  } = {}) {
    if (!stopping) controller.signal.throwIfAborted();
    const child = spawn(executable, args, {
      cwd: privateDir === env.TEMP ? privateDir : runDir, env,
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      ...(stopping ? {} : { signal: controller.signal }),
    });
    const stdout = [], stderr = [];
    let size = 0;
    let limitError;
    const collect = chunks => chunk => {
      size += chunk.length;
      if (size > maximum) { limitError = new Error(`${label}: bounded output limit exceeded`); child.kill(); }
      else chunks.push(chunk);
    };
    if (capture) child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    const timer = setTimeout(() => { limitError = new Error(`${label}: timeout`); child.kill(); }, timeout);
    const done = new Promise((resolveDone, rejectDone) => {
      child.on('error', rejectDone);
      child.on('close', code => resolveDone(code));
    });
    // Streaming callers attach finish() after the pipeline, so observe an
    // immediate spawn error now as well as propagating it through finish().
    done.catch(() => {});
    // Metadata pg_restore may stop reading early; plaintext is already fully
    // authenticated before reaching it. Only explicit metadata calls may accept
    // EPIPE or the observed Windows EOF, never full-restore input failures.
    child.stdin.on('error', error => {
      if (!isPermittedMetadataInputClose(error, { allowEarlyStdinClose })) limitError = error;
    });
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
    const finish = async () => {
      let code;
      try { code = await done; } finally { clearTimeout(timer); }
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (await lstat(privateDir).catch(() => null)) {
        const log = `${String(++commandNumber).padStart(3, '0')}-${label}.log`;
        await writeFile(join(privateDir, log), redacted(`${out}${err}`), { flag: 'wx', mode: 0o600 });
      }
      if (limitError) throw limitError;
      if (code !== 0 && !allowFailure) throw new Error(`${label} failed (exit ${code}); inspect private command logs`);
      return { output: out, error: err, code };
    };
    return capture ? finish() : { child, finish };
  }

  async function secureRoot() {
    if (process.platform !== 'win32') {
      await chmod(runDir, 0o700);
      requireCondition(((await lstat(runDir)).mode & 0o077) === 0, 'Private directory mode verification failed');
      return;
    }
    const system = join(environment.SystemRoot, 'System32');
    const who = await command('current-sid', join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh']);
    const sids = who.output.match(/S-1-5-[0-9-]+/g);
    requireCondition(sids?.length === 1, 'Cannot identify exact Windows user SID');
    const sid = sids[0];
    await command('restrict-private-root', join(system, 'icacls.exe'),
      [runDir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`]);
    const acl = await command('verify-private-acl', join(system, 'WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_ACL_PROBE_SCRIPT],
      { env: { ...environment, SIMSA_DRILL_ACL_TARGET: runDir } });
    const proof = JSON.parse(acl.output.trim());
    assertWindowsPrivateAcl(proof, sid);
  }

  async function git(label, args) {
    return command(label, options.git, ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
      '-c', `core.hooksPath=${privateDir}`, '-C', repository, ...args]);
  }
  async function verifySourceUnchanged() {
    requireCondition((await git('verify-source-commit', ['rev-parse', 'HEAD'])).output.trim() === report.repository_commit,
      'Source commit changed during drill');
    requireCondition(!(await git('verify-clean-source', ['status', '--porcelain', '--untracked-files=all'])).output.trim(),
      'Source worktree changed during drill; evidence cannot be bound to this commit');
  }

  async function portFree(port) {
    assertPort(port);
    await new Promise((yes, no) => {
      const server = createServer();
      server.once('error', no);
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(yes));
    });
  }
  async function nextPort() {
    for (let attempt = 0; attempt < 40; attempt++) {
      const port = randomInt(40000, 60000);
      if (clusters.some(cluster => cluster.port === port)) continue;
      try { await portFree(port); return port; } catch (error) {
        if (error.code !== 'EADDRINUSE') throw error;
      }
    }
    throw new Error('No unused high loopback port found');
  }
  async function assertSocketClosed(port) {
    await new Promise((yes, no) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); no(new Error('Source database socket is still available')); });
      socket.once('error', error => { error.code === 'ECONNREFUSED' ? yes() : no(error); });
      socket.setTimeout(3000, () => { socket.destroy(); no(new Error('Socket shutdown could not be verified')); });
    });
  }
  function connectionEnv(cluster, user = cluster.admin, database = 'postgres', readonly = false) {
    return { ...environment, PGPORT: String(assertPort(cluster.port)), PGUSER: user,
      PGDATABASE: database, PGPASSWORD: cluster.password,
      PGOPTIONS: environment.PGOPTIONS + (readonly ? ' -c default_transaction_read_only=on' : '') };
  }
  async function psql(cluster, sql, { user = cluster.admin, database = 'postgres', variables = {}, readonly = false,
    label = 'psql', mutation = false, stopping = false } = {}) {
    if (mutation) await guard(cluster);
    const args = ['--no-psqlrc', '--no-password', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=on'];
    for (const [name, value] of Object.entries(variables)) args.push('--set', `${name}=${value}`);
    return (await command(label, binary('psql'), args, { input: sql, env: connectionEnv(cluster, user, database, readonly), stopping })).output;
  }
  async function diskIdentity(cluster) {
    requireCondition(inside(runDir, cluster.dataDir) && dirname(cluster.dataDir) === privateDir
      && (await realpath(cluster.dataDir)) === cluster.dataDir
      && !(await lstat(cluster.dataDir)).isSymbolicLink(), 'Cluster directory ownership guard failed');
    const control = await command('control-identity', binary('pg_controldata'), [cluster.dataDir], { stopping: true });
    const match = /^Database system identifier:\s+([0-9]{10,30})\s*$/m.exec(control.output);
    requireCondition(Boolean(match), 'Missing native cluster system identifier');
    if (cluster.systemIdentifier) requireCondition(match[1] === cluster.systemIdentifier, 'Native cluster identity changed');
    return match[1];
  }
  async function guard(cluster) {
    await diskIdentity(cluster);
    const row = await psql(cluster, CLUSTER_IDENTITY_SQL, { label: 'guard-cluster', stopping: true });
    assertClusterIdentity(JSON.parse(row.trim()), cluster);
  }
  function principals(cluster) {
    const project = `simsa-local-${cluster.kind}`;
    return [
      ...['simsa-api-runtime', 'simsa-event-runtime', 'simsa-malware-worker', 'simsa-final-cleanup']
        .map(account => `${account}@${project}.iam`),
      `simsa_local_${cluster.kind}_maintenance`, `simsa_local_${cluster.kind}_migrator`, `simsa_local_${cluster.kind}_backup`,
    ];
  }
  function grantVariables(cluster) {
    const roles = principals(cluster);
    return { database_name: report.database, expected_owner: cluster.admin,
      identity_project_id: `simsa-local-${cluster.kind}`,
      ...Object.fromEntries(['api', 'event', 'worker', 'final_cleanup'].flatMap((kind, index) => [
        [`${kind}_principal`, roles[index]], [`${kind}_service_account`, `${roles[index]}.gserviceaccount.com`],
      ])), maintenance_principal: roles[4], migrator_principal: roles[5], backup_principal: roles[6] };
  }
  async function createPrincipals(cluster) {
    const sql = principals(cluster).map(role => `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD '${cluster.password}';`).join('\n');
    await psql(cluster, sql, { mutation: true, label: 'create-disposable-principals' });
  }
  async function bootstrap(cluster, manifest) {
    await psql(cluster, await readFile(join(repository, 'backend/src/db/grants/0001_bootstrap_cloud_sql_roles.sql'), 'utf8'),
      { mutation: true, database: report.database, variables: grantVariables(cluster), label: 'bootstrap-reviewed-roles' });
    if (manifest) await psql(cluster, await readFile(join(repository, 'backend/src/db/grants/0002_converge_application_grants.sql'), 'utf8'),
      { mutation: true, database: report.database, user: principals(cluster)[5],
        variables: { ...grantVariables(cluster), expected_migrations_json: manifest }, label: 'converge-reviewed-grants' });
  }
  async function createCluster(kind) {
    const cluster = { kind, dataDir: join(privateDir, `${kind}-data`),
      admin: `simsa_local_${kind}_admin`, port: await nextPort(), password: randomBytes(32).toString('hex'), started: false };
    secrets.push(cluster.password);
    clusters.push(cluster);
    requireCondition(!(await lstat(cluster.dataDir).catch(() => null)), 'Refusing an existing cluster directory');
    const passwordFile = join(privateDir, `${kind}-init-password.txt`);
    await writeFile(passwordFile, cluster.password + '\n', { flag: 'wx', mode: 0o600 });
    await command(`initdb-${kind}`, binary('initdb'), ['--pgdata', cluster.dataDir, '--username', cluster.admin,
      '--pwfile', passwordFile, '--encoding=UTF8', '--no-locale', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256']);
    cluster.systemIdentifier = await diskIdentity(cluster);
    // This is the config created by the initdb immediately above, not a
    // pre-existing server. Verify its exact path before a bounded append.
    const configPath = join(cluster.dataDir, 'postgresql.conf');
    const configStat = await lstat(configPath);
    requireCondition(configStat.isFile() && !configStat.isSymbolicLink()
      && (await realpath(configPath)) === configPath,
    'Fresh cluster configuration identity could not be verified');
    await appendFile(configPath, LOCAL_POSTGRES_ISOLATION_CONFIG);
    await portFree(cluster.port);
    // The generated -o string contains no user-supplied values or paths.
    cluster.startAttempted = true;
    const launcherLog = join(privateDir, `${String(++commandNumber).padStart(3, '0')}-start-${kind}.log`);
    const launcherOutput = await open(launcherLog, 'wx', 0o600);
    try {
      controller.signal.throwIfAborted();
      // No inherited Node pipes: the pg_ctl Windows command-shell descendant
      // stays alive with the daemon. Preserve startup diagnostics in the new
      // private log while waiting for pg_ctl's own successful exit only.
      const launcher = spawn(binary('pg_ctl'), ['--pgdata', cluster.dataDir, '--log', join(privateDir, `${kind}-postgres.log`),
        '-o', nativePostgresOptions(cluster.port), '-w', '-t', '30', 'start'], {
        cwd: privateDir, env: environment, shell: false, windowsHide: true,
        stdio: ['ignore', launcherOutput.fd, launcherOutput.fd], signal: controller.signal,
      });
      await awaitPostgresLauncherExit(launcher);
    } finally {
      await launcherOutput.close();
    }
    cluster.started = true;
    await guard(cluster);
    return cluster;
  }
  async function stopCluster(cluster) {
    if (!cluster.startAttempted || cluster.stopped) return;
    await diskIdentity(cluster);
    const pidPath = join(cluster.dataDir, 'postmaster.pid');
    const pidFile = await readFile(pidPath, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (pidFile !== null) {
      const fields = pidFile.replaceAll('\r\n', '\n').split('\n');
      requireCondition(/^[1-9][0-9]*$/.test(fields[0]) && resolve(fields[1]) === cluster.dataDir
        && Number(fields[3]) === cluster.port, 'postmaster.pid ownership proof failed; refusing stop');
      await guard(cluster);
      await command(`stop-${cluster.kind}`, binary('pg_ctl'), ['--pgdata', cluster.dataDir, '-m', 'fast', '-w', '-t', '30', 'stop'], { stopping: true });
    }
    requireCondition(!(await lstat(pidPath).catch(() => null)), 'Cluster PID file remains after shutdown');
    await assertSocketClosed(cluster.port);
    cluster.stopped = true;
    report.shutdown.push({ kind: cluster.kind, stopped: true, socket_closed: true, at: new Date().toISOString() });
  }

  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    await secureRoot();
    for (const directory of [privateDir, join(runDir, 'artifacts'), join(runDir, 'recovery')]) await mkdir(directory, { mode: 0o700 });
    environment = sterileEnvironment(process.env, { privateDir, pgBin: options.pgBin, nodePath });
    for (const file of ['empty.pgpass', 'empty.pgservice', 'empty-user.npmrc', 'empty-global.npmrc', 'empty.gitconfig']) {
      await writeFile(join(privateDir, file), '', { flag: 'wx', mode: 0o600 });
    }
    report.repository_commit = (await git('source-commit', ['rev-parse', 'HEAD'])).output.trim();
    requireCondition(/^[a-f0-9]{40}$/.test(report.repository_commit), 'Missing source commit');
    // Refuse dirty/untracked source rather than label a mixed tree as a commit.
    await verifySourceUnchanged();
    report.working_tree_dirty = false;
    for (const tool of ['initdb', 'pg_ctl', 'pg_controldata', 'psql', 'pg_dump', 'pg_restore']) {
      const version = (await command(`${tool}-version`, binary(tool), ['--version'])).output.trim();
      requireCondition(/\(PostgreSQL\) 18(?:\.|\s|$)/.test(version), `${tool} must be PostgreSQL 18`);
    }
    const manifest = (await command('migration-manifest', options.python,
      ['-I', join(repository, '.github/scripts/build-migration-manifest.py')])).output.trim();
    requireCondition(JSON.parse(manifest).length === 39, 'Expected current 0000-0038 manifest');
    const collector = await readFile(join(repository, '.github/scripts/collect-backup-evidence.sql'), 'utf8');
    const backupGuard = extractBackupGuard(await readFile(join(repository, '.github/workflows/backup-cloud-sql.yml'), 'utf8'));
    report.database = `simsa_local_${runId.slice(0, 16)}`;
    const source = await createCluster('source');
    await createPrincipals(source);
    await psql(source, `CREATE DATABASE "${report.database}" TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C';`,
      { mutation: true, label: 'create-synthetic-database' });
    await bootstrap(source);

    // The generated workspace invokes the exact reviewed maintenance entry
    // points. Its cwd has no .env/.npmrc and never enters the user's backend cwd.
    const migrationPath = strictPath(join(repository, 'backend/scripts/migrate-database.mjs'), 'migration entry');
    const seedPath = strictPath(join(repository, 'backend/src/db/seed.ts'), 'seed entry');
    const tsxPath = strictPath(join(repository, 'backend/node_modules/tsx/dist/cli.mjs'), 'installed tsx entry');
    requireCondition((await lstat(tsxPath)).isFile(), 'Install backend dependencies separately before this offline drill');
    await writeFile(join(privateDir, 'package.json'), JSON.stringify({ private: true,
      scripts: buildLocalMaintenanceScripts({ nodePath, migrationPath, seedPath, tsxPath }),
    }, null, 2), { flag: 'wx', mode: 0o600 });
    async function maintenance(script, roleIndex) {
      await guard(source);
      const uri = new URL(`postgresql://127.0.0.1:${source.port}/${report.database}`);
      uri.username = principals(source)[roleIndex]; uri.password = source.password;
      await command(script.replace(':', '-'), nodePath, [options.npmCli, 'run', script],
        { env: { ...environment, DATABASE_URL: uri.toString() }, timeout: 300_000 });
    }
    await maintenance('db:migrate', 5);
    await bootstrap(source, manifest);
    await maintenance('seed:all', 4);
    // An inert, non-authenticated synthetic user satisfies the existing
    // collector baseline without invoking any identity provider or seeding passwords.
    await psql(source, `INSERT INTO public.users (email, name, is_active) VALUES ('backup-drill@local.invalid', 'Synthetic backup drill', false);`,
      { mutation: true, database: report.database, user: principals(source)[0], label: 'insert-synthetic-user' });
    const safe = await psql(source, backupGuard, { database: report.database, user: principals(source)[6], readonly: true,
      variables: { expected_database: report.database, expected_user: principals(source)[6], expected_postgres_major: '18' }, label: 'exact-backup-role-closure' });
    requireCondition(safe.trim() === 't', 'Current workflow read-only backup role guard failed');
    async function stableSourceEvidence(label) {
      return normalizeEvidence(await psql(source,
        `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${collector}\nCOMMIT;\n`,
        { database: report.database, user: principals(source)[6], readonly: true,
          variables: { backup_profile: 'post_migration', expected_migrations_json: manifest }, label }));
    }
    const beforeSeedRepeat = await stableSourceEvidence('before-repeated-seed-evidence');
    await maintenance('seed:all', 4);
    requireCondition(beforeSeedRepeat.equals(await stableSourceEvidence('after-repeated-seed-evidence')),
      'Repeated seed:all changed normalized schema/data evidence');
    report.steps.push('source-migrated-0038', 'seed-all-repeat-exact-evidence-match', 'exact-backup-role-closure');
    console.log('Synthetic source migrated, seeded, and least-privilege backup role verified.');

    const requireBackend = createRequire(join(repository, 'backend/package.json'));
    const { Client } = requireBackend('pg');
    snapshotClient = new Client({ host: '127.0.0.1', port: source.port, database: report.database,
      user: principals(source)[6], password: source.password, ssl: false, connectionTimeoutMillis: 5000,
      options: '-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=120000',
      application_name: 'simsa-local-backup-drill' });
    await snapshotClient.connect();
    await snapshotClient.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE');
    const snapshot = (await snapshotClient.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    requireCondition(/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/.test(snapshot), 'Unsafe exported snapshot identifier');
    const sourceEvidence = normalizeEvidence(await psql(source,
      `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET TRANSACTION SNAPSHOT '${snapshot}';\n${collector}\nCOMMIT;\n`,
      { database: report.database, user: principals(source)[6], readonly: true,
        variables: { backup_profile: 'post_migration', expected_migrations_json: manifest }, label: 'source-snapshot-evidence' }));
    const key = randomBytes(32);
    secrets.push(key.toString('base64'));
    const keyPath = join(runDir, 'recovery/recovery-key.json');
    await writeFile(keyPath, JSON.stringify({ format: FORMAT, run_id: runId, key_base64: key.toString('base64') }) + '\n', { flag: 'wx', mode: 0o600 });
    const archivePath = join(runDir, 'artifacts/database.dump.aesgcm');
    const encrypted = createEncryptor(key, runId, 'archive');
    await writeFile(archivePath, encrypted.header, { flag: 'wx', mode: 0o600 });
    const dump = await command('encrypted-snapshot-pg-dump', binary('pg_dump'), [
      '--no-password', '--format=custom', '--create', '--compress=9', '--no-owner', '--no-privileges',
      `--snapshot=${snapshot}`, '--lock-wait-timeout=60000',
    ], { env: connectionEnv(source, principals(source)[6], report.database, true), capture: false });
    let dumpBytes = 0;
    try {
      await pipeline(dump.child.stdout, new Transform({ transform(chunk, encoding, callback) {
        dumpBytes += chunk.length;
        callback(dumpBytes > MAX_ARCHIVE_BYTES ? new Error('Synthetic archive exceeds 64 MiB') : null, chunk);
      } }), encrypted.cipher, createWriteStream(archivePath, { flags: 'a', mode: 0o600 }));
      await dump.finish();
    } catch (error) { dump.child.kill(); await dump.finish().catch(() => {}); throw error; }
    await appendFile(archivePath, encrypted.cipher.getAuthTag());
    await snapshotClient.query('COMMIT');
    await snapshotClient.end(); snapshotClient = null;
    const evidencePath = join(runDir, 'artifacts/source.evidence.aesgcm');
    await writeFile(evidencePath, encryptBuffer(sourceEvidence, key, runId, 'evidence'), { flag: 'wx', mode: 0o600 });
    const artifactManifest = {
      format: FORMAT, run_id: runId, repository_commit: report.repository_commit, schema_profile: 'post_migration',
      synthetic_only: true, archive_sha256: sha256(await readFile(archivePath)), evidence_sha256: sha256(await readFile(evidencePath)),
      source_system_identifier: source.systemIdentifier, source_database: report.database,
      source_backup_principal: principals(source)[6], backup_role_membership_closure: 'exact',
    };
    const manifestPath = join(runDir, 'artifacts/manifest.json');
    const manifestBytes = Buffer.from(JSON.stringify(artifactManifest, null, 2) + '\n');
    const manifestHash = sha256(manifestBytes);
    await writeFile(manifestPath, manifestBytes, { flag: 'wx', mode: 0o600 });
    await writeFile(join(runDir, 'manifest.sha256'), manifestHash + '\n', { flag: 'wx', mode: 0o600 });
    key.fill(0);
    await stopCluster(source);
    report.source_stopped_before_restore = true;
    report.steps.push('same-snapshot-encrypted-backup', 'source-stopped-and-socket-unavailable');
    console.log('Encrypted artifact sealed; source stopped. Beginning independent local recovery.');

    // Recovery rereads only artifact + separate key, never source rows or source
    // connections. Bound file sizes before allocation; authenticate before tools.
    for (const [file, limit] of [[archivePath, MAX_ARCHIVE_BYTES + 128], [evidencePath, MAX_EVIDENCE_BYTES + 128], [keyPath, 1024], [manifestPath, 8192]]) {
      const stat = await lstat(file);
      requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= limit, 'Recovery input is unsafe or oversized');
    }
    const archive = await readFile(archivePath), evidence = await readFile(evidencePath);
    const recoveredKey = JSON.parse(await readFile(keyPath, 'utf8'));
    requireCondition(recoveredKey.format === FORMAT && recoveredKey.run_id === runId
      && /^[A-Za-z0-9+/]{43}=$/.test(recoveredKey.key_base64), 'Recovery key identity is malformed');
    const recoveryKey = Buffer.from(recoveredKey.key_base64, 'base64');
    const recoveredManifest = await readFile(manifestPath);
    requireCondition(sha256(recoveredManifest) === manifestHash, 'Manifest seal mismatch');
    const recoveryIdentity = { runId, commit: report.repository_commit, archive, evidence,
      database: report.database, systemIdentifier: source.systemIdentifier };
    validateManifest(JSON.parse(recoveredManifest), recoveryIdentity);
    for (const [name, operation] of [
      ['wrong-key', () => decryptBuffer(archive, randomBytes(32), runId, 'archive')],
      ['corrupt-final-tag', () => { const broken = Buffer.from(archive); broken[broken.length - 1] ^= 1; return decryptBuffer(broken, recoveryKey, runId, 'archive'); }],
      ['encrypted-hash-mismatch', () => validateManifest({ ...artifactManifest, archive_sha256: '0'.repeat(64) }, recoveryIdentity)],
    ]) {
      let rejected = false;
      try { const unexpected = operation(); unexpected?.fill?.(0); } catch { rejected = true; }
      requireCondition(rejected, `Negative recovery check unexpectedly passed: ${name}`);
      report.steps.push(`rejected-before-restore:${name}`);
    }
    const plaintext = decryptBuffer(archive, recoveryKey, runId, 'archive');
    const expectedEvidence = decryptBuffer(evidence, recoveryKey, runId, 'evidence');
    recoveryKey.fill(0);
    requireCondition(plaintext.subarray(0, 5).toString('ascii') === 'PGDMP', 'Authenticated plaintext is not a PostgreSQL custom archive');
    const metadataDir = join(privateDir, 'restore-metadata'); await mkdir(metadataDir, { mode: 0o700 });
    const tocPath = join(metadataDir, 'archive.toc.list');
    await writeFile(tocPath, (await command('authenticated-full-toc', binary('pg_restore'), ['--create', '--list'],
      { input: plaintext, allowEarlyStdinClose: true })).output, { flag: 'wx', mode: 0o600 });
    const helper = join(repository, '.github/scripts/prepare-restore-role-aliases.py');
    const selectedPath = join(metadataDir, 'database-properties.list');
    await command('select-reviewed-properties', options.python, ['-I', helper, 'select-toc', '--database', report.database,
      '--schema-profile', 'post_migration', '--input', tocPath, '--output', selectedPath]);
    const propertiesPath = join(metadataDir, 'database-properties.sql');
    await writeFile(propertiesPath, (await command('authenticated-selected-properties', binary('pg_restore'),
      ['--create', '--no-owner', '--no-privileges', '--use-list', selectedPath, '--file=-'],
      { input: plaintext, maximum: 128 * 1024, allowEarlyStdinClose: true })).output,
    { flag: 'wx', mode: 0o600 });
    // Only now is the second fresh independent cluster created and started.
    const restore = await createCluster('restore');
    requireCondition(restore.systemIdentifier !== source.systemIdentifier && restore.port !== source.port,
      'Recovery cluster must be physically distinct from source');
    const aliasDir = join(metadataDir, 'validated');
    await command('prepare-reviewed-alias-plan', options.python, ['-I', helper, 'prepare', '--database', report.database,
      '--schema-profile', 'post_migration', '--target-admin', restore.admin,
      ...principals(restore).flatMap(role => ['--target-role', role]),
      '--toc-input', tocPath, '--input', propertiesPath, '--output-dir', aliasDir]);
    await createPrincipals(restore);
    await psql(restore, await readFile(join(aliasDir, 'prepare-aliases.sql'), 'utf8'), { mutation: true, label: 'create-inert-source-aliases' });
    await guard(restore);
    await command('independent-full-archive-restore', binary('pg_restore'),
      ['--no-password', '--exit-on-error', '--create', '--no-owner', '--no-privileges', '--dbname', 'postgres'],
      { input: plaintext, env: connectionEnv(restore), timeout: 300_000 });
    plaintext.fill(0);
    await psql(restore, await readFile(join(aliasDir, 'cleanup-aliases.sql'), 'utf8'), { mutation: true, label: 'verify-and-remove-inert-aliases' });
    await bootstrap(restore, manifest);
    const actualEvidence = normalizeEvidence(await psql(restore,
      `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${collector}\nCOMMIT;\n`,
      { database: report.database, user: principals(restore)[6], readonly: true,
        variables: { backup_profile: 'post_migration', expected_migrations_json: manifest }, label: 'independent-restored-evidence' }));
    requireCondition(actualEvidence.equals(expectedEvidence), 'Independent restored schema/data/grant evidence differs from source');
    report.evidence_sha256 = sha256(actualEvidence);
    report.evidence_lines = actualEvidence.toString('utf8').trimEnd().split('\n').length;
    report.artifact_manifest_sha256 = manifestHash;
    report.archive_sha256 = artifactManifest.archive_sha256;
    report.archive_plaintext_bytes = dumpBytes;
    report.clusters = clusters.map(({ kind, dataDir, port, systemIdentifier }) => ({ kind, data_directory: dataDir, port, system_identifier: systemIdentifier }));
    report.steps.push('full-create-archive-restored', 'source-aliases-validated-and-removed', 'distinct-restore-principals-converged', 'exact-normalized-evidence-match');
    await verifySourceUnchanged();
    report.steps.push('source-commit-and-clean-tree-reverified');
    completed = true;
  } catch (error) {
    failure = error;
    report.failure = redacted(error.message || String(error));
  } finally {
    if (snapshotClient) { await snapshotClient.end().catch(() => {}); }
    for (const cluster of [...clusters].reverse()) {
      try { await stopCluster(cluster); } catch (error) {
        report.shutdown.push({ kind: cluster.kind, stopped: false, error: redacted(error.message) });
        failure ||= error;
      }
    }
    process.removeListener('SIGINT', signal); process.removeListener('SIGTERM', signal);
    report.finished_at = new Date().toISOString();
    report.status = completed && !failure && clusters.length === 2 && clusters.every(cluster => cluster.stopped) ? 'passed' : 'failed';
    // Only this fresh run directory is written. No automatic data/file removal.
    await writeFile(join(runDir, 'result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(`Local synthetic drill ${report.status}. Evidence: ${join(runDir, 'result.json')}`);
    const retainedKey = join(runDir, 'recovery/recovery-key.json');
    if ((await lstat(retainedKey).catch(() => null))?.isFile()) console.log(`Preserved private recovery key: ${retainedKey}`);
  }
  if (failure) throw failure;
  return { runDir, report };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArguments(process.argv.slice(2), repository);
    if (options.help) console.log(help);
    else await runLocalDrill(options);
  } catch (error) {
    console.error(`Local synthetic drill failed: ${error.message}`);
    process.exitCode = 1;
  }
}
