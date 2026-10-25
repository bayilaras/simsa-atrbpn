#!/usr/bin/env node
// Release-time Neon operations behind one hidden prompt (run via rilis-neon.ps1).
// Credentials arrive only through SIMSA_OPS_CREDENTIAL and, for rotate-role,
// SIMSA_OPS_NEW_PASSWORD; both are removed from this process before anything
// else happens. The reviewed helpers then run from --checkout (the frozen
// release source) with exactly one canonical connection variable.
// See docs/RUNBOOK_KREDENSIAL_DATABASE.md.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { neonUrl, operatorPassword, OpsError, pinnedTarget } from './neon-credential.mjs';
import { assertRotationPassword, randomRolePassword, rotateLoginRole, ROTATABLE_ROLES } from './neon-role-rotation.mjs';

const REPOSITORY = resolve(import.meta.dirname, '../..');
const DIAGNOSTIC = join(REPOSITORY, 'scripts', 'ops', 'diag-neon-backup.mjs');
const URL_ENV = Object.freeze({ simsa_backup: 'NEON_BACKUP_DATABASE_URL', simsa_migration: 'NEON_MIGRATION_DATABASE_URL', simsa_api: 'NEON_RUNTIME_DATABASE_URL' });
// Login role whose credential the operator types; 'owner' is the database owner.
const ACTIONS = Object.freeze({ backup: 'simsa_backup', 'diag-backup': 'simsa_backup', migrate: 'simsa_migration',
  'verify-runtime': 'simsa_api', 'rotate-migrate': 'owner', 'rotate-role': 'owner' });
export const ROTATION_FOLLOW_UP = Object.freeze({
  simsa_migration: 'simpan password baru di password manager (entri simsa_migration).',
  simsa_backup: 'perbarui secret GitHub NEON_BACKUP_DATABASE_URL di environment production-recovery, lalu jalankan operations-recovery.yml manual.',
  simsa_api: 'perbarui DATABASE_URL Production simsa-backend di Vercel, deploy kandidat, lalu promosikan (lihat runbook).',
  simsa_worker: 'perbarui MALWARE_WORKER_DATABASE_URL Production simsa-backend di Vercel dan secret GitHub NEON_WORKER_DATABASE_URL (production-integrity).',
  simsa_operator: 'simpan password baru di password manager; role ini tidak dipakai layanan mana pun.',
});
const USAGE = 'node scripts/ops/rilis-neon.mjs <backup|diag-backup|migrate|verify-runtime|rotate-migrate|rotate-role> '
  + '--host <ep-...neon.tech> --database <nama> [--checkout <folder>] [--role <role>] [--owner neondb_owner] '
  + '[--pg-bin <folder>] [--output <folder>] [--key-directory <folder>]. Jalankan lewat scripts/ops/rilis-neon.ps1.';

