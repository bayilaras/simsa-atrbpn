#!/usr/bin/env node
/** Pinned read-only source capture, encrypted documents, isolated Linux restore. */
import { readFile,writeFile,mkdir,copyFile } from 'node:fs/promises';
import { resolve,join,isAbsolute } from 'node:path';
import { randomBytes,scryptSync } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseNeonBackupOperation } from './neon-backup-core.mjs';
import { runNeonBackup } from './neon-backup.mjs';
import { makeBackupWorkspace } from './neon-backup-runtime.mjs';
import { authenticatedDatabaseBundle,restoreDatabaseProof } from './operations-recovery-database.mjs';
import { restoreDeliveryProof } from './operations-recovery-delivery.mjs';
import { seal,unseal,sha256,parseCopyTable,documentReferences,backupDocuments,restoreDocuments,privateBlobConfiguration } from './operations-recovery-documents.mjs';
const check=(value,code)=>{if(!value)throw Object.assign(new Error(code),{safeCode:code});};
const required=(env,key)=>{check(typeof env[key]==='string'&&env[key].length>0,'RECOVERY_CONFIGURATION_MISSING');return env[key];};
export function recoveryAttestation(report){
 const evidenceSha256=sha256(JSON.stringify(report));
 const backupSuccess=!report.localEvidenceFailure&&report.backup?.databaseVerified===true&&report.backup?.documentsVerified===true&&report.backup?.deliveryVerified!==false;
 const restoreSuccess=!report.localEvidenceFailure&&report.restore?.databaseVerified===true&&report.restore?.documentsVerified===true&&report.restore?.targetStopped===true;
 return {schemaVersion:1,backup:{status:backupSuccess?'success':'failed',completedAt:report.backup?.completedAt||report.finishedAt,evidenceSha256,databaseVerified:report.backup?.databaseVerified===true,documentsVerified:report.backup?.documentsVerified===true},
  restore:{status:restoreSuccess?'success':'failed',completedAt:report.restore?.completedAt||report.finishedAt,evidenceSha256,databaseVerified:report.restore?.databaseVerified===true,documentsVerified:report.restore?.documentsVerified===true}};
}
export async function publishRecoveryStatus(report,environment,{put}={}){
 check(/^[a-f0-9]{32}$/.test(report.runId),'INVALID_RECOVERY_RUN_ID');
 const {token}=privateBlobConfiguration(environment);
 if(!put)({put}=createRequire(new URL('../backend/package.json',import.meta.url))('@vercel/blob'));
 const options={access:'private',token,addRandomSuffix:false,contentType:'application/json',cacheControlMaxAge:60};
 // Immutable historical evidence first. Publishing latest failure is deliberate.
 await put(`operations/recovery-runs/${report.runId}.json`,JSON.stringify(report),{...options,allowOverwrite:false});
 await put('operations/recovery-status-v1.json',JSON.stringify(recoveryAttestation(report)),{...options,allowOverwrite:true});
}
export async function finalizeRecoveryAttempt(report,{persist,publish}){
 // A full disk or an existing report must not prevent the independently
 // authenticated status channel from recording the failed attempt.
 try{await persist();}catch{report.localEvidenceFailure=true;report.status='failed';}
 if(publish){try{await publish();report.statusPublished=true;}catch{report.statusPublished=false;report.publicationFailure=true;report.status='failed';}}
 return report;
}
export async function runRecovery(environment){
 const report={schemaVersion:1,runId:randomBytes(16).toString('hex'),startedAt:new Date().toISOString(),status:'failed',
  sourceAccess:'read_only_simsa_backup',productionDatabaseMutations:0,plaintextDumpWritten:false,plaintextDocumentWritten:false,
  backup:{databaseVerified:false,documentsVerified:false,deliveryVerified:false},restore:{databaseVerified:false,documentsVerified:false,targetStopped:false}};
 let plain,documentKey,targetKey,keyEnvelope,stage='configuration',output;
 try{
  check(process.platform==='linux'&&process.versions.node.split('.')[0]==='24','LINUX_NODE24_REQUIRED');
  const pgBin=required(environment,'OPERATIONS_RECOVERY_PG_BIN'),parent=required(environment,'OPERATIONS_RECOVERY_PRIVATE_ROOT');
  output=required(environment,'OPERATIONS_RECOVERY_DELIVERY');
  check([pgBin,parent,output].every(isAbsolute),'ABSOLUTE_RECOVERY_PATHS_REQUIRED');
  const passphrase=required(environment,'BACKUP_ENCRYPTION_PASSPHRASE');check(passphrase.length>=32,'BACKUP_PASSPHRASE_TOO_SHORT');
  const {token}=privateBlobConfiguration(environment);
  await mkdir(output,{mode:0o700});
  const operation=parseNeonBackupOperation(['create','--pg-bin',pgBin,'--output',join(parent,'database'),'--key-directory',join(parent,'keys')],environment);
  stage='database_snapshot';const backup=await runNeonBackup(operation);
  const workspace=await makeBackupWorkspace(pgBin,join(parent,'verification'));
  stage='authenticate_database';plain=await authenticatedDatabaseBundle(backup,workspace);
  report.sourceSnapshotAt=plain.body.snapshot_at;report.archiveSha256=sha256(plain.archive);report.migrations=plain.body.migrations.length;report.backup.databaseVerified=true;
  // Persist encrypted database and recoverable wrapped keys before later phases,
  // so a failed document fetch/restore cannot erase a valid database capture.
  documentKey=randomBytes(32);targetKey=randomBytes(32);
  stage='encrypted_delivery';const archiveDir=join(output,'database');await mkdir(archiveDir,{mode:0o700});
  for(const file of ['manifest.json','database.dump.aesgcm','source.evidence.aesgcm'])await copyFile(join(backup.bundle,file),join(archiveDir,file));
  const salt=randomBytes(32),wrappingKey=scryptSync(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  const record=await readFile(backup.key_file),keys=Buffer.from(JSON.stringify({databaseKeyRecord:record.toString(),documentKeyBase64:documentKey.toString('base64')}));record.fill(0);
  try{keyEnvelope=seal(keys,wrappingKey,`simsa-recovery-keys-v1:${report.archiveSha256}`);await writeFile(join(output,'recovery-keys.aesgcm'),keyEnvelope,{flag:'wx',mode:0o600});
   await writeFile(join(output,'key-envelope.json'),JSON.stringify({schemaVersion:1,kdf:'scrypt',N:32768,r:8,p:1,saltBase64:salt.toString('base64'),archiveSha256:report.archiveSha256}),{flag:'wx',mode:0o600});
   const roundtrip=unseal(await readFile(join(output,'recovery-keys.aesgcm')),wrappingKey,`simsa-recovery-keys-v1:${report.archiveSha256}`);
   try{check(roundtrip.equals(keys),'KEY_ENVELOPE_ROUNDTRIP_FAILED');}finally{roundtrip.fill(0);}
   report.backup.deliveryVerified=true;
  }finally{wrappingKey.fill(0);keys.fill(0);}
  stage='document_inventory';const sql=await workspace.command('pg_restore',['--data-only','--schema=public','--table=file_attachments','--table=regulatory_rule_sets','--file=-'],{input:plain.archive,metadata:true,maximum:20*1024*1024});
  let references;try{references=documentReferences(parseCopyTable(sql.toString(),'file_attachments'),parseCopyTable(sql.toString(),'regulatory_rule_sets'),{captureMissingHashes:environment.OPERATIONS_RECOVERY_CAPTURE_MISSING_HASHES==='true'});}finally{sql.fill(0);}
  stage='document_backup';const documentDirectory=join(output,'documents');
  report.documentBackup=await backupDocuments({references,token,directory:documentDirectory,key:documentKey,sourceSnapshotAt:report.sourceSnapshotAt,archiveSha256:report.archiveSha256,captureMissingHashes:environment.OPERATIONS_RECOVERY_CAPTURE_MISSING_HASHES==='true'});
  report.backup.documentsVerified=true;report.documentBackup.completedAt=new Date().toISOString();report.backup.completedAt=report.sourceSnapshotAt;
  stage='database_restore';report.databaseRestore=await restoreDatabaseProof(plain,workspace);
  report.restore.databaseVerified=report.databaseRestore.fingerprintMatch&&report.databaseRestore.apiRoleVerified;report.restore.targetStopped=report.databaseRestore.targetStopped;
  stage='document_restore';report.documentRestore=await restoreDocuments({directory:documentDirectory,key:documentKey,targetDirectory:join(workspace.directory,'restored-documents'),targetKey,expectedArchiveSha256:report.archiveSha256});
  report.restore.documentsVerified=report.documentRestore.allHashesMatch&&report.documentRestore.unauthorizedDenied;report.restore.completedAt=new Date().toISOString();
  report.status='success';
 }catch(error){report.failureStage=stage;report.failureCode=error?.safeCode||'RECOVERY_FAILED_DETAILS_SUPPRESSED';}
 finally{plain?.archive.fill(0);plain?.evidence.fill(0);documentKey?.fill(0);targetKey?.fill(0);keyEnvelope?.fill(0);
  report.finishedAt=new Date().toISOString();
  await finalizeRecoveryAttempt(report,{persist:async()=>{if(output){await mkdir(output,{recursive:true,mode:0o700});await writeFile(join(output,'recovery-proof.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});await writeFile(join(output,'recovery-status-v1.json'),JSON.stringify(recoveryAttestation(report),null,2)+'\n',{flag:'wx',mode:0o600});}},
   publish:environment.OPERATIONS_RECOVERY_PUBLISH_STATUS==='true'?()=>publishRecoveryStatus(report,environment):undefined});
 }
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.slice(2).join(' ')==='--help')console.log('Node24 on Linux PG18: operations-recovery.mjs run | restore-delivery. Read protected env configuration in docs/OPERATIONS_RECOVERY.md; stdout contains sanitized result only.');
 else if(process.argv.slice(2).join(' ')==='run'){const report=await runRecovery(process.env);console.log(JSON.stringify(report));if(report.status!=='success'||report.publicationFailure)process.exitCode=1;}
 else if(process.argv.slice(2).join(' ')==='restore-delivery'){
  try{const env=process.env;check(process.platform==='linux','LINUX_RESTORE_REQUIRED');const workspace=await makeBackupWorkspace(required(env,'OPERATIONS_RECOVERY_PG_BIN'),required(env,'OPERATIONS_RECOVERY_PRIVATE_ROOT'));
   const proof=await restoreDeliveryProof({directory:required(env,'OPERATIONS_RECOVERY_BUNDLE'),passphrase:required(env,'BACKUP_ENCRYPTION_PASSPHRASE'),workspace});
   console.log(JSON.stringify({status:'success',...proof}));
  }catch{console.error(JSON.stringify({status:'failed',failureCode:'DELIVERY_RESTORE_FAILED_DETAILS_SUPPRESSED'}));process.exitCode=1;}
 }
 else{console.error('Use --help or run.');process.exitCode=1;}
}
