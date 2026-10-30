// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import viteConfig from '../../vite.config.js'
import * as stub from './vercel-oidc-browser'

const blobDist = path.resolve(import.meta.dirname, '../../node_modules/@vercel/blob/dist')

function namesImportedFromOidc() {
    const names = new Set()
    for (const file of readdirSync(blobDist).filter((name) => name.endsWith('.js'))) {
        const source = readFileSync(path.join(blobDist, file), 'utf8')
        for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@vercel\/oidc["']/g)) {
            for (const specifier of match[1].split(',')) {
                const name = specifier.trim().split(/\s+as\s+/)[0]
                if (name) names.add(name)
            }
        }
    }
    return [...names]
}

describe('@vercel/oidc browser stand-in', () => {
    it('is what the client build resolves @vercel/oidc to', () => {
        const config = viteConfig({ command: 'serve', mode: 'test' })
        expect(config.resolve.alias['@vercel/oidc']).toBe(path.resolve(import.meta.dirname, 'vercel-oidc-browser.js'))
    })

    it('exports every name @vercel/blob imports from @vercel/oidc', () => {
        const imported = namesImportedFromOidc()
        expect(imported.length).toBeGreaterThan(0)
        for (const name of imported) expect(stub, name).toHaveProperty(name)
    })

    it('returns no token, like the package browser entry', async () => {
        await expect(stub.getVercelOidcToken()).resolves.toBe('')
        expect(stub.getVercelOidcTokenSync()).toBe('')
    })
})