/** Pure argument validation; the returned plan contains no secrets. */
export function planOperation(argv, environment = process.env) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: Object.fromEntries(
      ['host', 'database', 'checkout', 'role', 'owner', 'pg-bin', 'output', 'key-directory'].map(name => [name, { type: 'string' }])) });
  } catch { throw new OpsError('Argumen tidak dikenal. ' + USAGE); }
  const { values, positionals: [action, ...extra] } = parsed;
  if (!Object.hasOwn(ACTIONS, action ?? '') || extra.length) throw new OpsError(USAGE);
  const { host, database } = pinnedTarget({ host: values.host ?? environment.SIMSA_NEON_HOST, database: values.database ?? environment.SIMSA_NEON_DATABASE });
  const owner = values.owner ?? 'neondb_owner';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,62}$/.test(owner) || ROTATABLE_ROLES.includes(owner) || owner.startsWith('simsa_')) {
    throw new OpsError('--owner harus pemilik database dari Neon Console, bukan role aplikasi.');
  }
  const rotate = action === 'rotate-migrate' ? 'simsa_migration' : action === 'rotate-role' ? values.role : undefined;
  if (action === 'rotate-role' && !ROTATABLE_ROLES.includes(rotate)) throw new OpsError(`rotate-role memerlukan --role ${ROTATABLE_ROLES.join('|')}.`);
  if (action !== 'rotate-role' && values.role !== undefined) throw new OpsError('--role hanya untuk rotate-role.');
  const backup = action === 'backup' || action === 'diag-backup';
  if (!backup && ['pg-bin', 'output', 'key-directory'].some(name => values[name] !== undefined)) throw new OpsError('--pg-bin/--output/--key-directory hanya untuk backup.');
  if (action === 'diag-backup' && values['key-directory'] !== undefined) throw new OpsError('diag-backup tidak menulis kunci.');
  const pgBin = values['pg-bin'] ?? environment.SIMSA_PG_BIN;
  if (backup && !pgBin) throw new OpsError('Tentukan --pg-bin (folder bin PostgreSQL 18) atau SIMSA_PG_BIN.');
  const checkout = resolve(values.checkout ?? REPOSITORY);
  if (!existsSync(join(checkout, 'scripts', 'neon-database.mjs')) || !existsSync(join(checkout, 'backend', 'package.json'))) {
    throw new OpsError('--checkout bukan checkout SIMSA (scripts/neon-database.mjs tidak ada).');
  }
  return { action, host, database, login: ACTIONS[action] === 'owner' ? owner : ACTIONS[action], rotate, checkout,
    pgBin: backup ? resolve(pgBin) : undefined,
    output: backup ? resolve(values.output ?? join(homedir(), '.simsa-cloud-private', 'database-backups')) : undefined,
    keyDirectory: action === 'backup' ? resolve(values['key-directory'] ?? join(homedir(), '.simsa-recovery-private', 'keys')) : undefined };
}

/** A git-archive source has no node_modules; every helper loads pg from the checkout's backend. */
export function assertCheckoutDependencies(checkout) {
  if (!existsSync(join(checkout, 'backend', 'node_modules', 'pg', 'package.json'))) {
    throw new OpsError(`Dependensi backend checkout belum terpasang. Jalankan dulu: npm ci --prefix "${join(checkout, 'backend')}" --ignore-scripts`);
  }
}

/** Moves the credentials out of the environment so no child process inherits them. */
export function takeCredentials(environment = process.env) {
  const credentials = { credential: environment.SIMSA_OPS_CREDENTIAL, newPassword: environment.SIMSA_OPS_NEW_PASSWORD };
  delete environment.SIMSA_OPS_CREDENTIAL; delete environment.SIMSA_OPS_NEW_PASSWORD;
  return credentials;
}

// Process essentials only (like verify-candidate-source.mjs): helpers may load
// pg from an older checkout, so no token, NODE_OPTIONS or other URL is inherited.
const INHERITED = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMW6432', 'USERNAME', 'USERDOMAIN', 'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS', 'OS', 'LANG', 'LC_ALL', 'TZ', 'NODE_EXTRA_CA_CERTS']);

/** Process essentials, the pinned target and exactly the given connection variable. */
export function childEnvironment(base, plan, variables) {
  const environment = Object.fromEntries(Object.entries(base).filter(([key]) => INHERITED.has(key.toUpperCase())));
  return { ...environment, NEON_EXPECTED_HOST: plan.host, NEON_EXPECTED_DATABASE: plan.database, ...variables };
}

async function withClient(Client, plan, user, password, work) {
  const client = new Client({ host: plan.host, port: 5432, database: plan.database, user, password,
    ssl: { rejectUnauthorized: true, servername: plan.host }, enableChannelBinding: true,
    connectionTimeoutMillis: 15000, statement_timeout: 60000, query_timeout: 65000, application_name: 'simsa-ops-' + plan.action });
  client.on('error', () => {}); // Idle client errors could otherwise print connection details.
  try { await client.connect(); return await work(client); }
  finally { await client.end().catch(() => {}); }
}

