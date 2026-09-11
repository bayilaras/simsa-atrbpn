#!/usr/bin/env node
/** Operator-invoked, database-only backup. Never scheduled or uploaded here. */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getCACertificates } from 'node:tls';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { parseNeonBackupOperation, sealNeonBundle, openNeonBundle, loadNeonEvidenceSql, migrationManifest, NEON_BACKUP_FORMAT } from './neon-backup-core.mjs';
import { assertNeonBackupRole, provisionNeonBackupRole, NEON_RESTORE_OWNERS_SQL } from './neon-backup-role.mjs';
import { POLICY_ROLES, LOGIN_ROLES, loadNeonGrantPolicy, assertNeonRoleBoundaries, verifyNeonRuntime } from './neon-database-policy.mjs';
import { makeBackupWorkspace, boundedFile, physical, createDisposableBackupTarget } from './neon-backup-runtime.mjs';
import { MAX_ARCHIVE_BYTES, MAX_EVIDENCE_BYTES, normalizeEvidence, requireCondition as check, sha256 } from './local-backup-drill-core.mjs';
import { monitorSnapshotConnection, parsePrivateJson } from './local-current-backup-core.mjs';
import { loadMigrations, validateAppliedMigrations } from '../backend/scripts/migrate-database.mjs';

const requireBackend = createRequire(new URL('../backend/package.json',import.meta.url));
const { Client } = requireBackend('pg');
const root=resolve(import.meta.dirname,'..');
const helperFiles=['scripts/neon-backup.mjs','scripts/neon-backup-core.mjs','scripts/neon-backup-runtime.mjs','scripts/neon-backup-role.mjs',
  'scripts/neon-database-policy.mjs','scripts/neon-worker-role.mjs','scripts/local-backup-drill-core.mjs','.github/scripts/collect-backup-evidence.sql','backend/src/db/grants/0002_converge_application_grants.sql'];
export async function neonBackupHelperHashes(){return Object.fromEntries(await Promise.all(helperFiles.map(async file=>[file,sha256((await readFile(join(root,file),'utf8')).replaceAll('\r\n','\n'))])));}
const helperHashes=neonBackupHelperHashes;
const ident=v=>{check(/^[A-Za-z][A-Za-z0-9_.@-]{0,62}$/.test(v),'Invalid authenticated database identifier');return `"${v}"`;};

/** Internal reusable capture primitive, also exercised against disposable PG. */
export async function captureNeonSnapshot({client,command,environment,source,signal}) {
  const abort=new AbortController(); const monitor=monitorSnapshotConnection(client,abort);
  const combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;
  let archive,evidence;
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE');
    const identity=(await client.query("SELECT current_database() AS db,current_setting('server_version_num')::int AS version,current_setting('transaction_read_only') AS readonly")).rows[0];
    check(identity.db===source.database && identity.version>=180000 && identity.version<190000 && identity.readonly==='on','Unexpected source database/version/read-only transaction');
    await assertNeonRoleBoundaries(client,{database:source.database,role:'simsa_backup'});
    await assertNeonBackupRole(client,{database:source.database,requireIdentity:true});
    const applied=(await client.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id')).rows;
    check(applied.length===39 && validateAppliedMigrations(loadMigrations(),applied).length===0,'Source migration history differs from this release');
    const snapshot=(await client.query('SELECT pg_export_snapshot() AS id,clock_timestamp() AS taken_at')).rows[0];
    check(/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/.test(snapshot.id),'Unsafe snapshot identifier');
    const collector=await loadNeonEvidenceSql();
    evidence=normalizeEvidence((await command('psql',['--no-psqlrc','--no-password','-qAt','-v','ON_ERROR_STOP=on'],{
      env:environment,signal:combined,maximum:MAX_EVIDENCE_BYTES,input:`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '${snapshot.id}';\n${collector.sql}\nCOMMIT;`})).toString());
    archive=await command('pg_dump',['--no-password','--format=custom','--create','--compress=9','--no-owner','--no-privileges',`--snapshot=${snapshot.id}`,'--lock-wait-timeout=60000'],
      {env:environment,signal:combined,maximum:MAX_ARCHIVE_BYTES,timeoutMs:300000});
    monitor.assertHealthy(); await client.query('COMMIT'); monitor.assertHealthy();
    return {archive,evidence,snapshot_at:new Date(snapshot.taken_at).toISOString()};
  } catch(error) {archive?.fill(0);evidence?.fill(0);throw error;}
  finally {await client.end().catch(()=>{});monitor.dispose();}
}

