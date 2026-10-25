#!/usr/bin/env node
/** One bounded operational run of the existing file integrity service. */
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {Readable} from 'node:stream';
import {writeFile} from 'node:fs/promises';
import {validateNeonTarget} from './neon-target.mjs';
import {assertNeonWorkerRole} from './neon-worker-role.mjs';
import {privateBlobConfiguration,pinnedPrivateUrl} from './operations-recovery-documents.mjs';
const requireBackend=createRequire(new URL('../backend/package.json',import.meta.url));
const {tsImport}=await import(pathToFileURL(requireBackend.resolve('tsx/esm/api')));
const {FileFixityService,loadFixityConfig}=await tsImport(new URL('../backend/src/services/file-fixity.service.ts',import.meta.url).href,{parentURL:import.meta.url,tsconfig:false});
const {normalizeStoredObjectLocator}=await tsImport(new URL('../backend/src/storage/locator.ts',import.meta.url).href,{parentURL:import.meta.url,tsconfig:false});
const check=(value,code)=>{if(!value)throw Object.assign(new Error(code),{safeCode:code});};

export function parseIntegrityEnvironment(environment){
 const url=validateNeonTarget(environment.NEON_WORKER_DATABASE_URL,{role:'simsa_worker'});
 check(url.hostname===environment.NEON_WORKER_EXPECTED_HOST&&url.pathname==='/'+environment.NEON_WORKER_EXPECTED_DATABASE,'INTEGRITY_DATABASE_PIN_MISMATCH');
 check(!['postgres','template0','template1'].includes(environment.NEON_WORKER_EXPECTED_DATABASE),'INTEGRITY_SYSTEM_DATABASE_REFUSED');
 privateBlobConfiguration(environment);
 const fixity=loadFixityConfig({FIXITY_BATCH_SIZE:'10',...environment});
 check(fixity.batchSize<=20&&fixity.maximumBytes<=64*1024*1024&&fixity.timeoutMs<=120000,'INTEGRITY_RUN_EXCEEDS_REVIEWED_BUDGET');
 return {fixity,database:environment.NEON_WORKER_EXPECTED_DATABASE,clientConfig:{host:url.hostname,port:5432,database:environment.NEON_WORKER_EXPECTED_DATABASE,
  user:'simsa_worker',password:decodeURIComponent(url.password),ssl:{rejectUnauthorized:true,servername:url.hostname},enableChannelBinding:true,
  max:2,connectionTimeoutMillis:15000,idleTimeoutMillis:3000,statement_timeout:120000,query_timeout:125000,
  application_name:'simsa-scheduled-file-integrity',options:'-c timezone=UTC'}};
}
export function createPrivateIntegrityReader(environment,{fetchImpl=fetch,onRead=()=>{}}={}){
 const {token}=privateBlobConfiguration(environment);
 return async(locator,options={})=>{
  const normalized=normalizeStoredObjectLocator(locator);check(normalized,'INTEGRITY_LOCATOR_INVALID');
  check(!options.generation,'INTEGRITY_UNSUPPORTED_OBJECT_GENERATION');
  const url=pinnedPrivateUrl(normalized,token);
  const response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{authorization:`Bearer ${token}`},signal:options.abortSignal});
  check(response.status===200&&response.body,'INTEGRITY_OBJECT_READ_FAILED');onRead();
  // inspectBitstream owns the deadline, streaming byte cap, digest comparison,
  // baseline guards, and final stream destruction. No plaintext is written.
  return {stream:Readable.fromWeb(response.body),contentType:response.headers.get('content-type')||'application/octet-stream',
   size:Number(response.headers.get('content-length'))||undefined};
 };
}
export async function runIntegrityWithPool(pool,environment,{fetchImpl=fetch}={}){
 const {fixity}=parseIntegrityEnvironment(environment);let downloaded=0;
 const reader=createPrivateIntegrityReader(environment,{fetchImpl,onRead:()=>downloaded++});
 const summary=await new FileFixityService(pool,reader).run(fixity);
 const attention=summary.failed>0||summary.mismatched>0||summary.stale>0;
 return {status:attention?'attention':'success',summary,privateObjectDownloads:downloaded,maximumChecks:fixity.batchSize,
  intervalSeconds:fixity.intervalSeconds,retrySeconds:fixity.retrySeconds,maximumBytes:fixity.maximumBytes,timeoutMs:fixity.timeoutMs,
  expectedHashesOverwritten:false,productionBusinessContentChanged:false,service:'existing_FileFixityService'};
}
export async function runFileIntegrity(environment){
 const report={startedAt:new Date().toISOString(),status:'failed',roleVerified:false,poolClosed:false};let pool,stage='configuration';
 try{
  check(process.versions.node.split('.')[0]==='24','INTEGRITY_REQUIRES_NODE24');const configuration=parseIntegrityEnvironment(environment);
  const {Pool}=requireBackend('pg');pool=new Pool(configuration.clientConfig);pool.on('error',()=>{});
  stage='worker_role_preflight';const client=await pool.connect();
  try{await client.query('BEGIN READ ONLY');await assertNeonWorkerRole(client,{database:configuration.database,requireIdentity:true});await client.query('COMMIT');report.roleVerified=true;}
  catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  stage='existing_fixity_service';Object.assign(report,await runIntegrityWithPool(pool,environment));
 }catch(error){report.status='failed';report.failureStage=stage;report.failureCode=error?.safeCode||'INTEGRITY_RUN_FAILED_DETAILS_SUPPRESSED';}
 finally{if(pool){try{await pool.end();report.poolClosed=true;}catch{report.status='failed';report.shutdownFailure=true;}}report.finishedAt=new Date().toISOString();}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.slice(2).join(' ')==='--help')console.log('Node24: check-file-integrity.mjs run. Uses protected NEON_WORKER_DATABASE_URL, NEON_WORKER_EXPECTED_HOST/DATABASE and SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN; existing FileFixityService only.');
 else if(process.argv.slice(2).join(' ')==='run'){
  const result=await runFileIntegrity(process.env);console.log(JSON.stringify(result));
  if(process.env.OPERATIONS_FIXITY_REPORT){try{await writeFile(process.env.OPERATIONS_FIXITY_REPORT,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});}catch{console.error('INTEGRITY_REPORT_WRITE_FAILED');process.exitCode=1;}}
  if(result.status!=='success'||!result.poolClosed)process.exitCode=1;
 }else{console.error('Use --help or run.');process.exitCode=1;}
}
