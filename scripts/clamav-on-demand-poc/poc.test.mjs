import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDebData, assertPinnedSignature, assessScan, makePdf, assertFreshManifest, runMeasured } from './core.mjs';
import handler from './api/index.mjs';

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
