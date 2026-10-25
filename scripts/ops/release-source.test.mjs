import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractRelease, manifestDigest, manifestEntries, prepareRelease, verifyRelease } from './release-source.mjs';

test('digest equals make-manifest.py (json.dumps compact, ensure_ascii) for the same entries', () => {
  // Reference value computed with CPython 3.12 json.dumps(entries, separators=(',', ':')).
  const entries = [{ file: 'a.txt', bytes: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
    { file: 'docs/café-\u{1F600}\u007f.md', bytes: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }];
  assert.equal(manifestDigest(entries), '442dff6842102c050ca4a060ee287de4fb822f20e35ad3feaddd5d5a704938bf');
});

test('entries list every nested file with forward slashes in code point order', () => {
  const root = mkdtempSync(join(tmpdir(), 'simsa-manifest-'));
  try {
    mkdirSync(join(root, 'b', 'c'), { recursive: true });
    writeFileSync(join(root, 'b', 'c', 'z.txt'), 'abc'); writeFileSync(join(root, 'B.txt'), ''); writeFileSync(join(root, 'a.txt'), 'abc');
    assert.deepEqual(manifestEntries(root).map(entry => [entry.file, entry.bytes]), [['B.txt', 0], ['a.txt', 3], ['b/c/z.txt', 3]]);
    assert.equal(manifestEntries(root)[1].sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prepare archives one commit with pinned LF line endings; extract and verify detect any change', () => {
  const root = mkdtempSync(join(tmpdir(), 'simsa-release-source-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: join(root, 'repo'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  try {
    mkdirSync(join(root, 'repo', 'backend', 'src', 'db', 'migrations', 'meta'), { recursive: true });
    git('init', '-q'); git('config', 'user.email', 'ops@synthetic.invalid'); git('config', 'user.name', 'ops'); git('config', 'core.autocrlf', 'true');
    writeFileSync(join(root, 'repo', 'notes.txt'), 'line one\nline two\n');
    writeFileSync(join(root, 'repo', 'backend', 'src', 'db', 'migrations', 'meta', '_journal.json'),
      JSON.stringify({ entries: [{ idx: 0, tag: '0000_awal' }, { idx: 1, tag: '0001_lanjut' }] }));
    git('add', '.'); git('commit', '-q', '-m', 'fixture');
    const commit = git('rev-parse', 'HEAD');
    const output = join(root, 'release');
    const result = prepareRelease({ commit, label: 'Uji sintetis', output, repository: join(root, 'repo') });
    assert.equal(result.commit, commit); assert.equal(result.files, 2);
    assert.deepEqual(result.migrations, { count: 2, last: '0001_lanjut' });
    assert.equal(readFileSync(join(output, 'source', 'notes.txt'), 'utf8'), 'line one\nline two\n');
    assert.deepEqual(verifyRelease({ dir: output }), result);
    assert.throws(() => prepareRelease({ commit, label: 'Uji', output, repository: join(root, 'repo') }), /folder baru/);
    for (const [changes, message] of [[{ commit: commit.slice(0, 7) }, /SHA penuh/], [{ commit: 'f'.repeat(40) }, /git rev-parse gagal|tidak ditemukan/],
      [{ label: '' }, /label/]]) {
      assert.throws(() => prepareRelease({ commit, label: 'Uji', output: join(root, 'other'), repository: join(root, 'repo'), ...changes }), message);
    }

    // A later job receives only the archive and manifest.
    const copy = join(root, 'artifact');
    mkdirSync(copy);
    for (const file of ['release-source.tar', 'release-source.json']) cpSync(join(output, file), join(copy, file));
    assert.equal(extractRelease({ dir: copy }).manifestSha256, result.manifestSha256);
    assert.throws(() => extractRelease({ dir: copy }), /folder baru/);
    writeFileSync(join(copy, 'source', 'notes.txt'), 'changed\n');
    writeFileSync(join(copy, 'source', 'extra.txt'), 'x');
    assert.throws(() => verifyRelease({ dir: copy }), /2 berkas\): extra\.txt, notes\.txt/);
    const tampered = join(root, 'tampered');
    mkdirSync(tampered);
    cpSync(join(output, 'release-source.json'), join(tampered, 'release-source.json'));
    writeFileSync(join(tampered, 'release-source.tar'), readFileSync(join(output, 'release-source.tar')).subarray(1));
    assert.throws(() => extractRelease({ dir: tampered }), /Hash arsip/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