async function createBackup(operation,workspace) {
  const {directory,environment,command}=workspace;
  const keyParent=operation['key-directory'];
  await mkdir(keyParent,{recursive:true,mode:0o700});await physical(keyParent,'directory');
  const keyDirectory=await mkdtemp(join(keyParent,'neon-recovery-key-'));await workspace.secure(keyDirectory);
  const rel=relative(directory,keyDirectory);check(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel),'Recovery key must be outside the bundle');
  const certificate=join(directory,'trusted-roots.pem');
  const roots=getCACertificates('default');check(roots.length>0,'No trusted CA roots');await writeFile(certificate,roots.join('\n'),{flag:'wx',mode:0o600});
  const c=operation.clientConfig;
  const sourceEnvironment={...environment,PGHOST:c.host,PGPORT:'5432',PGDATABASE:c.database,PGUSER:c.user,PGPASSWORD:c.password,
    PGSSLMODE:'verify-full',PGSSLROOTCERT:certificate,PGCHANNELBINDING:'require',PGCONNECT_TIMEOUT:'15',PGOPTIONS:'-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=120000'};
  const hashes=await helperHashes(); const runId=randomBytes(16).toString('hex'), key=randomBytes(32);
  const keyFile=join(keyDirectory,'recovery-key.json');
  await writeFile(keyFile,JSON.stringify({format:NEON_BACKUP_FORMAT,run_id:runId,key_base64:key.toString('base64')})+'\n',{flag:'wx',mode:0o600});
  let plain;
  try {
    plain=await captureNeonSnapshot({client:new Client(c),command,environment:sourceEnvironment,source:operation.source});
    check(JSON.stringify(hashes)===JSON.stringify(await helperHashes()),'Backup helpers changed during capture');
    const bundle=sealNeonBundle({key,runId,archive:plain.archive,evidence:plain.evidence,metadata:{source:operation.source,snapshot_at:plain.snapshot_at,helpers:hashes,migrations:migrationManifest()}});
    await writeFile(join(directory,'database.dump.aesgcm'),bundle.archive,{flag:'wx',mode:0o600});
    await writeFile(join(directory,'source.evidence.aesgcm'),bundle.evidence,{flag:'wx',mode:0o600});
    // Manifest is the completion marker; incomplete directories are not backups.
    await writeFile(join(directory,'manifest.json'),JSON.stringify(bundle.manifest)+'\n',{flag:'wx',mode:0o600});
    return {status:'passed',action:'create',scope:'database-only',bundle:directory,key_file:keyFile,snapshot_at:plain.snapshot_at,
      archive_sha256:bundle.manifest.body.archive_sha256,restore_verified:false};
  } finally {key.fill(0);plain?.archive.fill(0);plain?.evidence.fill(0);}
}

