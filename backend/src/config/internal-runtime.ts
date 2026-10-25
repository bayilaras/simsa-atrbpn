/** A local operator launcher is never a deployment profile or a demo switch. */
export function internalRuntimeConfig(source: NodeJS.ProcessEnv) {
    if (source.SIMSA_INTERNAL_LOCAL !== 'true'
        || source.NODE_ENV !== 'development'
        || source.K_SERVICE || source.VERCEL
        || source.COOKIE_DOMAIN?.trim()
        || source.APP_PROFILE !== 'internal'
        || source.SIMSA_CLOUD_PLATFORM !== 'local'
        || source.AUTH_PROVIDER !== 'better-auth'
        || (source.SIMSA_APP_MODE || 'full') !== 'full') {
        throw new Error('Peluncur lokal memerlukan konfigurasi internal/full, development, local, dan Better Auth.');
    }
    const rawPort = source.SIMSA_INTERNAL_PORT || '3000';
    const port = Number(rawPort);
    if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(port) || port < 1024 || port > 65535) {
        throw new Error('SIMSA_INTERNAL_PORT harus berupa port 1024–65535.');
    }
    const origins = [source.FRONTEND_URL, source.BETTER_AUTH_URL,
        ...(source.ADDITIONAL_TRUSTED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)];
    for (const raw of origins) {
        let url: URL;
        try { url = new URL(raw || ''); }
        catch { throw new Error('Alamat frontend dan autentikasi lokal tidak valid.'); }
        if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)
            || Number(url.port) !== port || url.username || url.password
            || url.pathname !== '/' || url.search || url.hash) {
            throw new Error('Alamat frontend dan autentikasi harus memakai HTTP localhost/127.0.0.1 pada port aplikasi.');
        }
    }
    let database: URL;
    try { database = new URL(source.DATABASE_URL || ''); }
    catch { throw new Error('Konfigurasi database lokal tidak valid.'); }
    if (!['postgres:', 'postgresql:'].includes(database.protocol)
        || database.hostname !== '127.0.0.1' || database.port !== '55432'
        || database.pathname !== '/simsa_local' || database.search || database.hash) {
        throw new Error('Peluncur lokal memerlukan database simsa_local pada 127.0.0.1:55432 tanpa parameter pengalihan.');
    }
    return { host: '127.0.0.1' as const, port };
}

export function validateInternalBuild(manifest: unknown): void {
    const value = manifest as Record<string, unknown> | null;
    if (!value || value.schemaVersion !== 1 || value.mode !== 'full'
        || value.syntheticDataOnly !== false || value.api !== 'same-origin'
        || value.authProvider !== 'better-auth') {
        throw new Error('Frontend harus dibangun dalam mode full, same-origin, dan Better Auth sebelum SIMSA dimulai.');
    }
}
