import { spawn } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

export const VERSION='1.5.4';
export const SIGNER='5BADCA2665EF59DCF8A23D8B707F0DB480836771';
export const MAX_LIFETIME_MS=240000;
// Official1.5.4 Freshclam names detached signatures dbname-VERSION.cvd.sign.
// This is structural inspection only; sigtool with --fips-limits must still
// authenticate the CVD before the build records a successful verification.
export async function readCvdArtifact(directory,name){
  if(!['main','daily','bytecode'].includes(name))throw new Error('Unexpected CVD database name');
  const file=join(directory,`${name}.cvd`),info=await lstat(file);
  if(!info.isFile()||info.size<512||info.size>120*1024*1024)throw new Error('CVD must be a bounded regular file');
  const bytes=await readFile(file),fields=bytes.subarray(0,512).toString('ascii').trim().split(':');
  const version=Number(fields[2]);
  if(fields[0]!=='ClamAV-VDB'||fields.length<9||!/^\d+$/.test(fields[2]??'')||!Number.isSafeInteger(version)||version<=0)throw new Error('Invalid CVD header version');
  const signatureFile=`${name}-${version}.cvd.sign`,signaturePath=join(directory,signatureFile),signatureInfo=await lstat(signaturePath);
  if(!signatureInfo.isFile()||signatureInfo.size<=0||signatureInfo.size>65536)throw new Error('CVD signature must be a bounded nonempty regular file');
  const signature=await readFile(signaturePath);
  return {name,version,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),signatureFile,signatureBytes:signature.length,signatureSha256:createHash('sha256').update(signature).digest('hex')};
}
export function assertCvdVerification(result,version){
  if(result.code!==0||result.signal||result.timedOut||result.outputExceeded||result.memoryExceeded||/ERROR|Unsigned container/i.test(result.stdout+'\n'+result.stderr)||!new RegExp(`^Version:\\s+${version}\\s*$`,'m').test(result.stdout)||!/^Verification OK\.\s*$/m.test(result.stdout))throw new Error('Authenticated CVD verification failed');
}
export function assertPinnedSignature(status){
  const valid=status.split('\n').some(line=>{const words=line.trim().split(/\s+/);return words[0]==='[GNUPG:]'&&words[1]==='VALIDSIG'&&(words[2]===SIGNER||words.at(-1)===SIGNER);});
  if(!valid||/\[GNUPG:\] (?:BADSIG|ERRSIG|EXPSIG|EXPKEYSIG|REVKEYSIG)/.test(status))throw new Error('Release signature verification failed');
}
export function parseDebData(bytes){
  if(bytes.subarray(0,8).toString()!=='!<arch>\n')throw new Error('Invalid Debian archive');
  for(let pos=8;pos<bytes.length;){
    if(pos+60>bytes.length||bytes.subarray(pos+58,pos+60).toString()!=='`\n')throw new Error('Invalid Debian member');
    const name=bytes.subarray(pos,pos+16).toString().trim().replace(/\/$/,'');
    const size=Number(bytes.subarray(pos+48,pos+58).toString().trim());
    if(!Number.isSafeInteger(size)||size<0||pos+60+size>bytes.length)throw new Error('Invalid Debian member length');
    if(/^data\.tar\.(?:xz|gz|zst)$/.test(name))return {name,bytes:bytes.subarray(pos+60,pos+60+size)};
    pos+=60+size+(size%2);
  }
  throw new Error('Debian data member missing');
}
export function assertFreshManifest(manifest,now=Date.now()){
  const timestamp=Date.parse(manifest.verifiedAt);
  if(manifest.version!==VERSION||!Number.isFinite(timestamp)||timestamp>now+60000||now-timestamp>86400000)throw new Error('POC definitions require a fresh verified build (24h)');
}
export function assessScan(result,expected){
  if(result.signal||result.timedOut||result.memoryExceeded||result.outputExceeded||/ERROR|WARNING|skipp|limit.*exceed/i.test(result.stderr+'\n'+result.stdout)||!/^Scanned files:\s+1\s*$/m.test(result.stdout))return false;
  if(expected==='clean')return result.code===0&&/^Infected files:\s+0\s*$/m.test(result.stdout)&&/: OK\s*$/m.test(result.stdout);
  return expected==='eicar'&&result.code===1&&/^Infected files:\s+1\s*$/m.test(result.stdout)&&/EICAR[^\n]* FOUND/i.test(result.stdout);
}
export function makePdf(size){
  const render=(padding)=>{
    const stream=`q\n${' '.repeat(padding)}\nQ`;
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
    let out='%PDF-1.4\n';const offsets=[0];
    for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
    const xref=Buffer.byteLength(out);out+='xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
    out+=`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(out);
  };
  let padding=Math.max(0,size-render(0).length);
  for(let i=0;i<5;i++){const result=render(padding);if(result.length===size)return result;padding+=size-result.length;}
  throw new Error('Synthetic PDF size mismatch');
}
export function childEnvironment(root){
  return {PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C',LC_ALL:'C',HOME:'/tmp',LD_LIBRARY_PATH:`${root}/lib:${root}/lib64`,CVD_CERTS_DIR:`${root}/etc/certs`};
}
export async function runMeasured(command,args,{env,deadline=Date.now()+60000,maxRssBytes=1800*1024*1024,cwd}={}){
  if(deadline<=Date.now())throw new Error('POC deadline exhausted');
  const started=performance.now();let stdout='',stderr='',timedOut=false,memoryExceeded=false,peakChildRssBytes=0,peakCombinedRssBytes=0,outputExceeded=false;
  const child=spawn(command,args,{env,cwd,stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true});
  const kill=()=>{if(child.pid)child.kill('SIGKILL');};
  const timer=setTimeout(()=>{timedOut=true;kill();},deadline-Date.now());
  const sample=async()=>{if(!child.pid)return;try{const text=await readFile(`/proc/${child.pid}/status`,'utf8');const rss=Number(text.match(/^VmRSS:\s+(\d+)/m)?.[1]??0)*1024;const hwm=Number(text.match(/^VmHWM:\s+(\d+)/m)?.[1]??0)*1024;peakChildRssBytes=Math.max(peakChildRssBytes,rss,hwm);peakCombinedRssBytes=Math.max(peakCombinedRssBytes,rss+process.memoryUsage().rss);if(peakCombinedRssBytes>maxRssBytes){memoryExceeded=true;kill();}}catch{/* Process exited before sampling. */}};
  const poll=setInterval(()=>void sample(),25);
  const collect=(field,data)=>{const value=(field==='stdout'?stdout:stderr)+data.toString();if(Buffer.byteLength(value)>65536){outputExceeded=true;kill();}else if(field==='stdout')stdout=value;else stderr=value;};
  child.stdout.on('data',data=>collect('stdout',data));child.stderr.on('data',data=>collect('stderr',data));
  try{return await new Promise((resolve,reject)=>{child.once('error',()=>reject(new Error('POC subprocess failed to start')));child.once('close',(code,signal)=>resolve({code,signal,timedOut,memoryExceeded,stdout,stderr,outputExceeded,elapsedMs:Math.round(performance.now()-started),peakChildRssBytes,peakCombinedRssBytes}));});}
  finally{clearTimeout(timer);clearInterval(poll);}
}
