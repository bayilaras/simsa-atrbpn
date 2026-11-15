import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryAttestation,publishRecoveryStatus,finalizeRecoveryAttempt,recordRecoveryFailure,recoveryFailureNotices,deferredDocumentBudget } from './operations-recovery.mjs';
import { readFile } from 'node:fs/promises';
import { unwrapRecoveryKeys } from './operations-recovery-delivery.mjs';
import { seal,sha256,documentReferences,documentBudgetFromEnvironment } from './operations-recovery-documents.mjs';
import { randomBytes,scryptSync } from 'node:crypto';
const time='2026-09-15T12:00:00.000Z';
const report={runId:'a'.repeat(32),finishedAt:time,backup:{databaseVerified:true,documentsVerified:true,completedAt:time},restore:{databaseVerified:true,documentsVerified:true,targetStopped:true,completedAt:time}};
test('attestation marks success only after both databases and documents proved',()=>{
 assert.equal(recoveryAttestation(report).restore.status,'success');assert.equal(recoveryAttestation(report).backup.status,'success');
 assert.equal(recoveryAttestation({...report,restore:{...report.restore,targetStopped:false}}).restore.status,'failed');
 assert.equal(recoveryAttestation({...report,backup:{databaseVerified:true,documentsVerified:false}}).backup.status,'failed');
 assert.equal(recoveryAttestation({...report,backup:{...report.backup,deliveryVerified:false}}).backup.status,'failed');
 assert.equal(recoveryAttestation({...report,restore:{}}).restore.status,'failed');
});
test('portable recovery key envelope roundtrip rejects wrong passphrase and unbounded KDF',()=>{
 const passphrase='a safe synthetic passphrase longer than32',salt=randomBytes(32),archiveSha256='b'.repeat(64),documentKey=randomBytes(32);
 const metadata={schemaVersion:1,kdf:'scrypt',N:32768,r:8,p:1,saltBase64:salt.toString('base64'),archiveSha256};
 const key=scryptSync(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 const bytes=Buffer.from(JSON.stringify({databaseKeyRecord:JSON.stringify({run_id:'a'.repeat(32),key_base64:randomBytes(32).toString('base64')}),documentKeyBase64:documentKey.toString('base64')}));
 const envelope=seal(bytes,key,`simsa-recovery-keys-v1:${archiveSha256}`);assert.deepEqual(unwrapRecoveryKeys(metadata,envelope,passphrase).documentKey,documentKey);
 assert.throws(()=>unwrapRecoveryKeys(metadata,envelope,'wrong password long enough to test encryption'));
 assert.throws(()=>unwrapRecoveryKeys({...metadata,N:2**30},envelope,passphrase));
});
test('a document budget failure still records its counts and sizes in the run report',()=>{
 const row=n=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,file_url:`https://teststore123.private.blob.vercel-storage.com/${n}.pdf`,sha256:sha256(String(n)),size_bytes:1,storage_access:'private'});
 let error;try{documentReferences(Array.from({length:5001},(_,n)=>row(n)),[]);}catch(caught){error=caught;}
 const failed=recordRecoveryFailure({status:'failed'},'document_inventory',error);
 assert.deepEqual([failed.failureStage,failed.failureCode,failed.documentBudget.objects,failed.documentBudget.objectsHeadroom,failed.documentBudget.exceeded],
  ['document_inventory','DOCUMENT_OBJECTS_OUTSIDE_BUDGET',5001,-1,{limit:'maxObjects',setting:'OPERATIONS_RECOVERY_MAX_DOCUMENT_OBJECTS'}]);
 // The run without documents can never be attested as a backup.
 assert.equal(recoveryAttestation({...failed,runId:'a'.repeat(32),finishedAt:time,backup:{databaseVerified:true,documentsVerified:false,deliveryVerified:true},restore:{}}).backup.status,'failed');
 const other=recordRecoveryFailure({},'database_snapshot',Object.assign(new Error('raw detail'),{documentBudget:{objects:1}}));
 assert.deepEqual(other,{failureStage:'database_snapshot',failureCode:'RECOVERY_FAILED_DETAILS_SUPPRESSED'});
});
test('a crossed document limit or a mistyped limit is announced to the operator, in Actions and locally',()=>{
 const row=n=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,file_url:`https://teststore123.private.blob.vercel-storage.com/${n}.pdf`,sha256:sha256(String(n)),size_bytes:1,storage_access:'private'});
 let over;try{documentReferences(Array.from({length:51},(_,n)=>row(n)),[],{limits:documentBudgetFromEnvironment({OPERATIONS_RECOVERY_MAX_DOCUMENT_OBJECTS:'50'})});}catch(caught){over=caught;}
 const [annotation]=recoveryFailureNotices('document_inventory',over,{GITHUB_ACTIONS:'true'});
 assert.match(annotation,/^::error title=SIMSA backup melewati batas dokumen::Jumlah objek unik 51 melewati batas 50\. Run ini TIDAK mencadangkan dokumen apa pun.*OPERATIONS_RECOVERY_MAX_DOCUMENT_OBJECTS/);
 const [plain]=recoveryFailureNotices('document_inventory',over,{});
 assert.match(plain,/^Jumlah objek unik 51 melewati batas 50\./);
 let invalid;try{documentBudgetFromEnvironment({OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES:'4GiB'});}catch(caught){invalid=caught;}
 assert.equal(recordRecoveryFailure({},'document_inventory',invalid).failureCode,'DOCUMENT_BUDGET_SETTING_INVALID');
 const [setting]=recoveryFailureNotices('document_inventory',invalid,{GITHUB_ACTIONS:'true'});
 assert.match(setting,/^::error title=SIMSA backup - pengaturan batas dokumen tidak valid::Nilai variabel OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES tidak dapat dipakai\./);
 assert.match(setting,/Database tetap dicadangkan pada run ini, tetapi dokumen TIDAK dicadangkan\.$/);
 assert.doesNotMatch(setting,/4GiB|[%\r\n]/);
 // Anything else stays suppressed, including a forged setting name.
 assert.deepEqual(recoveryFailureNotices('database_snapshot',new Error('raw detail'),{GITHUB_ACTIONS:'true'}),[]);
 assert.deepEqual(recoveryFailureNotices('configuration',Object.assign(new Error('x'),{safeCode:'DOCUMENT_BUDGET_SETTING_INVALID',documentBudgetSetting:'raw detail'}),{}),[]);
});
test('a mistyped document limit is raised only after the encrypted database is delivered',async()=>{
 for(const value of ['8GiB','8589934592 ']){
  const held=deferredDocumentBudget({OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES:value});
  assert.equal(held.limits,undefined);assert.equal(held.error.safeCode,'DOCUMENT_BUDGET_SETTING_INVALID');assert.equal(held.error.documentBudgetSetting,'OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES');
 }
 const valid=deferredDocumentBudget({OPERATIONS_RECOVERY_MAX_DOCUMENT_OBJECTS:'9000'});
 assert.equal(valid.error,undefined);assert.equal(valid.limits.maxObjects,9000);
 // runRecovery needs Linux, Node 24 and PostgreSQL 18, so the order of its
 // stages is checked on the source: the held error may not be thrown earlier.
 const source=await readFile(new URL('./operations-recovery.mjs',import.meta.url),'utf8'),body=source.slice(source.indexOf('export async function runRecovery'));
 const at=text=>{const index=body.indexOf(text);assert.notEqual(index,-1,text);return index;};
 assert.ok(at('deferredDocumentBudget(environment)')<at("stage='database_snapshot'"));
 assert.ok(at('report.backup.deliveryVerified=true')<at('throw invalidDocumentBudget'));
 assert.ok(at("stage='document_inventory'")<at('throw invalidDocumentBudget'));
 assert.ok(at('throw invalidDocumentBudget')<at('documentReferences('));
 assert.equal(body.split('throw invalidDocumentBudget').length,2);
 assert.equal(body.includes('documentBudgetFromEnvironment('),false);
});
test('the document inventory also reads the Berita Acara Autentikasi locators from the dump',async()=>{
 // runRecovery needs Linux, Node 24 and PostgreSQL 18; the inventory step is checked on the source.
 const source=await readFile(new URL('./operations-recovery.mjs',import.meta.url),'utf8');
 const inventory=source.slice(source.indexOf("stage='document_inventory'"),source.indexOf("stage='document_backup'"));
 assert.match(inventory,/'--table=file_attachments','--table=regulatory_rule_sets','--table=autentikasi'/);
 assert.match(inventory,/autentikasi:parseCopyTable\(sql\.toString\(\),'autentikasi'\)/);
});
test('status keeps completion age and binds sanitized evidence hash',()=>{
 const actual=recoveryAttestation(report);assert.equal(actual.backup.completedAt,time);assert.match(actual.backup.evidenceSha256,/^[a-f0-9]{64}$/);
 assert.notEqual(actual.backup.evidenceSha256,recoveryAttestation({...report,failureCode:'changed'}).backup.evidenceSha256);
});
test('publisher archives a failure before updating only fixed private latest path',async()=>{
 const calls=[];const put=async(...args)=>{calls.push(args);};
 const failed={...report,backup:{databaseVerified:true,documentsVerified:false}};
 await publishRecoveryStatus(failed,{SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN:'vercel_blob_rw_teststore123_secret',SIMSA_PRIVATE_BLOB_STORE_ID:'teststore123'},{put});
 assert.equal(calls.length,2);assert.equal(calls[0][0],`operations/recovery-runs/${report.runId}.json`);assert.equal(calls[0][2].allowOverwrite,false);
 assert.equal(calls[1][0],'operations/recovery-status-v1.json');assert.equal(calls[1][2].allowOverwrite,true);assert.equal(calls[1][2].access,'private');
 assert.equal(JSON.parse(calls[1][1]).backup.status,'failed');
});
test('publisher rejects independently pinned hostname mismatch without sending request',async()=>{
 let calls=0;await assert.rejects(publishRecoveryStatus(report,{SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN:'vercel_blob_rw_otherstore_secret',OPERATIONS_RECOVERY_EXPECTED_BLOB_HOSTNAME:'teststore123.private.blob.vercel-storage.com'},{put:async()=>calls++}));assert.equal(calls,0);
});
test('local proof write failure still publishes a failed attempt, without raw filesystem details',async()=>{
 const attempt=structuredClone({...report,status:'success'});let published;
 await finalizeRecoveryAttempt(attempt,{persist:async()=>{throw new Error('private file path and unexpected sensitive detail');},publish:async()=>{published=recoveryAttestation(attempt);}});
 assert.equal(attempt.status,'failed');assert.equal(attempt.localEvidenceFailure,true);assert.equal(attempt.statusPublished,true);
 assert.equal(published.backup.status,'failed');assert.equal(published.restore.status,'failed');assert.equal(JSON.stringify(attempt).includes('sensitive detail'),false);
});
test('publication failure remains visible even after local report persistence succeeds',async()=>{
 const attempt=structuredClone({...report,status:'success'});let persisted=false;
 await finalizeRecoveryAttempt(attempt,{persist:async()=>{persisted=true;},publish:async()=>{throw new Error('unexpected raw credential detail');}});
 assert.equal(persisted,true);assert.equal(attempt.status,'failed');assert.equal(attempt.publicationFailure,true);assert.equal(attempt.statusPublished,false);
});