export async function restoreNeonBundle(operation,workspace) {
  const bundlePath=operation.bundle,keyFile=operation['key-file'];
  await workspace.verifyPrivate(bundlePath);await workspace.verifyPrivate(dirname(keyFile));
  for(const file of [keyFile,...['manifest.json','database.dump.aesgcm','source.evidence.aesgcm'].map(name=>join(bundlePath,name))]) await workspace.verifyPrivate(file,'file');
  const relativeKey=relative(bundlePath,keyFile);check(relativeKey==='..'||relativeKey.startsWith('..'+sep)||isAbsolute(relativeKey),'Recovery key must be separate');
  const keyRecord=parsePrivateJson(await boundedFile(keyFile,2048));
  check(keyRecord.format===NEON_BACKUP_FORMAT && /^[A-Za-z0-9+/]{43}=$/.test(keyRecord.key_base64),'Invalid recovery key record');
  const key=Buffer.from(keyRecord.key_base64,'base64');let plain,target;
  try {
    plain=openNeonBundle({manifest:parsePrivateJson(await boundedFile(join(bundlePath,'manifest.json'),65536)),
      archive:await boundedFile(join(bundlePath,'database.dump.aesgcm'),MAX_ARCHIVE_BYTES+128),
      evidence:await boundedFile(join(bundlePath,'source.evidence.aesgcm'),MAX_EVIDENCE_BYTES+128)},key);
    key.fill(0);
    check(keyRecord.run_id===plain.body.run_id && JSON.stringify(plain.body.helpers)===JSON.stringify(await helperHashes())
      && JSON.stringify(plain.body.migrations)===JSON.stringify(migrationManifest()),'Recovery key, helpers or migration release differs from the authenticated bundle');
    const expected=normalizeEvidence(plain.evidence.toString());
    // Authentication and full compatibility checks precede any target process.
    target=await createDisposableBackupTarget(workspace);
    const db=plain.body.source.database;
    const passwords=Object.fromEntries([...LOGIN_ROLES,'simsa_backup'].map(name=>[name,randomBytes(32).toString('hex')]));
    await target.guard();
    await target.query(POLICY_ROLES.map(role=>`CREATE ROLE ${ident(role)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;`).join('\n')
      + [...LOGIN_ROLES,'simsa_backup'].map(role=>`CREATE ROLE ${ident(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD '${passwords[role]}';`).join('\n')
      + "GRANT simsa_api_runtime TO simsa_api WITH ADMIN FALSE, INHERIT TRUE, SET FALSE; GRANT simsa_maintenance TO simsa_operator WITH ADMIN FALSE, INHERIT TRUE, SET FALSE; GRANT simsa_migrator TO simsa_migration WITH ADMIN FALSE, INHERIT TRUE, SET TRUE; GRANT simsa_backup_reader TO simsa_backup WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;");
    await target.guard();
    await workspace.command('pg_restore',['--no-password','--exit-on-error','--create','--no-owner','--no-privileges','--dbname','postgres'],
      {env:target.env(),input:plain.archive,timeoutMs:300000,maximum:4*1024*1024});
    plain.archive.fill(0);
    await target.guard();
    // Restore ownership only within the two application schemas, never the
    // cluster's shared objects/catalogs or any other database.
    await target.query(NEON_RESTORE_OWNERS_SQL,db);
    await target.query(`REVOKE ALL ON DATABASE ${ident(db)} FROM PUBLIC; GRANT CONNECT ON DATABASE ${ident(db)} TO ${POLICY_ROLES.map(ident).join(',')};`,db);
    await target.guard();await target.query(await loadNeonGrantPolicy(),db);
    const collector=await loadNeonEvidenceSql();
    const actual=normalizeEvidence(await target.query(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; ${collector.sql} COMMIT;`,db));
    check(actual.equals(expected),'Restored schema, locale, data or normalized grants differ from source evidence');
    const api=new Client({host:'127.0.0.1',port:target.target.port,database:db,user:'simsa_api',password:passwords.simsa_api,connectionTimeoutMillis:5000});
    api.on('error',()=>{});
    try {await api.connect();await verifyNeonRuntime(api,{database:db});} finally {await api.end().catch(()=>{});}
    check(JSON.stringify(plain.body.helpers)===JSON.stringify(await helperHashes()),'Helpers changed during restore');
    return {status:'passed',action:'restore-verify',scope:'database-only',source_snapshot_at:plain.body.snapshot_at,
      evidence_sha256:sha256(actual),evidence_lines:actual.toString().trimEnd().split('\n').length,
      api_role_verified:true,target_port:target.target.port,target_stopped:true};
  } finally {key.fill(0);plain?.archive.fill(0);plain?.evidence.fill(0);if(target)await target.stop();}
}

export async function runNeonBackup(operation) {
  if(operation.action==='provision') {
    const client=new Client(operation.clientConfig);let failed=false;client.on('error',()=>{failed=true;});
    try {await client.connect();const result=await provisionNeonBackupRole(client,{database:operation.source.database,admin:operation.admin,password:operation.backupPassword,apply:true});check(!failed,'Provision connection lost');return result;}
    finally {await client.end().catch(()=>{});}
  }
  const workspace=await makeBackupWorkspace(operation['pg-bin'],operation.output);
  let result;
  try {result=operation.action==='create'?await createBackup(operation,workspace):await restoreNeonBundle(operation,workspace);}
  catch {await writeFile(join(workspace.directory,'result.json'),JSON.stringify({status:'failed',action:operation.action,scope:'database-only'})+'\n',{flag:'wx',mode:0o600});throw new Error('Backup operation failed; no source credentials, SQL or data were printed');}
  await writeFile(join(workspace.directory,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return {...result,report:join(workspace.directory,'result.json')};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.slice(2).join(' ')==='--help') console.log('Node24: neon-backup.mjs provision --apply | create --pg-bin ABS --output ABS --key-directory ABS | restore-verify --pg-bin ABS --output ABS --bundle ABS --key-file ABS. Source secrets only via explicit private --env-file. On-demand, database-only; no uploads or automatic schedules. See docs/BACKUP_NEON.md.');
  else try {console.log(JSON.stringify(await runNeonBackup(parseNeonBackupOperation(process.argv.slice(2),process.env))));}
  catch(error) {console.error(`Neon backup failed (${typeof error?.code==='string'&&/^[A-Z0-9]{5}$/.test(error.code)?error.code:'CONFIG_OR_POLICY'}). No connection details were printed. See docs/BACKUP_NEON.md.`);process.exitCode=1;}
}
