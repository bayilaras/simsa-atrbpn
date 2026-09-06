import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { isAbsolute, resolve, relative, dirname, delimiter, parse } from 'node:path';

export const FORMAT = 'simsa-local-aes256gcm-v1';
export const MAGIC = Buffer.from('SIMSA-LBD-1\0', 'ascii');
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function strictPath(value, name) {
  requireCondition(typeof value === 'string' && value.length <= 1024 && isAbsolute(value)
    && !/[\x00-\x1f"`$&|<>^%!]/.test(value), `${name} must be a safe absolute local path`);
  requireCondition(!value.startsWith('\\\\') && !value.startsWith('//'), `${name} cannot be a network path`);
  return resolve(value);
}

export function inside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function validateOutputParent(value, repository) {
  const output = strictPath(value, '--output-parent');
  requireCondition(dirname(output) !== output && output !== parse(output).root,
    'A filesystem root is not an output parent');
  requireCondition(!inside(repository, output) && !inside(output, repository),
    'Output parent must be separate from, and not an ancestor of, the repository');
  return output;
}

export function parseArguments(args, repository) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const required = ['--pg-bin', '--python', '--npm-cli', '--git', '--output-parent'];
  requireCondition(args.length === required.length * 2, 'Exactly five path options are required; see --help');
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    requireCondition(required.includes(name) && !Object.hasOwn(values, name), 'Unknown or duplicate option');
    values[name] = strictPath(args[index + 1], name);
  }
  return {
    pgBin: values['--pg-bin'], python: values['--python'], npmCli: values['--npm-cli'], git: values['--git'],
    outputParent: validateOutputParent(values['--output-parent'], repository),
  };
}

// Deliberately construct, never spread, the caller's environment. Neither
// libpq/npm/dotenv nor Node/Python can inherit credentials or code injection.
export function sterileEnvironment(parent, { privateDir, pgBin, nodePath, platform = process.platform }) {
  const result = {
    PATH: [dirname(nodePath), pgBin].join(delimiter),
    HOME: privateDir, USERPROFILE: privateDir, APPDATA: privateDir, LOCALAPPDATA: privateDir,
    TEMP: privateDir, TMP: privateDir, TMPDIR: privateDir,
    LANG: 'C', LC_ALL: 'C', TZ: 'UTC', NODE_ENV: 'test',
    PGHOST: '127.0.0.1', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5',
    PGCLIENTENCODING: 'UTF8', PGOPTIONS: '-c timezone=UTC -c statement_timeout=120000',
    PGPASSFILE: resolve(privateDir, 'empty.pgpass'),
    PGSERVICEFILE: resolve(privateDir, 'empty.pgservice'),
    PGSYSCONFDIR: privateDir,
    NPM_CONFIG_USERCONFIG: resolve(privateDir, 'empty-user.npmrc'),
    NPM_CONFIG_GLOBALCONFIG: resolve(privateDir, 'empty-global.npmrc'),
    NPM_CONFIG_CACHE: resolve(privateDir, 'npm-cache'),
    NPM_CONFIG_OFFLINE: 'true', NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false', NPM_CONFIG_IGNORE_SCRIPTS: 'true',
    PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: resolve(privateDir, 'empty.gitconfig'),
  };
  if (platform === 'win32') {
    const systemRoot = parent.SystemRoot || parent.SYSTEMROOT;
    requireCondition(typeof systemRoot === 'string' && isAbsolute(systemRoot), 'Windows SystemRoot is required');
    result.SystemRoot = strictPath(systemRoot, 'SystemRoot');
    result.WINDIR = result.SystemRoot;
    result.ComSpec = resolve(result.SystemRoot, 'System32/cmd.exe');
    result.PATH += delimiter + resolve(result.SystemRoot, 'System32');
  }
  return result;
}

export function assertPort(port) {
  requireCondition(Number.isInteger(port) && port >= 40000 && port <= 59999,
    'Only generated high loopback ports 40000-59999 are permitted');
  return port;
}

export function assertClusterIdentity(actual, expected) {
  requireCondition(actual && actual.database === 'postgres' && actual.user === expected.admin
    && actual.session_user === expected.admin && actual.superuser === true
    && actual.host === '127.0.0.1' && Number(actual.port) === assertPort(expected.port)
    && Number(actual.version) >= 180000 && Number(actual.version) < 190000
    && resolve(actual.data_directory) === resolve(expected.dataDir)
    && String(actual.system_identifier) === expected.systemIdentifier,
  'Disposable cluster identity does not match; refusing mutation');
}

