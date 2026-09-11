import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { resolveNpmCli } from '../frontend/scripts/resolve-npm-cli.mjs';

function filesystem(files, links = {}) {
    return { statSync(file) { if (!files.includes(links[file] || file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { isFile: () => true }; },
        realpathSync(file) { if (!files.includes(links[file] || file)) throw new Error('missing'); return links[file] || file; } };
}
test('raw Linux node build resolves npm in the Node prefix lib directory', () => {
    const npm = '/node24/lib/node_modules/npm/bin/npm-cli.js';
    assert.equal(resolveNpmCli({ environment: {}, nodePath: '/node24/bin/node', platform: 'linux', filesystem: filesystem([npm]) }), npm);
});
test('Linux PATH npm symlink resolves to its JavaScript CLI instead of executing a shell wrapper', () => {
    const npm = '/usr/share/nodejs/npm/bin/npm-cli.js';
    assert.equal(resolveNpmCli({ environment: { PATH: '/usr/local/bin:/usr/bin' }, nodePath: '/opt/node/bin/node', platform: 'linux',
        filesystem: filesystem([npm], { '/usr/bin/npm': npm }) }), npm);
});
test('portable Windows Node keeps its adjacent npm CLI and paths containing spaces', () => {
    const npm = 'C:\\Portable Node\\node_modules\\npm\\bin\\npm-cli.js';
    assert.equal(resolveNpmCli({ environment: {}, nodePath: 'C:\\Portable Node\\node.exe', platform: 'win32', filesystem: filesystem([npm]) }), npm);
});
test('explicit npm_execpath is verified and missing npm fails with an actionable fixed error', () => {
    const npm = '/custom/npm/bin/npm-cli.js';
    assert.equal(resolveNpmCli({ environment: { npm_execpath: npm }, nodePath: '/node24/bin/node', platform: 'linux', filesystem: filesystem([npm]) }), npm);
    assert.throws(() => resolveNpmCli({ environment: { npm_execpath: '/missing/npm-cli.js' }, nodePath: '/node24/bin/node', platform: 'linux', filesystem: filesystem([]) }), /npm_execpath/);
    assert.throws(() => resolveNpmCli({ environment: {}, nodePath: '/node24/bin/node', platform: 'linux', filesystem: filesystem([]) }), /npm CLI/);
});

test('Windows PATH npm.cmd layout resolves its sibling CLI without launching cmd.exe', () => {
    const npm = 'C:\\User Tools\\npm\\node_modules\\npm\\bin\\npm-cli.js';
    assert.equal(resolveNpmCli({ environment: { Path: 'C:\\User Tools\\npm' }, nodePath: 'C:\\NodeOnly\\node.exe', platform: 'win32',
        filesystem: filesystem([npm]) }), npm);
});

const repository = new URL('../', import.meta.url);
const fixtureScript = `const fs=require('node:fs'); const path=require('node:path'); const assert=require('node:assert/strict');
const phase=process.argv[2]; assert.equal(process.versions.node.split('.')[0],'24');
fs.appendFileSync('lifecycle.log',phase+'\\n');
if(phase==='prebuild'&&process.env.FAIL_PREBUILD==='true') process.exit(19);
if(phase==='build') {
  assert.equal(fs.readFileSync('lifecycle.log','utf8'),'prebuild\\nbuild\\n');
  for(const [key,value] of Object.entries({VITE_APP_MODE:'full',VITE_APP_PROFILE:'internal',VITE_AUTH_PROVIDER:'better-auth',VITE_API_URL:'',VITE_FEATURE_SRIKANDI:'false'})) assert.equal(process.env[key],value);
  assert.equal(process.env.VITE_STORAGE_PROVIDER,process.env.EXPECTED_STORAGE);
  const args=process.argv.slice(3); const out=args.length?args[1]:'dist';
  if(args.length) assert.ok(['--outDir','--out-dir'].includes(args[0]));
  fs.mkdirSync(out,{recursive:true}); fs.writeFileSync(path.join(out,'app.js'),'// fixture');
  fs.writeFileSync(path.join(out,'simsa-build.json'),JSON.stringify({schemaVersion:1,mode:'full',syntheticDataOnly:false,api:'same-origin',authProvider:'better-auth',storageProvider:process.env.VITE_STORAGE_PROVIDER,firebase:null}));
}`;
function withFixture(action) {
    const directory = mkdtempSync(path.join(tmpdir(), 'simsa-vercel-build-'));
    try {
        for (const file of ['backend/scripts/build-vercel.mjs', 'frontend/scripts/build-vercel-metadata.mjs',
            'frontend/scripts/resolve-npm-cli.mjs', 'scripts/build-cloud-metadata.mjs', 'scripts/build-internal.mjs']) {
            const target = path.join(directory, file); mkdirSync(path.dirname(target), { recursive: true });
            copyFileSync(new URL(file, repository), target);
        }
        writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
        writeFileSync(path.join(directory, 'empty.npmrc'), '');
        for (const project of ['frontend', 'backend']) {
            writeFileSync(path.join(directory, project, 'package.json'), JSON.stringify({ name: `fixture-${project}`, version: '1.0.0', type: 'module', scripts: {
                prebuild: 'node fixture.cjs prebuild', build: 'node fixture.cjs build', postbuild: 'node fixture.cjs postbuild',
            } }));
            writeFileSync(path.join(directory, project, 'fixture.cjs'), fixtureScript);
        }
        // The bundler is unrelated to npm discovery; keep this proof small while
        // running the exact wrappers and real npm lifecycle, including failure.
        const bundler = path.join(directory, 'backend/node_modules/esbuild'); mkdirSync(bundler, { recursive: true });
        writeFileSync(path.join(bundler, 'package.json'), '{"type":"module","exports":"./index.js"}');
        writeFileSync(path.join(bundler, 'index.js'), `import{writeFileSync,readFileSync,mkdirSync}from'node:fs';import{dirname,join,basename}from'node:path';import assert from'node:assert/strict';export async function build(options){const root=options.outdir?join(options.outdir,'../..'):join(dirname(options.outfile),'..');assert.equal(readFileSync(join(root,'lifecycle.log'),'utf8'),'prebuild\\nbuild\\npostbuild\\n');const outputs=options.outfile?[options.outfile]:options.entryPoints.map(entry=>join(options.outdir,basename(entry).replace(/\\.ts$/,'.js')));for(const file of outputs){mkdirSync(dirname(file),{recursive:true});writeFileSync(file,'// fixture bundled after npm lifecycle');}}`);
        const environment = { PATH: [path.dirname(process.execPath), process.env.PATH ?? process.env.Path ?? ''].join(path.delimiter),
            HOME: directory, USERPROFILE: directory, APPDATA: directory, LOCALAPPDATA: directory,
            TEMP: directory, TMP: directory, NPM_CONFIG_USERCONFIG: path.join(directory, 'empty.npmrc'),
            NPM_CONFIG_OFFLINE: 'true', NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false',
            SIMSA_VERCEL_METADATA_ENABLED: 'true', EXPECTED_STORAGE: 'disabled',
            VITE_APP_MODE: 'full', VITE_APP_PROFILE: 'internal', VITE_AUTH_PROVIDER: 'better-auth',
            VITE_STORAGE_PROVIDER: 'disabled', VITE_API_URL: '', VITE_FEATURE_SRIKANDI: 'false' };
        for (const key of ['SystemRoot', 'WINDIR', 'ComSpec']) if (process.env[key]) environment[key] = process.env[key];
        assert.equal(environment.npm_execpath, undefined);
        action({ directory, environment, run(file, args = []) {
            return execFileSync(process.execPath, [path.join(directory, file), ...args], {
                cwd: directory, env: environment, encoding: 'utf8', timeout: 120000, windowsHide: true,
            });
        } });
    } finally {
        // Only remove this newly created, resolved temporary fixture.
        assert.equal(path.dirname(realpathSync(directory)), realpathSync(tmpdir()));
        assert.ok(path.basename(directory).startsWith('simsa-vercel-build-'));
        rmSync(directory, { recursive: true, force: true });
    }
}
for (const [wrapper, args, projects, output] of [
    ['frontend/scripts/build-vercel-metadata.mjs', [], ['frontend'], 'dist-vercel-metadata'],
    ['backend/scripts/build-vercel.mjs', [], ['backend'], 'dist-vercel'],
    ['scripts/build-cloud-metadata.mjs', ['--skip-install'], ['frontend', 'backend'], 'dist-cloud-metadata'],
    ['scripts/build-internal.mjs', [], ['frontend', 'backend'], 'dist'],
]) test(`raw-node ${wrapper} runs real npm prebuild/build/postbuild without npm_execpath`, () => withFixture(({ directory, environment, run }) => {
    if (wrapper.endsWith('build-internal.mjs')) environment.EXPECTED_STORAGE = 'vercel-blob';
    run(wrapper, args);
    for (const project of projects) {
        assert.equal(readFileSync(path.join(directory, project, 'lifecycle.log'), 'utf8'), 'prebuild\nbuild\npostbuild\n');
        assert.equal(existsSync(path.join(directory, project, output, 'app.js')), true);
    }
    if (wrapper.startsWith('backend/')) {
        for (const artifact of ['vercel-runtime.js', 'internal-malware-scan-runtime.js',
            'workers/malware-scan-on-demand.js', 'workers/native-clamav-process.js']) {
            assert.equal(existsSync(path.join(directory, 'backend/dist-vercel', artifact)), true);
        }
        assert.equal(existsSync(path.join(directory, 'backend/native-clamav-assets')), false,
            'default build must not provision native assets');
    }
}));
test('a failing npm prebuild aborts the wrapper before build or manifest verification', () => withFixture(({ directory, environment, run }) => {
    environment.FAIL_PREBUILD = 'true';
    assert.throws(() => run('frontend/scripts/build-vercel-metadata.mjs'));
    assert.equal(readFileSync(path.join(directory, 'frontend/lifecycle.log'), 'utf8'), 'prebuild\n');
    assert.equal(existsSync(path.join(directory, 'frontend/dist-vercel-metadata')), false);
}));
test('the metadata wrapper still requires opt-in before invoking npm', () => withFixture(({ directory, environment, run }) => {
    delete environment.SIMSA_VERCEL_METADATA_ENABLED;
    assert.throws(() => run('frontend/scripts/build-vercel-metadata.mjs'));
    assert.equal(existsSync(path.join(directory, 'frontend/lifecycle.log')), false);
}));
