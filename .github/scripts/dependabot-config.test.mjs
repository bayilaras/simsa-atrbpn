// Kontrak .github/dependabot.yml: setiap proyek npm yang diperiksa gerbang
// Security Audit (ci.yml) wajib punya pembaruan Dependabot, sehingga advisori
// baru tiba sebagai PR, bukan sebagai gerbang merah di PR fitur berikutnya.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');

/** Pecah dependabot.yml menjadi blok `updates` (subset YAML yang dipakai berkas ini). */
function parseUpdates(text) {
    const body = text.split(/^updates:\n/m)[1] ?? '';
    return body.split(/^ {2}- (?=package-ecosystem:)/m).slice(1).map((block) => {
        const scalar = (key) => block.match(new RegExp(`^\\s+${key}: ["']?([^"'\\n#]+?)["']?\\s*(?:#.*)?$`, 'm'))?.[1]
            ?? block.match(new RegExp(`^${key}: ["']?([^"'\\n#]+?)["']?\\s*$`, 'm'))?.[1];
        const groups = [...block.matchAll(/^ {6}([a-z][a-z0-9_-]*[a-z]):\n((?: {8}.*\n?)+)/gm)]
            .map(([, name, groupBody]) => ({
                name,
                appliesTo: groupBody.match(/applies-to: (\S+)/)?.[1] ?? 'version-updates',
                updateTypes: [...(groupBody.match(/update-types: \[([^\]]*)\]/)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]),
            }));
        return {
            ecosystem: scalar('package-ecosystem'),
            directory: scalar('directory'),
            interval: scalar('interval'),
            limit: Number(scalar('open-pull-requests-limit')),
            ignores: /^ {4}ignore:/m.test(block),
            groups,
        };
    });
}

const gatedProjects = () => [...new Set([...read('.github/workflows/ci.yml')
    .matchAll(/npm-audit-gate\.mjs ([a-z0-9-]+)/g)].map((m) => m[1]))].sort();

test('setiap proyek npm di gerbang audit dicakup Dependabot', () => {
    const updates = parseUpdates(read('.github/dependabot.yml'));
    const npmDirectories = updates.filter((u) => u.ecosystem === 'npm').map((u) => u.directory).sort();
    assert.deepEqual(gatedProjects(), ['backend', 'docs-site', 'frontend', 'spark']);
    assert.deepEqual(npmDirectories, gatedProjects().map((project) => `/${project}`));
});

test('backend, frontend, dan GitHub Actions diperiksa mingguan', () => {
    const updates = parseUpdates(read('.github/dependabot.yml'));
    for (const directory of ['/backend', '/frontend']) {
        assert.equal(updates.find((u) => u.ecosystem === 'npm' && u.directory === directory)?.interval, 'weekly', directory);
    }
    assert.equal(updates.find((u) => u.ecosystem === 'github-actions')?.directory, '/');
    assert.equal(updates.find((u) => u.ecosystem === 'github-actions')?.interval, 'weekly');
});

test('minor/patch dikelompokkan; pembaruan keamanan tetap PR tersendiri', () => {
    for (const update of parseUpdates(read('.github/dependabot.yml'))) {
        const label = `${update.ecosystem} ${update.directory}`;
        const grouped = update.groups.filter((g) => g.appliesTo === 'version-updates');
        assert.ok(grouped.some((g) => g.updateTypes.includes('minor') && g.updateTypes.includes('patch')), label);
        assert.ok(grouped.every((g) => !g.updateTypes.includes('major')), `${label}: major tidak digabung`);
        assert.ok(update.groups.every((g) => g.appliesTo !== 'security-updates'), `${label}: keamanan tidak digabung`);
        // `ignore` juga berlaku untuk pembaruan keamanan; jangan menahan perbaikan advisori.
        assert.equal(update.ignores, false, `${label}: tanpa ignore`);
        assert.ok(Number.isInteger(update.limit) && update.limit >= 1 && update.limit <= 5, `${label}: batas PR terbuka`);
    }
});
