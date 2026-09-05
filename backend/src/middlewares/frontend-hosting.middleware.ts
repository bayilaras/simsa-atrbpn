import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { buildCloudPlatformConfig } from '../config/cloud-platform.js';
import { loadAppMode } from '../config/demo.js';

const RESERVED_PATH = /^\/(?:api|health|ready|internal)(?:\/|$)/i;
const HASHED_ASSET_PATH = /^\/assets\//;
const SAFE_STATIC_EXTENSIONS = new Set([
    '.avif',
    '.css',
    '.gif',
    '.html',
    '.ico',
    '.jpeg',
    '.jpg',
    '.js',
    '.json',
    '.png',
    '.svg',
    '.txt',
    '.webmanifest',
    '.webp',
    '.woff',
    '.woff2',
    '.xml',
]);
const FORBIDDEN_STATIC_BASENAMES = /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|tsconfig(?:\.[^.]+)?\.json)$/i;

export interface FrontendHostingOptions {
    /** Override used by focused tests. Production normally reads the env var. */
    distDirectory?: string;
    /** Explicit environment keeps contract tests isolated from process state. */
    environment?: NodeJS.ProcessEnv;
}

interface FirebaseFrontendBuildManifest {
    schemaVersion: 1;
    mode: 'metadata-demo';
    syntheticDataOnly: true;
    api: 'same-origin';
    authProvider: 'firebase';
    storageProvider: 'disabled';
    firebase: {
        projectId: string;
        authDomain: string;
        appId: string;
    };
}

interface LocalFrontendBuildManifest {
    schemaVersion: 1;
    mode: 'metadata-demo';
    syntheticDataOnly: true;
    api: 'same-origin';
    authProvider: 'better-auth';
    storageProvider: 'disabled';
    firebase: null;
}

type FrontendBuildManifest = FirebaseFrontendBuildManifest | LocalFrontendBuildManifest;

