/**
 * The immutable Vercel deployment this function belongs to, or undefined
 * outside Vercel (local runs, tests, other hosts). Vercel exposes it as the
 * VERCEL_DEPLOYMENT_ID system environment variable at runtime.
 */
export function vercelDeploymentId(environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string | undefined {
    const value = environment.VERCEL_DEPLOYMENT_ID;
    return typeof value === 'string' && /^dpl_[A-Za-z0-9]{8,64}$/.test(value) ? value : undefined;
}