export async function runOperation(plan, { credential, newPassword }, { spawn = spawnSync, Client, log = console.log, environment = process.env } = {}) {
  const password = operatorPassword(credential, { role: plan.login, host: plan.host, database: plan.database });
  const helper = (script, args, role, secret) => {
    const variables = { [URL_ENV[role]]: neonUrl({ role, password: secret, host: plan.host, database: plan.database }) };
    const result = spawn(process.execPath, [script, ...args], { cwd: plan.checkout, env: childEnvironment(environment, plan, variables),
      stdio: 'inherit', windowsHide: true, shell: false });
    if (result.error) throw new OpsError(`Helper tidak dapat dijalankan (${result.error.code ?? 'spawn'}).`);
    return result.status ?? 1;
  };
  if (plan.action === 'backup') return helper('scripts/neon-backup.mjs', ['create', '--pg-bin', plan.pgBin, '--output', plan.output, '--key-directory', plan.keyDirectory], 'simsa_backup', password);
  if (plan.action === 'diag-backup') return helper(DIAGNOSTIC, ['--checkout', plan.checkout, '--pg-bin', plan.pgBin, '--output', plan.output], 'simsa_backup', password);
  if (plan.action === 'migrate') return helper('scripts/neon-database.mjs', ['migrate', '--apply'], 'simsa_migration', password);
  if (plan.action === 'verify-runtime') return helper('scripts/neon-database.mjs', ['verify-runtime'], 'simsa_api', password);

  // rotate-migrate keeps the established flow: a random password that lives
  // only in this process, used once for the migration and then forgotten.
  const fresh = plan.action === 'rotate-migrate' ? randomRolePassword() : newPassword;
  assertRotationPassword(fresh);
  if (fresh === password) throw new OpsError('Password baru tidak boleh sama dengan password pemilik.');
  const PgClient = Client ?? createRequire(join(plan.checkout, 'backend', 'package.json'))('pg').Client;
  await withClient(PgClient, plan, plan.login, password, client => rotateLoginRole(client, { role: plan.rotate, password: fresh }));
  log(`rotasi ${plan.rotate}: ok (password tidak ditampilkan${plan.action === 'rotate-migrate' ? ' dan tidak disimpan' : ''})`);
  if (plan.action === 'rotate-migrate') return helper('scripts/neon-database.mjs', ['migrate', '--apply'], 'simsa_migration', fresh);
  // The ALTER is already committed here: say so, the caller must not assume the old password still works.
  const applied = `Password baru ${plan.rotate} SUDAH berlaku`;
  let session;
  try { session = await withClient(PgClient, plan, plan.rotate, fresh, async client => (await client.query('SELECT session_user AS role')).rows[0]?.role); }
  catch (error) { throw new OpsError(`${applied}, tetapi bukti login gagal (${describeFailure(error)}). Lanjutkan langkah berikut atau kembalikan password lama dengan rotate-role.`); }
  if (session !== plan.rotate) throw new OpsError(`${applied}, tetapi login tidak menghasilkan role yang diharapkan.`);
  log(`login ${plan.rotate} dengan password baru: ok`);
  log(`langkah berikut: ${ROTATION_FOLLOW_UP[plan.rotate]}`);
  return 0;
}

const HINTS = Object.freeze({ '28P01': 'password salah atau tidak berlaku untuk role ini', '28000': 'role tidak diizinkan login ke database ini',
  '42501': 'hak role tidak cukup', '3D000': 'database tidak ada', ENOTFOUND: 'host tidak ditemukan', ECONNREFUSED: 'koneksi ditolak',
  ETIMEDOUT: 'koneksi habis waktu', ECONNRESET: 'koneksi diputus server' });

/** Provider messages can echo SQL or connection details; print only a code. */
export function describeFailure(error) {
  if (error instanceof OpsError) return error.message;
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{5,24}$/.test(error.code) ? error.code : 'TIDAK_DIKENAL';
  return `Operasi gagal (${code}${HINTS[code] ? ': ' + HINTS[code] : ''}). Detail koneksi tidak dicetak.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const credentials = takeCredentials();
  let code = 1;
  if (process.argv.slice(2).join(' ') === '--help') { console.log(USAGE); code = 0; }
  else {
    try {
      const plan = planOperation(process.argv.slice(2));
      assertCheckoutDependencies(plan.checkout);
      console.log(`== ${plan.action}: login ${plan.login}${plan.rotate ? `, rotasi ${plan.rotate}` : ''}, host ${plan.host}, db ${plan.database}, checkout ${plan.checkout}`);
      code = await runOperation(plan, credentials);
    } catch (error) { console.error(describeFailure(error)); }
    console.log(`== SELESAI exit=${code}`);
  }
  process.exitCode = code;
}
