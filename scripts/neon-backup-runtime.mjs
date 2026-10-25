import { spawn } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { createServer, createConnection } from 'node:net';
import { join, resolve, dirname } from 'node:path';
import { lstat, realpath, mkdir, mkdtemp, readFile, writeFile, appendFile, open } from 'node:fs/promises';
import { sterileEnvironment, requireCondition as check, assertWindowsPrivateAcl,
  LOCAL_POSTGRES_ISOLATION_CONFIG, nativePostgresOptions, CLUSTER_IDENTITY_SQL, assertClusterIdentity, awaitPostgresLauncherExit,
} from './local-backup-drill-core.mjs';

export const NEON_WINDOWS_ACL_PROBE_SCRIPT =
  "$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest; " +
  '$a=Get-Acl -LiteralPath $env:SIMSA_DRILL_ACL_TARGET; ' +
  '$r=@($a.Access | ForEach-Object { @{ sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; ' +
  'type=$_.AccessControlType.ToString(); inherited=$_.IsInherited; rights=$_.FileSystemRights.ToString(); ' +
  'inheritance=$_.InheritanceFlags.ToString(); propagation=$_.PropagationFlags.ToString() } }); ' +
  '@{ ownerSid=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; ' +
  'protected=$a.AreAccessRulesProtected; rules=$r } | ConvertTo-Json -Depth 4 -Compress';

export function assertNeonWindowsPrivateAcl(proof,sid,kind='directory') {
  check(kind==='directory'||kind==='file','Unsupported private path kind');
  // An owner can rewrite the DACL even without an explicit access entry.
  check(/^S-1-5-[0-9-]+$/.test(sid)&&proof?.ownerSid===sid,'Private Windows path owner differs from the operator');
  if(kind==='directory') assertWindowsPrivateAcl(proof,sid);
  else check(Array.isArray(proof?.rules)&&proof.rules.length===1&&proof.rules[0].sid===sid&&proof.rules[0].type==='Allow'&&proof.rules[0].rights==='FullControl','Private file ACL is unsafe');
}

