import { mkdtemp, readFile, writeFile, rm, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_LIFETIME_MS, assertFreshManifest, makePdf, runMeasured, assessScan, childEnvironment, readCvdArtifact } from './core.mjs';

const root=dirname(fileURLToPath(import.meta.url));
let running=false;
export async function runProbe(){
 if(running)throw new Error('POC already running in this instance');
 if(process.platform!=='linux'||process.arch!=='x64')throw new Error('POC requires Linux x64');
 running=true;let work;
 try{
  const deadline=Date.now()+MAX_LIFETIME_MS,vendor=join(root,'vendor');
  const manifest=JSON.parse(await readFile(join(vendor,'manifest.json'),'utf8'));assertFreshManifest(manifest);
  if(!Array.isArray(manifest.databases)||manifest.databases.length!==3||new Set(manifest.databases.map(db=>db.name)).size!==3)throw new Error('Bundled database manifest is incomplete');
  for(const db of manifest.databases){const actual=await readCvdArtifact(join(vendor,'database'),db.name);for(const field of ['version','bytes','sha256','signatureFile','signatureBytes','signatureSha256'])if(actual[field]!==db[field])throw new Error('Bundled database or signature hash mismatch');}
  work=await mkdtemp(join(tmpdir(),'simsa-clamav-probe-'));const space=await statfs(work);
  const fixtures=[{name:'small.pdf',bytes:makePdf(1024),expected:'clean'},{name:'ten-mib.pdf',bytes:makePdf(10*1024*1024),expected:'clean'},{name:'eicar.txt',bytes:Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$'+'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*','ascii'),expected:'eicar'}];
  const scans=[];
  for(const fixture of fixtures){
   const file=join(work,fixture.name);await writeFile(file,fixture.bytes,{mode:0o600});
   const result=await runMeasured(join(vendor,'bin/clamscan'),[`--database=${vendor}/database`,`--cvdcertsdir=${vendor}/etc/certs`,'--fips-limits','--max-filesize=11M','--max-scansize=30M','--max-recursion=10','--max-files=100','--max-scantime=60000','--alert-exceeds-max=yes','--alert-encrypted=yes',`--tempdir=${work}`,file],{env:childEnvironment(vendor),deadline});
   const passed=assessScan(result,fixture.expected)&&!result.outputExceeded;
   scans.push({fixture:fixture.name,bytes:fixture.bytes.length,passed,exitCode:result.code,signal:result.signal,timedOut:result.timedOut,memoryExceeded:result.memoryExceeded,elapsedMs:result.elapsedMs,peakChildRssBytes:result.peakChildRssBytes,peakCombinedRssBytes:result.peakCombinedRssBytes,...(!passed?{syntheticDiagnostic:(result.stderr+'\n'+result.stdout).slice(-2048)}:{})});
   if(!passed)break;
  }
  return {poc:true,productionIntegrated:false,passed:scans.length===3&&scans.every(s=>s.passed),engineVersion:manifest.version,definitionsVerifiedAt:manifest.verifiedAt,bundleBytes:manifest.bundleBytes,tmpAvailableBytes:space.bavail*space.bsize,rssMeasurement:'Linux proc status sampled every25ms; child plus parent RSS, not complete cgroup accounting',scans};
 }finally{if(work)await rm(work,{recursive:true,force:true});running=false;}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){try{const result=await runProbe();console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;}catch(error){console.error(JSON.stringify({poc:true,passed:false,error:error.message}));process.exitCode=1;}}
