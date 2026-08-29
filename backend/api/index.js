// Vercel Serverless Function handler (ESM)
// Imports from pre-built dist/app.js (ESM format) only after the Preview
// isolation gate has selected explicit PREVIEW_* resources.

import { initializeVercelHandler } from './preview-runtime.js';

// One OCR item may spend 30s extracting a text layer, 180s on scanned-page OCR,
// and 30s acquiring/streaming its private Blob. Keep a 60s margin for database
// claims, lease renewal, cleanup, and cold-start overhead.
export const config = {
    maxDuration: 300,
};

const handler = await initializeVercelHandler({
    environment: process.env,
    loadApp: () => import('../dist/app.js'),
});

export default handler;
