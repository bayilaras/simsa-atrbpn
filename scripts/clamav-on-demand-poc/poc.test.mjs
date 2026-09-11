import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDebData, assertPinnedSignature, assessScan, makePdf, assertFreshManifest, runMeasured } from './core.mjs';
import handler, { createPocHandler } from './api/index.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCvdArtifact, assertCvdVerification } from './core.mjs';

test('requires the pinned primary signer and a successful signature, not a GOOD signature from another key', () => {
  const fingerprint='5BADCA2665EF59DCF8A23D8B707F0DB480836771';
  assertPinnedSignature(`[GNUPG:] VALIDSIG ${fingerprint} 2026-08-07 1786100000 0 4 0 1 10 00 ${fingerprint}`);
  assert.throws(()=>assertPinnedSignature('[GNUPG:] GOODSIG 123 Unknown'));
  assert.throws(()=>assertPinnedSignature(`[GNUPG:] VALIDSIG ${'A'.repeat(40)} 2026 1 0 4 0 1 10 00 ${'A'.repeat(40)}`));
});
test('malware verdict requires actual exit code, expected file count and full completion',()=>{
  const clean={code:0,signal:null,timedOut:false,memoryExceeded:false,stdout:'sample.pdf: OK\nScanned files: 1\nInfected files: 0\n',stderr:''};
  assert.equal(assessScan(clean,'clean'),true);
  for(const patch of [{code:2},{signal:'SIGKILL'},{timedOut:true},{memoryExceeded:true},{stdout:'Scanned files: 0\nInfected files: 0\n'},{stderr:'ERROR: skipped file'}])assert.equal(assessScan({...clean,...patch},'clean'),false);
  assert.equal(assessScan({...clean,code:1,stdout:'sample: Win.Test.EICAR_HDB-1 FOUND\nScanned files: 1\nInfected files: 1\n'},'eicar'),true);
  assert.equal(assessScan({...clean,code:1,stdout:'sample: Heuristics.Limits.Exceeded FOUND\nScanned files: 1\nInfected files: 1\n'},'eicar'),false);
});
test('fixtures are structurally complete PDFs and large fixture is exactly10MiB',()=>{
  for(const size of [1024,10*1024*1024]){const b=makePdf(size);assert.equal(b.length,size);assert.equal(b.subarray(0,8).toString(),'%PDF-1.4');assert.match(b.toString('latin1'),/startxref\n\d+\n%%EOF\n$/);}
});
test('stale or future manifests cannot be treated as fresh',()=>{
  const now=Date.now();assertFreshManifest({version:'1.5.4',verifiedAt:new Date(now-1000).toISOString()},now);
  for(const verifiedAt of ['invalid',new Date(now-86400001).toISOString(),new Date(now+60001).toISOString()])assert.throws(()=>assertFreshManifest({version:'1.5.4',verifiedAt},now));
});
test('reject malformed Debian container lengths before extraction',()=>{
  assert.throws(()=>parseDebData(Buffer.from('not a deb')));
  assert.throws(()=>parseDebData(Buffer.from('!<arch>\n'+'data.tar.xz'.padEnd(48)+'9999999999'+'`\n')));
});
test('Freshclam signatures use the exact CVD header version; unversioned or other-version files do not qualify',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'simsa-cvd-layout-'));
 try{
  const header='ClamAV-VDB:11 Sep 2026 08-00 +0000:64:1234:90:0123456789abcdef0123456789abcdef:signature:builder:1789100000';
  await writeFile(join(dir,'main.cvd'),header.padEnd(512,' ')+'synthetic layout fixture, not a verified database');
  await writeFile(join(dir,'main.cvd.sign'),'wrong unversioned signature');
  await writeFile(join(dir,'main-63.cvd.sign'),'wrong version');
  await assert.rejects(readCvdArtifact(dir,'main'));
  await writeFile(join(dir,'main-64.cvd.sign'),'synthetic signature layout fixture');
  const artifact=await readCvdArtifact(dir,'main');assert.equal(artifact.version,64);assert.equal(artifact.signatureFile,'main-64.cvd.sign');assert.match(artifact.signatureSha256,/^[a-f0-9]{64}$/);
  await writeFile(join(dir,'main-64.cvd.sign'),'');await assert.rejects(readCvdArtifact(dir,'main'));
  await writeFile(join(dir,'main.cvd'),'ClamAV-VDB:time:../escape'.padEnd(512,' '));await assert.rejects(readCvdArtifact(dir,'main'));
  await assert.rejects(readCvdArtifact(dir,'../main'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('database manifest accepts only matching authenticated sigtool verification, never unsigned info or a zero exit alone',()=>{
 const valid={code:0,signal:null,timedOut:false,outputExceeded:false,stdout:'Version: 64\nVerification OK.\n',stderr:''};
 assertCvdVerification(valid,64);
 for(const patch of [{stdout:'Version: 64\nVerification: Unsigned container\n'},{stdout:'Version: 63\nVerification OK.\n'},{code:1},{signal:'SIGKILL'},{timedOut:true},{stderr:'ERROR: Verification failed'}])assert.throws(()=>assertCvdVerification({...valid,...patch},64));
});
test('deadline terminates and waits for an actual child instead of releasing early',async()=>{
 const result=await runMeasured(process.execPath,['-e','console.log(process.pid);setInterval(()=>{},1000)'],{env:{},deadline:Date.now()+1000});
 assert.equal(result.timedOut,true);assert.notEqual(result.code,0);
 const pid=Number(result.stdout.trim());assert.ok(Number.isSafeInteger(pid)&&pid>0);
 assert.throws(()=>process.kill(pid,0));
});
test('POC is Preview-only; form has no data fields and arbitrary request data is rejected',async()=>{
 const oldEnv=process.env.VERCEL_ENV,oldFlag=process.env.SIMSA_CLAMAV_POC_ENABLED;
 const invoke=async(req)=>{const response={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}};await handler({headers:{},query:{},...req},response);return response;};
 try{
  process.env.SIMSA_CLAMAV_POC_ENABLED='1';process.env.VERCEL_ENV='production';assert.equal((await invoke({method:'GET'})).statusCode,404);
  process.env.VERCEL_ENV='preview';const form=await invoke({method:'GET'});assert.match(form.body,/<form method="post" action="\/">/);assert.doesNotMatch(form.body,/<input|<textarea|<script/);
  for(const patch of [{body:{url:'https://example.com/private'}},{query:{file:'anything'}},{headers:{'content-length':'1'}},{headers:{'transfer-encoding':'chunked'}},{body:Buffer.from('data')}])assert.equal((await invoke({method:'POST',...patch})).statusCode,400);
 }finally{if(oldEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldEnv;if(oldFlag===undefined)delete process.env.SIMSA_CLAMAV_POC_ENABLED;else process.env.SIMSA_CLAMAV_POC_ENABLED=oldFlag;}
});
test('empty browser form bodies reach the probe report, including null-prototype objects and zero-length buffers',async()=>{
 const oldEnv=process.env.VERCEL_ENV,oldFlag=process.env.SIMSA_CLAMAV_POC_ENABLED;
 // A boundary fixture proves routing only; it is not ClamAV execution evidence.
 const report={poc:true,passed:false,boundaryFixture:true,scans:[]};let calls=0;const logs=[];
 const route=createPocHandler(async()=>{calls++;return report;},record=>logs.push(record));
 try{
  process.env.VERCEL_ENV='preview';process.env.SIMSA_CLAMAV_POC_ENABLED='1';
  for(const body of [Object.create(null),Buffer.alloc(0),{},'',undefined,null]){
   const response={statusCode:200,setHeader(){},end(value){this.body=value;}};
   await route({method:'POST',headers:{'content-length':'0','content-type':'application/x-www-form-urlencoded'},query:Object.create(null),body},response);
   assert.equal(response.statusCode,503);assert.deepEqual(JSON.parse(response.body),report);
  }
  assert.equal(calls,6);assert.equal(logs.length,6);
  assert.ok(logs.every(entry=>entry.event==='clamav_poc_result'&&entry.report===report));
 }finally{if(oldEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldEnv;if(oldFlag===undefined)delete process.env.SIMSA_CLAMAV_POC_ENABLED;else process.env.SIMSA_CLAMAV_POC_ENABLED=oldFlag;}
});
test('nonempty parsed bodies remain rejected and diagnostics contain structure only',async()=>{
 const oldEnv=process.env.VERCEL_ENV,oldFlag=process.env.SIMSA_CLAMAV_POC_ENABLED;let calls=0;const logs=[];
 const route=createPocHandler(async()=>{calls++;return {passed:true};},record=>logs.push(record));
 try{
  process.env.VERCEL_ENV='preview';process.env.SIMSA_CLAMAV_POC_ENABLED='1';
  const nullProto=Object.assign(Object.create(null),{url:'SENSITIVE_SENTINEL'});
  for(const body of [nullProto,{url:'SENSITIVE_SENTINEL'},Buffer.from('SENSITIVE_SENTINEL'),'SENSITIVE_SENTINEL',[],42]){
   const response={statusCode:200,setHeader(){},end(value){this.body=value;}};
   await route({method:'POST',headers:{},query:{},body},response);assert.equal(response.statusCode,400);
  }
  assert.equal(calls,0);assert.equal(logs.length,6);assert.doesNotMatch(JSON.stringify(logs),/SENSITIVE_SENTINEL|url/);
  assert.ok(logs.every(entry=>entry.event==='clamav_poc_request_rejected'&&typeof entry.shape.bodyKind==='string'));
 }finally{if(oldEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldEnv;if(oldFlag===undefined)delete process.env.SIMSA_CLAMAV_POC_ENABLED;else process.env.SIMSA_CLAMAV_POC_ENABLED=oldFlag;}
});