const same = (a,b) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
export async function physical(file, kind = 'file') {
  const stat = await lstat(file);
  check(!stat.isSymbolicLink() && same(await realpath(file),file) && (kind === 'file' ? stat.isFile() : stat.isDirectory()), 'Path must be a physical file/directory');
  return stat;
}
export async function boundedFile(file, maximum) {
  const stat = await physical(file);
  check(stat.size > 0 && stat.size <= maximum, 'File exceeds the supported size or is empty');
  const bytes = await readFile(file); check(bytes.length <= maximum, 'File changed beyond its size limit'); return bytes;
}
/** Shell-free, bounded child execution. Stderr/exception detail is never echoed. */
export async function runBackupCommand(executable,args,{ cwd, env, input, signal, timeoutMs = 120000, maximum = 4*1024*1024, metadata = false } = {}) {
  signal?.throwIfAborted();
  const child = spawn(executable,args,{ cwd, env, shell:false, windowsHide:true, stdio:['pipe','pipe','pipe'] });
  let failure, size=0; const chunks=[];
  const stop = reason => { failure ||= new Error(reason); child.kill('SIGKILL'); };
  const abort = () => stop('Backup command aborted');
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted) abort();
  const timer = setTimeout(() => stop('Backup command deadline exceeded'),timeoutMs);
  child.stdout.on('data',bytes => { size+=bytes.length; if(size>maximum) stop('Backup command output exceeds limit'); else chunks.push(bytes); });
  child.stderr.on('data',bytes => { size+=bytes.length; if(size>maximum) stop('Backup command output exceeds limit'); });
  child.on('error',() => { failure ||= new Error('Backup command could not start'); });
  child.stdin.on('error',error => { if(!(metadata && ['EPIPE','EOF'].includes(error.code))) stop('Backup command input failed'); });
  const code = await new Promise(done => { child.once('close',done); child.stdin.end(input); });
  clearTimeout(timer); signal?.removeEventListener('abort',abort);
  if(failure || code!==0) { chunks.forEach(b=>b.fill(0)); throw failure || new Error('Backup command failed'); }
  const result=Buffer.concat(chunks);chunks.forEach(b=>b.fill(0));return result;
}
export async function makeBackupWorkspace(pgBin,parent,prefix='neon-backup-') {
  check(process.versions.node.split('.')[0] === '24', 'Requires Node 24');
  await physical(pgBin,'directory');
  await mkdir(parent,{recursive:true,mode:0o700}); await physical(parent,'directory');
  const directory = await mkdtemp(join(parent,prefix));
  const environment = sterileEnvironment(process.env,{privateDir:directory,pgBin,nodePath:process.execPath});
  const binary = name => join(pgBin,name+(process.platform==='win32'?'.exe':''));
  const command = (name,args,options={}) => runBackupCommand(binary(name),args,{cwd:directory,env:environment,...options});
  let sid;
  async function verifyPrivate(target,kind='directory') {
    await physical(target,kind);
    if(process.platform==='win32') {
      const proof = await runBackupCommand(join(environment.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',NEON_WINDOWS_ACL_PROBE_SCRIPT],
        {cwd:directory,env:{...environment,SIMSA_DRILL_ACL_TARGET:target}});
      const acl=JSON.parse(proof);
      assertNeonWindowsPrivateAcl(acl,sid,kind);
    } else { const s=await lstat(target); check(s.uid === process.getuid() && (s.mode&0o077)===0,'Private directory permissions are unsafe'); }
  }
  async function secure(target) {
    await physical(target,'directory');
    if(process.platform==='win32') await runBackupCommand(join(environment.SystemRoot,'System32/icacls.exe'),[target,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{cwd:directory,env:environment});
    await verifyPrivate(target);
  }
  if(process.platform==='win32') {
    const result = await runBackupCommand(join(environment.SystemRoot,'System32/whoami.exe'),['/user','/fo','csv','/nh'],{cwd:directory,env:environment});
    const matches=result.toString().match(/S-1-5-[0-9-]+/g); check(matches?.length===1,'Cannot establish Windows account'); sid=matches[0];
  }
  await secure(directory);
  for(const name of ['pg_dump','pg_restore','psql','initdb','pg_ctl','pg_controldata']) {
    await physical(binary(name)); check(/\(PostgreSQL\) 18\./.test((await command(name,['--version'])).toString()),'All PostgreSQL tools must use major 18');
  }
  return {directory,environment,binary,command,secure,verifyPrivate};
}

export async function createDisposableBackupTarget(workspace) {
  const {directory,environment,binary,command}=workspace;
  const target={ dataDir:join(directory,'restore-data'),admin:'simsa_restore_admin',password:randomBytes(32).toString('hex') };
  async function unused(port) { await new Promise((yes,no)=>{const s=createServer();s.once('error',no);s.listen({host:'127.0.0.1',port,exclusive:true},()=>s.close(yes));}); }
  for(let i=0;i<40;i++) {const port=randomInt(40000,60000);if(port===55432)continue;try{await unused(port);target.port=port;break;}catch(error){if(error.code!=='EADDRINUSE')throw error;}}
  check(target.port,'No unused disposable port');
  check(!(await lstat(target.dataDir).catch(()=>null)),'Disposable directory already exists');
  const pwFile=join(directory,'init-password.txt');await writeFile(pwFile,target.password+'\n',{flag:'wx',mode:0o600});
  await command('initdb',['--pgdata',target.dataDir,'--username',target.admin,'--pwfile',pwFile,'--encoding=UTF8','--no-locale','--auth-host=scram-sha-256','--auth-local=scram-sha-256']);
  const disk=async()=>{
    check(dirname(target.dataDir)===directory && target.port!==55432,'Disposable target location differs');await physical(target.dataDir,'directory');
    const text=(await command('pg_controldata',[target.dataDir])).toString();
    const id=/^Database system identifier:\s+([0-9]{10,30})\s*$/m.exec(text)?.[1];
    check(id && (!target.systemIdentifier || id===target.systemIdentifier),'Disposable target identity changed');return id;
  };
  target.systemIdentifier=await disk();
  const env=(database='postgres',user=target.admin,password=target.password)=>({...environment,PGHOST:'127.0.0.1',PGPORT:String(target.port),PGDATABASE:database,PGUSER:user,PGPASSWORD:password});
  const query=async(sql,database='postgres')=>(await command('psql',['--no-psqlrc','--no-password','-qAt','-v','ON_ERROR_STOP=on'],{env:env(database),input:sql})).toString();
  const guard=async()=>{await disk();assertClusterIdentity(JSON.parse((await query(CLUSTER_IDENTITY_SQL)).trim()),target);};
  const stop=async()=>{
    await disk();const pid=await readFile(join(target.dataDir,'postmaster.pid'),'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
    if(pid!==null){const p=pid.replaceAll('\r\n','\n').split('\n');check(/^[1-9][0-9]*$/.test(p[0])&&same(p[1],target.dataDir)&&Number(p[3])===target.port,'Refusing to stop an unidentified process');await guard();await command('pg_ctl',['--pgdata',target.dataDir,'-m','fast','-w','-t','30','stop']);}
    check(!(await lstat(join(target.dataDir,'postmaster.pid')).catch(()=>null)),'Disposable PostgreSQL still has a PID file');
    await new Promise((yes,no)=>{const socket=createConnection({host:'127.0.0.1',port:target.port});socket.once('connect',()=>{socket.destroy();no(new Error('Disposable port remains open'));});socket.once('error',error=>error.code==='ECONNREFUSED'?yes():no(new Error('Cannot prove disposable shutdown')));socket.setTimeout(3000,()=>{socket.destroy();no(new Error('Disposable shutdown check timed out'));});});
  };
  await appendFile(join(target.dataDir,'postgresql.conf'),LOCAL_POSTGRES_ISOLATION_CONFIG);
  await unused(target.port);
  const log=await open(join(directory,'launcher.log'),'wx');
  try {
    const child=spawn(binary('pg_ctl'),['--pgdata',target.dataDir,'--log',join(directory,'postgres.log'),'-o',nativePostgresOptions(target.port),'-w','-t','30','start'],
      {cwd:directory,env:environment,shell:false,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
    await awaitPostgresLauncherExit(child);await guard();
  } catch(error) { await stop();throw error; } finally {await log.close();}
  return {target,env,query,guard,stop};
}
