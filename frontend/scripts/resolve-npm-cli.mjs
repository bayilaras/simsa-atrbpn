import { statSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export function resolveNpmCli({ environment = process.env, nodePath = process.execPath,
    platform = process.platform, filesystem = { statSync, realpathSync } } = {}) {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const cli = candidate => {
        if (typeof candidate !== 'string' || !paths.isAbsolute(candidate)) return undefined;
        try {
            const resolved = filesystem.realpathSync(candidate);
            if (paths.basename(resolved) === 'npm-cli.js' && filesystem.statSync(resolved).isFile()) return resolved;
        } catch { /* Try the next installed layout without exposing environment values. */ }
        return undefined;
    };
    if (environment.npm_execpath) {
        const explicit = cli(environment.npm_execpath);
        if (!explicit) throw new Error('npm_execpath must identify an existing npm JavaScript CLI.');
        return explicit;
    }
    const nodeDirectory = paths.dirname(nodePath);
    const pathValue = environment.PATH ?? environment.Path ?? '';
    const directories = [nodeDirectory, ...pathValue.split(paths.delimiter)]
        .map(value => value.trim().replace(/^"(.*)"$/, '$1')).filter(value => paths.isAbsolute(value));
    for (const directory of new Set(directories)) {
        // Windows portable installations put npm next to node.exe; Unix Node
        // prefixes use ../lib. Distribution installs commonly expose a symlink
        // on PATH. Resolve that link, never execute npm.cmd or a shell string.
        for (const candidate of [paths.join(directory, 'node_modules/npm/bin/npm-cli.js'),
            paths.join(directory, '../lib/node_modules/npm/bin/npm-cli.js'), paths.join(directory, 'npm')]) {
            const installed = cli(candidate);
            if (installed) return installed;
        }
    }
    throw new Error('npm CLI was not found. Install npm with Node.js 24 or set npm_execpath to its npm-cli.js.');
}
