import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicDirectory = path.join(projectRoot, 'public')
const outputDirectory = path.join(projectRoot, 'dist')

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })

await copyFile(
  path.join(publicDirectory, 'preview-unavailable.html'),
  path.join(outputDirectory, 'preview-unavailable.html'),
)
await copyFile(
  path.join(publicDirectory, 'preview-unavailable.html'),
  path.join(outputDirectory, 'index.html'),
)
await copyFile(
  path.join(publicDirectory, 'preview-unavailable.json'),
  path.join(outputDirectory, 'preview-unavailable.json'),
)

// A branch URL may already be controlled by a service worker from an older
// deployment. Replace it with a pass-through worker that removes application
// caches, so stale SPA/API responses cannot mask the fail-closed edge routes.
const cleanupServiceWorker = `'use strict'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
    await self.clients.claim()
  })())
})
`

await writeFile(path.join(outputDirectory, 'sw.js'), cleanupServiceWorker, 'utf8')
