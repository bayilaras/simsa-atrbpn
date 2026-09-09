import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, lstat, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { join, isAbsolute, resolve } from "node:path";
import { tmpdir } from "node:os";
import { WINDOWS_ACL_PROBE_SCRIPT, assertWindowsPrivateAcl } from "../../scripts/local-backup-drill-core.mjs";

const run = promisify(execFile);

export function windowsSystemEnvironment(systemRoot) {
  if (!systemRoot || !isAbsolute(systemRoot)) throw new Error("Windows system directory unavailable");
  const system = join(systemRoot, "System32");
  // Windows PowerShell 5 must not inherit PowerShell 7/user module search paths,
  // profiles, proxy/credential variables or script-injection configuration.
  return { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: system,
    PSModulePath: join(system, "WindowsPowerShell/v1.0/Modules") };
}

// No data or key is written until the newly generated directory is private.
// Retain artifacts for diagnosis/recovery; no recursive deletion exists here.
export async function createPrivateRunDirectory() {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "simsa-spark-drill-"));
  if (process.platform !== "win32") {
    await chmod(directory, 0o700);
    if (((await lstat(directory)).mode & 0o077) !== 0) throw new Error("Private directory mode verification failed");
    return directory;
  }
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
  if (!systemRoot || !isAbsolute(systemRoot)) throw new Error("Windows system directory unavailable");
  const system = join(systemRoot, "System32");
  const systemEnvironment = windowsSystemEnvironment(systemRoot);
  const options = { windowsHide: true, timeout: 20000, maxBuffer: 65536, env: systemEnvironment };
  const { stdout } = await run(join(system, "whoami.exe"), ["/user", "/fo", "csv", "/nh"], options);
  const sids = stdout.match(/S-1-5-[0-9-]+/g);
  if (sids?.length !== 1) throw new Error("Cannot identify Windows user SID");
  await run(join(system, "icacls.exe"), [directory, "/inheritance:r", "/grant:r", `*${sids[0]}:(OI)(CI)F`], options);
  const probe = await run(join(system, "WindowsPowerShell/v1.0/powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_ACL_PROBE_SCRIPT],
    { ...options, env: { ...systemEnvironment, SIMSA_DRILL_ACL_TARGET: directory } });
  assertWindowsPrivateAcl(JSON.parse(probe.stdout.trim()), sids[0]);
  return directory;
}

export async function readRegularFile(filename, maximum) {
  if (typeof filename !== "string" || !isAbsolute(filename) || filename.startsWith("\\\\") || filename.startsWith("//"))
    throw new Error("Only absolute local regular file paths are allowed");
  const metadata = await lstat(filename);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximum || await realpath(filename) !== resolve(filename))
    throw new Error("Invalid, linked, or oversized input file");
  const bytes = await readFile(filename);
  if (bytes.length > maximum) throw new Error("Input grew beyond its size limit");
  return bytes;
}

export async function writeNewFile(filename, bytes) {
  await writeFile(filename, bytes, { flag: "wx", mode: 0o600 });
}
