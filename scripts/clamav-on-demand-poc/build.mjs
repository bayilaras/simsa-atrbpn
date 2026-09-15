import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, readdir, cp, lstat, stat, chmod } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION, SIGNER, parseDebData, assertPinnedSignature, runMeasured, childEnvironment, readCvdArtifact, assertCvdVerification } from './core.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const releaseSha256='28d6efc5b4423e7830c3559339552eb53870a9eac51ac4efb37d60530d329886';
// Build-time reuse only. Backend runtime never imports this POC directory.
export async function buildClamavAssets({destination=join(root,'vendor'),includeUpdateTools=false}={}){
if(process.platform!=='linux'||process.arch!=='x64'||Number(process.versions.node.split('.')[0])!==24)throw new Error('POC build requires Linux x64 Node24');
const work=await mkdtemp(join(tmpdir(),'simsa-clamav-build-'));
const env={PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C',LC_ALL:'C',HOME:work};
const checked=async(command,args,extra={})=>{const r=await runMeasured(command,args,{env,deadline:Date.now()+60000,maxRssBytes:Infinity,...extra});if(r.code!==0||r.signal||r.timedOut||r.outputExceeded){console.error(JSON.stringify({phase:command.split('/').at(-1),exitCode:r.code,signal:r.signal,timedOut:r.timedOut,publicBuildDiagnostic:(r.stderr+'\n'+r.stdout).slice(-4096)}));throw new Error(`POC build step failed: ${command.split('/').at(-1)} (${r.code??'signal'})`);}return r;};
async function download(name,maxBytes){const response=await fetch(`https://www.clamav.net/downloads/production/${name}`,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error(`Official release download failed (${response.status})`);let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw new Error('Official release exceeds bound');chunks.push(chunk);}return Buffer.concat(chunks);}
const artifact=`clamav-${VERSION}.linux.x86_64.deb`;
const bytes=await download(artifact,120*1024*1024);
if(createHash('sha256').update(bytes).digest('hex')!==releaseSha256)throw new Error('Pinned release SHA256 mismatch');
await writeFile(join(work,artifact),bytes);await writeFile(join(work,artifact+'.sig'),await download(artifact+'.sig',16384));
const gnupg=join(work,'gnupg');await mkdir(gnupg,{mode:0o700});
let gpg='gpg';try{await checked(gpg,['--version']);}catch{gpg='gpg2';await checked(gpg,['--version']);}
await checked(gpg,['--homedir',gnupg,'--batch','--import',join(root,'talos.asc')]);
const signature=await checked(gpg,['--homedir',gnupg,'--batch','--status-fd','1','--verify',join(work,artifact+'.sig'),join(work,artifact)]);
assertPinnedSignature(signature.stdout);
const data=parseDebData(bytes);await writeFile(join(work,data.name),data.bytes);
const unpack=join(work,'unpack');await mkdir(unpack);
await checked('tar',['-xf',join(work,data.name),'-C',unpack,'./usr/local/bin/clamscan','./usr/local/bin/freshclam','./usr/local/bin/sigtool','./usr/local/lib','./usr/local/etc/certs']);
const install=join(unpack,'usr/local');const clamEnv=childEnvironment(install);
for(const certificate of ['/etc/pki/tls/certs/ca-bundle.crt','/etc/ssl/certs/ca-certificates.crt']){try{await stat(certificate);clamEnv.SSL_CERT_FILE=certificate;break;}catch{/* Try the other standard system CA bundle. */}}
const version=await checked(join(install,'bin/clamscan'),['--version'],{env:clamEnv});
if(!version.stdout.startsWith(`ClamAV ${VERSION}`))throw new Error('Extracted engine version mismatch');
const db=join(work,'database');await mkdir(db);
const config=join(work,'freshclam.conf');
await writeFile(config,[`DatabaseDirectory ${db}`,`DatabaseOwner ${userInfo().username}`,'DatabaseMirror database.clamav.net','DNSDatabaseInfo current.cvd.clamav.net','ConnectTimeout 15','ReceiveTimeout 90','MaxAttempts 1','TestDatabases yes','Bytecode yes','ScriptedUpdates no','FIPSCryptoHashLimits yes',`CVDCertsDirectory ${install}/etc/certs`,''].join('\n'));
// Freshclam performs authenticated updates and engine load tests. No raw CVD curl,
// third-party mirror, disabled TestDatabases, or unsigned fallback is accepted.
const update=await checked(join(install,'bin/freshclam'),['--config-file',config,'--stdout'],{env:clamEnv,deadline:Date.now()+360000});
console.log(JSON.stringify({phase:'freshclam',elapsedMs:update.elapsedMs,databaseFiles:(await readdir(db)).sort().slice(0,30),publicBuildDiagnostic:(update.stdout+'\n'+update.stderr).slice(-4096)}));
const databases=[];
for(const name of ['main','daily','bytecode']){
 const metadata=await readCvdArtifact(db,name),path=join(db,`${name}.cvd`);
 const verification=await checked(join(install,'bin/sigtool'),[`--info=${path}`,'--fips-limits',`--cvdcertsdir=${install}/etc/certs`],{env:clamEnv});
 assertCvdVerification(verification,metadata.version);
 databases.push(metadata);console.log(JSON.stringify({phase:'cvd_verified',...metadata}));
}
const vendor=resolve(destination);await mkdir(vendor);await mkdir(join(vendor,'bin'));await mkdir(join(vendor,'lib'));await mkdir(join(vendor,'etc'));await cp(join(install,'etc/certs'),join(vendor,'etc/certs'),{recursive:true});
for(const binary of includeUpdateTools?['clamscan','freshclam','sigtool']:['clamscan']){
 await cp(join(install,'bin',binary),join(vendor,'bin',binary));
 await chmod(join(vendor,'bin',binary),0o755);
}
for(const entry of await readdir(join(install,'lib'))){if(/\.so(?:\.|$)/.test(entry))await cp(join(install,'lib',entry),join(vendor,'lib',entry),{verbatimSymlinks:true});}
await mkdir(join(vendor,'database'));
for(const metadata of databases){for(const name of [`${metadata.name}.cvd`,metadata.signatureFile])await cp(join(db,name),join(vendor,'database',name));}
async function total(path){let n=0;for(const name of await readdir(path)){const p=join(path,name),s=await lstat(p);if(s.isDirectory())n+=await total(p);else if(s.isFile())n+=s.size;}return n;}
const bundleBytes=await total(vendor);
const report={poc:!includeUpdateTools,version:VERSION,releaseSha256,signer:SIGNER,verifiedAt:new Date().toISOString(),databases,bundleBytes,requiresLargeFunctions:bundleBytes>240*1024*1024,freshclamElapsedMs:update.elapsedMs,buildScanVerified:false,includesUpdateTools:includeUpdateTools};
await writeFile(join(vendor,'manifest.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(report.requiresLargeFunctions&&process.env.VERCEL_SUPPORT_LARGE_FUNCTIONS!=='1')throw new Error('POC requires explicit Vercel Large Functions opt-in; standard bundle too large');
if(includeUpdateTools&&report.requiresLargeFunctions)throw new Error('Native antivirus assets exceed the standard function bundle budget');
return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.env.SIMSA_CLAMAV_NATIVE_POC_ENABLED==='1')await (await import('./native-build.mjs')).buildNativeProbe(buildClamavAssets);
 else await buildClamavAssets();
}
