#!/usr/bin/env node
// Frozen release source: `git archive` of one commit plus a manifest of every
// file. Vercel candidates have been deployed from such a snapshot since C47
// (formerly make-manifest.py outside the repository); the digest algorithm is
// unchanged, so earlier release-source.json files stay comparable.
//
//   prepare --commit <sha> --label <text> --output <new folder>
//   extract --dir <folder>   (archive hash -> source/ -> manifest check)
//   verify  --dir <folder>   (manifest check of an extracted source/)
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ARCHIVE = 'release-source.tar', MANIFEST = 'release-source.json', SOURCE = 'source';
const JOURNAL = ['backend', 'src', 'db', 'migrations', 'meta', '_journal.json'];
const sha256 = data => createHash('sha256').update(data).digest('hex');
const fail = message => { throw new Error(message); };

/** Every file below root, like os.walk: file symlinks are read, directory symlinks skipped. */
export function manifestEntries(root) {
  const entries = [];
  const walk = directory => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      const isFile = item.isFile() || (item.isSymbolicLink() && statSync(path).isFile());
      if (item.isDirectory()) walk(path);
      else if (isFile) {
        const data = readFileSync(path);
        entries.push({ file: relative(root, path).split(sep).join('/'), bytes: data.length, sha256: sha256(data) });
      }
    }
  };
  walk(root);
  // Python sorted() compares code points; UTF-8 byte order is identical.
  return entries.sort((a, b) => Buffer.compare(Buffer.from(a.file), Buffer.from(b.file)));
}

/** sha256 of json.dumps(entries, separators=(',', ':')) with Python's ensure_ascii escaping. */
export function manifestDigest(entries) {
  const text = JSON.stringify(entries).replace(/[\u007f-\uffff]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  return sha256(text);
}

export function migrationSummary(sourceRoot) {
  const path = join(sourceRoot, ...JOURNAL);
  if (!existsSync(path)) return null;
  const { entries } = JSON.parse(readFileSync(path, 'utf8'));
  return { count: entries.length, last: entries.at(-1)?.tag ?? null };
}

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) fail(`${command} ${args[0]} gagal: ${(result.stderr || result.error?.message || '').trim().slice(0, 300)}`);
  return result.stdout.trim();
};

// tar runs inside the folder with relative names: GNU tar reads "D:\..." as a remote host.
const extractArchive = directory => { mkdirSync(join(directory, SOURCE)); run('tar', ['-xf', ARCHIVE, '-C', SOURCE], directory); };

export function prepareRelease({ commit, label, output, repository = process.cwd() }) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) fail('--commit harus SHA penuh 40 karakter heksadesimal huruf kecil.');
  if (typeof label !== 'string' || !/^[\x20-\x7e]{1,120}$/.test(label)) fail('--label wajib, 1-120 karakter ASCII.');
  if (run('git', ['rev-parse', '--verify', `${commit}^{commit}`], repository) !== commit) fail('Commit tidak ditemukan di repository.');
  const directory = resolve(output);
  if (existsSync(directory)) fail('--output harus folder baru.');
  mkdirSync(directory, { recursive: true });
  // Pin line endings: with core.autocrlf=true (Windows) the archive would carry
  // CRLF and the manifest would differ from the same commit archived on Linux.
  run('git', ['-c', 'core.autocrlf=false', 'archive', '--format=tar', '-o', join(directory, ARCHIVE), commit], repository);
  extractArchive(directory);
  const entries = manifestEntries(join(directory, SOURCE));
  const archive = readFileSync(join(directory, ARCHIVE));
  const manifest = { commit, label, files: entries.length, manifestSha256: manifestDigest(entries),
    archive: { file: ARCHIVE, bytes: archive.length, sha256: sha256(archive) }, migrations: migrationSummary(join(directory, SOURCE)), entries };
  writeFileSync(join(directory, MANIFEST), JSON.stringify(manifest, null, 1) + '\n', { flag: 'wx' });
  return summary(manifest);
}

const summary = ({ entries, ...rest }) => rest;
const readManifest = directory => JSON.parse(readFileSync(join(directory, MANIFEST), 'utf8'));

export function verifyRelease({ dir }) {
  const directory = resolve(dir), manifest = readManifest(directory);
  const entries = manifestEntries(join(directory, SOURCE));
  if (manifestDigest(entries) !== manifest.manifestSha256 || entries.length !== manifest.files) {
    const recorded = new Map(manifest.entries.map(entry => [entry.file, entry.sha256]));
    const actual = new Map(entries.map(entry => [entry.file, entry.sha256]));
    const changed = [...new Set([...recorded.keys(), ...actual.keys()])].filter(file => recorded.get(file) !== actual.get(file)).sort();
    fail(`Sumber berbeda dari manifest (${changed.length} berkas): ${changed.slice(0, 10).join(', ')}`);
  }
  return summary(manifest);
}

export function extractRelease({ dir }) {
  const directory = resolve(dir), manifest = readManifest(directory);
  if (!manifest.archive || sha256(readFileSync(join(directory, ARCHIVE))) !== manifest.archive.sha256) fail('Hash arsip sumber tidak cocok dengan manifest.');
  if (existsSync(join(directory, SOURCE))) fail('source/ sudah ada; ekstrak hanya ke folder baru.');
  extractArchive(directory);
  return verifyRelease({ dir: directory });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { positionals: [action], values } = parseArgs({ allowPositionals: true,
      options: { commit: { type: 'string' }, label: { type: 'string' }, output: { type: 'string' }, dir: { type: 'string' } } });
    const operations = { prepare: prepareRelease, extract: extractRelease, verify: verifyRelease };
    if (!Object.hasOwn(operations, action ?? '')) fail('Gunakan: release-source.mjs prepare|extract|verify (lihat komentar di awal berkas).');
    console.log(JSON.stringify(operations[action](values)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
