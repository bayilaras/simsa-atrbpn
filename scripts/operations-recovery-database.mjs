import { readFile } from 'node:fs/promises';
import { join,dirname } from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { boundedFile } from './neon-backup-runtime.mjs';
import { openNeonBundle,migrationManifest,loadNeonEvidenceSql } from './neon-backup-core.mjs';
import { neonBackupHelperHashes } from './neon-backup.mjs';
import { POLICY_ROLES,LOGIN_ROLES,loadNeonGrantPolicy,verifyNeonRuntime } from './neon-database-policy.mjs';
import { NEON_RESTORE_OWNERS_SQL } from './neon-backup-role.mjs';
import { normalizeEvidence,sha256 } from './local-backup-drill-core.mjs';
import { createRecoveryTarget } from './operations-recovery-target.mjs';
const {Client}=createRequire(new URL('../backend/package.json',import.meta.url))('pg');
const check=(value,code)=>{if(!value)throw Object.assign(new Error(code),{safeCode:code});};
const ident=value=>{check(/^[A-Za-z][A-Za-z0-9_.@-]{0,62}$/.test(value),'INVALID_DATABASE_IDENTIFIER');return `"${value}"`;};
export async function authenticatedDatabaseBundle(backup,workspace){
 await workspace.verifyPrivate(backup.bundle);await workspace.verifyPrivate(dirname(backup.key_file));
 for(const file of [backup.key_file,...['manifest.json','database.dump.aesgcm','source.evidence.aesgcm'].map(name=>join(backup.bundle,name))])await workspace.verifyPrivate(file,'file');
 const record=JSON.parse(await boundedFile(backup.key_file,2048)),key=Buffer.from(record.key_base64,'base64');
 let plain;
 try{plain=openNeonBundle({manifest:JSON.parse(await boundedFile(join(backup.bundle,'manifest.json'),65536)),archive:await boundedFile(join(backup.bundle,'database.dump.aesgcm'),100*1024*1024),evidence:await boundedFile(join(backup.bundle,'source.evidence.aesgcm'),20*1024*1024)},key);
  check(record.run_id===plain.body.run_id && JSON.stringify(plain.body.helpers)===JSON.stringify(await neonBackupHelperHashes()) && JSON.stringify(plain.body.migrations)===JSON.stringify(migrationManifest()),'BUNDLE_HELPER_OR_JOURNAL_MISMATCH');return plain;
 }catch(error){plain?.archive.fill(0);plain?.evidence.fill(0);throw error;}finally{key.fill(0);}
}
export async function restoreDatabaseProof(plain,workspace,{targetFactory=createRecoveryTarget}={}){
 const expected=normalizeEvidence(plain.evidence.toString()),proof={restoreExecuted:false,fingerprintMatch:false,apiRoleVerified:false,targetStopped:false};
 let target;
 try{
  target=await targetFactory(workspace);const database=plain.body.source.database;
  const logins=[...LOGIN_ROLES,'simsa_backup','simsa_worker'];const passwords=Object.fromEntries(logins.map(name=>[name,randomBytes(32).toString('hex')]));
  await target.guard();await target.query(POLICY_ROLES.map(role=>`CREATE ROLE ${ident(role)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;`).join('\n')
   +logins.map(role=>`CREATE ROLE ${ident(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD '${passwords[role]}';`).join('\n')
   +'GRANT simsa_api_runtime TO simsa_api WITH ADMIN FALSE, INHERIT TRUE, SET FALSE; GRANT simsa_maintenance TO simsa_operator WITH ADMIN FALSE, INHERIT TRUE, SET FALSE; GRANT simsa_migrator TO simsa_migration WITH ADMIN FALSE, INHERIT TRUE, SET TRUE; GRANT simsa_backup_reader TO simsa_backup WITH ADMIN FALSE, INHERIT TRUE, SET FALSE; GRANT simsa_worker_runtime TO simsa_worker WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;');
  await target.guard();await (target.command??workspace.command)('pg_restore',['--no-password','--exit-on-error','--create','--no-owner','--no-privileges','--dbname','postgres'],{env:target.env(),input:plain.archive,timeoutMs:300000,maximum:4*1024*1024});proof.restoreExecuted=true;
  await target.guard();await target.query(NEON_RESTORE_OWNERS_SQL,database);
  await target.query(`REVOKE ALL ON DATABASE ${ident(database)} FROM PUBLIC; GRANT CONNECT ON DATABASE ${ident(database)} TO ${POLICY_ROLES.map(ident).join(',')};`,database);
  await target.guard();await target.query(await loadNeonGrantPolicy(),database);
  const collector=await loadNeonEvidenceSql(),actual=normalizeEvidence(await target.query(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; ${collector.sql} COMMIT;`,database));
  check(actual.equals(expected),'RECOVERY_FINGERPRINT_MISMATCH');proof.fingerprintMatch=true;proof.evidenceSha256=sha256(actual);
  proof.tableCountChecks=actual.toString().split('\n').filter(row=>row.startsWith('table_count\t')).length;proof.tableDataHashChecks=actual.toString().split('\n').filter(row=>row.startsWith('critical_rows\t')).length;
  proof.migrations=plain.body.migrations.length;proof.evidenceLines=actual.toString().trimEnd().split('\n').length;
  const api=new Client({host:'127.0.0.1',port:target.target.port,database,user:'simsa_api',password:passwords.simsa_api,connectionTimeoutMillis:5000});api.on('error',()=>{});
  try{await api.connect();await verifyNeonRuntime(api,{database});proof.apiRoleVerified=true;}finally{await api.end().catch(()=>{});}
  check(JSON.stringify(plain.body.helpers)===JSON.stringify(await neonBackupHelperHashes()),'HELPERS_CHANGED_DURING_RESTORE');
 }finally{if(target){await target.stop();proof.targetStopped=true;}}
 return proof;
}
