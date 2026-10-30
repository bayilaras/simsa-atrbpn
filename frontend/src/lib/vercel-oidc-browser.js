// Browser stand-in for @vercel/oidc, wired up by resolve.alias in vite.config.js.
//
// @vercel/blob imports getVercelOidcToken and treats an empty token as "no
// OIDC"; browser uploads authenticate with the client token issued by the
// upload route instead. The package's own browser entry also returns '', but it
// is CommonJS and require()s its token verifier, which drags jose into the
// upload chunk. These functions mirror that entry's behaviour without it.
// Re-check the import list in vercel-oidc-browser.test.js when @vercel/blob is
// upgraded.
export async function getVercelOidcToken() {
    return ''
}

export function getVercelOidcTokenSync() {
    return ''
}