function isInside(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function decodedRequestPath(requestPath: string): string | null {
    try {
        const decoded = decodeURIComponent(requestPath);
        if (
            !decoded.startsWith('/')
            || decoded.includes('//')
            || decoded.includes('\0')
            || decoded.includes('\\')
        ) return null;
        return decoded;
    } catch {
        return null;
    }
}

function containsHiddenSegment(requestPath: string): boolean {
    return requestPath.split('/').some(segment => segment.startsWith('.') && segment.length > 1);
}

function isReserved(requestPath: string): boolean {
    return RESERVED_PATH.test(requestPath);
}

function isSafeStaticRequest(requestPath: string): boolean {
    if (isReserved(requestPath) || containsHiddenSegment(requestPath)) return false;

    const basename = path.posix.basename(requestPath);
    if (FORBIDDEN_STATIC_BASENAMES.test(basename)) return false;

    return SAFE_STATIC_EXTENSIONS.has(path.posix.extname(requestPath).toLowerCase());
}

function candidatePath(directory: string, requestPath: string): string | null {
    const candidate = path.resolve(directory, `.${requestPath}`);
    return isInside(directory, candidate) ? candidate : null;
}

function isContainedRegularFile(directory: string, requestPath: string): boolean {
    const candidate = candidatePath(directory, requestPath);
    if (!candidate) return false;
    try {
        const canonical = realpathSync(candidate);
        return isInside(directory, canonical) && statSync(canonical).isFile();
    } catch {
        return false;
    }
}

function targetsExistingBuildEntry(directory: string, requestPath: string): boolean {
    const candidate = candidatePath(directory, requestPath);
    if (!candidate) return true;
    try {
        statSync(candidate);
        return true;
    } catch {
        return false;
    }
}

function isSpaNavigation(req: Request, requestPath: string): boolean {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (isReserved(requestPath) || containsHiddenSegment(requestPath)) return false;
    if (path.posix.extname(requestPath)) return false;

    return req.accepts('html') === 'html';
}

function resolveBuildDirectory(configuredDirectory: string): {
    directory: string;
    indexFile: string;
} {
    const requested = configuredDirectory.trim();
    if (!requested) {
        throw new Error('SIMSA_FRONTEND_DIST must not be empty when frontend hosting is enabled');
    }

    let directory: string;
    try {
        directory = realpathSync(path.resolve(requested));
    } catch {
        throw new Error('SIMSA_FRONTEND_DIST must reference an existing frontend build directory');
    }

    let directoryStat;
    try {
        directoryStat = statSync(directory);
    } catch {
        throw new Error('SIMSA_FRONTEND_DIST must reference an existing frontend build directory');
    }
    if (!directoryStat.isDirectory()) {
        throw new Error('SIMSA_FRONTEND_DIST must reference a directory');
    }

    const requestedIndexFile = path.join(directory, 'index.html');
    let indexFile: string;
    let indexStat;
    try {
        indexFile = realpathSync(requestedIndexFile);
        indexStat = statSync(indexFile);
    } catch {
        throw new Error('SIMSA_FRONTEND_DIST is missing the required index.html build artifact');
    }
    if (!indexStat.isFile() || !isInside(directory, indexFile)) {
        throw new Error('SIMSA_FRONTEND_DIST index.html must be a regular file inside the build directory');
    }

    // A Vite source tree also contains index.html. Refuse that common
    // misconfiguration so /src and other repository files cannot accidentally
    // become public merely because the operator selected the wrong directory.
    const indexMarkup = readFileSync(indexFile, 'utf8');
    if (/\b(?:src|href)=["']\/?src\//i.test(indexMarkup) || indexMarkup.includes('/@vite/client')) {
        throw new Error('SIMSA_FRONTEND_DIST must reference a production build, not the frontend source directory');
    }

    return { directory, indexFile };
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    const actual = Object.keys(value).sort();
    const required = [...expected].sort();
    return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function readDemoBuildManifest(
    directory: string,
    source: NodeJS.ProcessEnv,
): FrontendBuildManifest {
    const manifestPath = path.join(directory, 'simsa-build.json');
    let canonicalManifestPath: string;
    let manifestStat;
    try {
        canonicalManifestPath = realpathSync(manifestPath);
        manifestStat = statSync(canonicalManifestPath);
    } catch {
        throw new Error('Metadata demo frontend build is missing simsa-build.json');
    }
    if (
        !manifestStat.isFile()
        || manifestStat.size > 8 * 1024
        || !isInside(directory, canonicalManifestPath)
    ) {
        throw new Error('Metadata demo simsa-build.json must be a small regular file inside the build directory');
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(canonicalManifestPath, 'utf8'));
    } catch {
        throw new Error('Metadata demo simsa-build.json must contain valid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Metadata demo simsa-build.json has an invalid contract');
    }

    const manifest = parsed as Record<string, unknown>;
    if (!hasExactKeys(manifest, [
        'api',
        'authProvider',
        'firebase',
        'mode',
        'schemaVersion',
        'storageProvider',
        'syntheticDataOnly',
    ])) {
        throw new Error('Metadata demo simsa-build.json has unexpected or missing fields');
    }

    const cloud = buildCloudPlatformConfig(source);
    if (cloud.validationErrors.length > 0) {
        throw new Error('Backend cloud configuration is invalid for metadata demo frontend hosting');
    }
    const baseValid = manifest.schemaVersion === 1
        && manifest.mode === 'metadata-demo'
        && manifest.syntheticDataOnly === true
        && manifest.api === 'same-origin'
        && manifest.storageProvider === 'disabled'
        && cloud.storageProvider === 'disabled';
    if (!baseValid) {
        throw new Error('Metadata demo frontend build does not match the backend deployment authority');
    }

    if (manifest.authProvider === 'firebase') {
        const firebase = manifest.firebase;
        if (
            !firebase
            || typeof firebase !== 'object'
            || Array.isArray(firebase)
            || !hasExactKeys(firebase as Record<string, unknown>, ['appId', 'authDomain', 'projectId'])
        ) {
            throw new Error('Metadata demo simsa-build.json has an invalid Firebase authority');
        }
        const expectedAuthDomain = source.FIREBASE_AUTH_DOMAIN?.trim()
            || `${cloud.firebaseProjectId}.firebaseapp.com`;
        const firebaseManifest = firebase as Record<string, unknown>;
        const firebaseValid = cloud.authProvider === 'firebase'
            && firebaseManifest.projectId === cloud.firebaseProjectId
            && firebaseManifest.authDomain === expectedAuthDomain
            && typeof firebaseManifest.appId === 'string'
            && cloud.firebaseAppCheckAppIds.includes(firebaseManifest.appId);
        if (!firebaseValid) {
            throw new Error('Metadata demo frontend build does not match the backend deployment authority');
        }
    } else if (manifest.authProvider === 'better-auth') {
        const deployedRuntime = source.NODE_ENV === 'production'
            || Boolean(source.K_SERVICE)
            || Boolean(source.VERCEL);
        if (
            deployedRuntime
            || source.SIMSA_DEMO_LOCAL_AUTH !== 'true'
            || cloud.authProvider !== 'better-auth'
            || manifest.firebase !== null
        ) {
            throw new Error('Local Better Auth demo build is not authorized for this backend runtime');
        }
    } else {
        throw new Error('Metadata demo frontend build has an unsupported authentication provider');
    }

    return parsed as FrontendBuildManifest;
}

/**
 * Opt-in, same-origin hosting for the immutable Vite build.
 *
 * API/probe/internal namespaces always continue to the backend router. Only a
 * browser HTML navigation to an extensionless client route receives the SPA
 * shell; missing assets and JSON/API requests retain the backend 404 contract.
 */
export function installFrontendHosting(
    app: Express,
    options: FrontendHostingOptions = {},
): boolean {
    const source = options.environment ?? process.env;
    const configuredDirectory = options.distDirectory ?? source.SIMSA_FRONTEND_DIST;
    if (configuredDirectory === undefined) return false;

    const { directory, indexFile } = resolveBuildDirectory(configuredDirectory);
    if (loadAppMode(source) === 'metadata-demo') {
        readDemoBuildManifest(directory, source);
    }
    const staticHandler = express.static(directory, {
        dotfiles: 'deny',
        fallthrough: true,
        index: false,
        redirect: false,
        setHeaders: (res, filePath) => {
            const relativePath = `/${path.relative(directory, filePath).split(path.sep).join('/')}`;
            if (HASHED_ASSET_PATH.test(relativePath)) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                return;
            }
            res.setHeader('Cache-Control', 'no-store');
        },
    });

    app.use((req: Request, res: Response, next: NextFunction) => {
        const requestPath = decodedRequestPath(req.path);
        if (
            !requestPath
            || !isSafeStaticRequest(requestPath)
            || !isContainedRegularFile(directory, requestPath)
        ) return next();
        staticHandler(req, res, next);
    });

    app.use((req: Request, res: Response, next: NextFunction) => {
        const requestPath = decodedRequestPath(req.path);
        if (!requestPath || !isSpaNavigation(req, requestPath)) return next();
        // An existing directory (including a symlink/junction that escapes the
        // immutable build root) is not a client-side route. Never turn it into
        // a successful SPA response after static serving deliberately refused
        // it.
        if (requestPath !== '/' && targetsExistingBuildEntry(directory, requestPath)) return next();

        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(indexFile, error => {
            if (error) next(error);
        });
    });

    return true;
}