export function aad(runId, kind) {
  requireCondition(/^[a-f0-9]{32}$/.test(runId), 'Invalid local run identity');
  requireCondition(['archive', 'evidence'].includes(kind), 'Invalid encrypted artifact kind');
  return Buffer.from(`${FORMAT}\0${runId}\0${kind}`, 'utf8');
}

export function createEncryptor(key, runId, kind) {
  requireCondition(Buffer.isBuffer(key) && key.length === 32, 'Recovery key must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(runId, kind));
  return { cipher, header: Buffer.concat([MAGIC, iv]) };
}

export function encryptBuffer(plain, key, runId, kind) {
  const maximum = kind === 'evidence' ? MAX_EVIDENCE_BYTES : MAX_ARCHIVE_BYTES;
  requireCondition(Buffer.isBuffer(plain) && plain.length > 0 && plain.length <= maximum,
    'Plaintext is empty or exceeds the synthetic drill size limit');
  const { cipher, header } = createEncryptor(key, runId, kind);
  return Buffer.concat([header, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

// Authenticate the complete bounded payload before returning ANY plaintext.
// Callers must not start pg_restore until this function returns successfully.
export function decryptBuffer(sealed, key, runId, kind) {
  const maximum = kind === 'evidence' ? MAX_EVIDENCE_BYTES : MAX_ARCHIVE_BYTES;
  requireCondition(Buffer.isBuffer(sealed) && sealed.length > MAGIC.length + 28
    && sealed.length <= maximum + MAGIC.length + 28 && sealed.subarray(0, MAGIC.length).equals(MAGIC),
  'Encrypted payload is malformed, truncated, or exceeds its size limit');
  requireCondition(Buffer.isBuffer(key) && key.length === 32, 'Recovery key must be 32 bytes');
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(MAGIC.length, MAGIC.length + 12));
  decipher.setAAD(aad(runId, kind));
  decipher.setAuthTag(sealed.subarray(-16));
  let partial;
  try {
    partial = decipher.update(sealed.subarray(MAGIC.length + 12, -16));
    return Buffer.concat([partial, decipher.final()]);
  } finally {
    partial?.fill(0);
  }
}

export function validateManifest(manifest, { runId, commit, archive, evidence, database, systemIdentifier }) {
  requireCondition(manifest && Object.keys(manifest).sort().join(',') === [
    'format', 'run_id', 'repository_commit', 'schema_profile', 'synthetic_only',
    'archive_sha256', 'evidence_sha256', 'source_system_identifier', 'source_database',
    'source_backup_principal', 'backup_role_membership_closure',
  ].sort().join(','), 'Unexpected manifest fields');
  requireCondition(manifest.format === FORMAT && manifest.run_id === runId
    && manifest.repository_commit === commit && /^[a-f0-9]{40}$/.test(commit)
    && manifest.schema_profile === 'post_migration' && manifest.synthetic_only === true
    && manifest.backup_role_membership_closure === 'exact'
    && /^[0-9]{10,30}$/.test(manifest.source_system_identifier)
    && /^simsa_local_[a-f0-9]{16}$/.test(manifest.source_database)
    && manifest.source_system_identifier === systemIdentifier
    && manifest.source_database === database
    && manifest.source_backup_principal === 'simsa_local_source_backup'
    && manifest.archive_sha256 === sha256(archive) && manifest.evidence_sha256 === sha256(evidence),
  'Local artifact manifest or encrypted hashes do not match');
}

export function normalizeEvidence(text) {
  requireCondition(typeof text === 'string' && Buffer.byteLength(text) <= MAX_EVIDENCE_BYTES,
    'Evidence exceeds its size limit');
  const normalized = text.replaceAll('\r\n', '\n');
  const lines = normalized.slice(0, -1).split('\n');
  requireCondition(lines.length >= 25 && normalized.endsWith('\n') && lines.every(line =>
    /^[a-z_]+\t[^\t\r\n]+\t[0-9]+\t(?:[a-f0-9]{64}|-)$/.test(line)),
  'Evidence contains unexpected output or is truncated');
  for (const category of ['schema_profile', 'checkout_migration_manifest', 'database_properties',
    'database_engine_major', 'migration_history', 'database_role_acl', 'schema_column',
    'schema_constraint', 'schema_routine', 'table_count', 'critical_rows']) {
    requireCondition(lines.some(line => line.startsWith(`${category}\t`)), `Missing evidence category: ${category}`);
  }
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

export function extractBackupGuard(workflow) {
  const matches = [...workflow.replaceAll('\r\n', '\n').matchAll(
    /^          (WITH RECURSIVE role_state AS \([\s\S]*?)^          SQL\n          \)/gm,
  )];
  requireCondition(matches.length === 1, 'Cannot locate exactly one current workflow backup-role guard');
  return matches[0][1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
}
