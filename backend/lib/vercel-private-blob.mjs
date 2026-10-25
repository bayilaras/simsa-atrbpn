const aliases = ['SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN', 'SIMSA_PRIVATE_BLOB_STORE_ID',
    'SIMSA_PRIVATE_BLOB_WEBHOOK_PUBLIC_KEY'];

/** Never let a Preview consume a Production store connection by inheritance. */
export function stripPreviewPrivateBlobAliases(environment) {
    if (environment.VERCEL === '1' && environment.VERCEL_ENV !== 'production') {
        for (const name of aliases) delete environment[name];
    }
}

/** Optional connection alias; existing local and unconfigured deployments keep their token. */
export function normalizeVercelPrivateBlobAlias(environment) {
    if (environment.VERCEL !== '1' || environment.VERCEL_ENV !== 'production'
        || environment.SIMSA_VERCEL_METADATA_ENABLED === 'true'
        || (environment.OBJECT_STORAGE_PROVIDER || 'vercel-blob').trim().toLowerCase() !== 'vercel-blob') return;
    const token = environment.SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN;
    if (token === undefined) return;
    // Blob read/write tokens encode the store identifier in their fourth
    // underscore-separated component. Never trim an invalid explicit alias
    // or fall back to another store when it is present but malformed.
    if (typeof token !== 'string' || token.length > 512
        || !/^vercel_blob_rw_[A-Za-z0-9]+_[A-Za-z0-9_-]{16,}$/.test(token)) {
        throw new Error('Invalid private Blob connection alias');
    }
    environment.BLOB_READ_WRITE_TOKEN = token;
    // This mutates only the selected function's process environment. The
    // existing token and both stores in the Vercel control plane are retained.
    for (const name of aliases) delete environment[name];
}
