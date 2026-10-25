// Vercel Serverless Function handler (ESM)
// Imports from isolated dist-vercel/app.js (ESM format) only after the Preview
// isolation gate has selected explicit PREVIEW_* resources.

import { initializeSimsaVercelHandler } from '../dist-vercel/vercel-runtime.js';

// One OCR item may spend 30s extracting a text layer, 180s on scanned-page OCR,
// and 30s acquiring/streaming its private Blob. Keep a 60s margin for database
// claims, lease renewal, cleanup, and cold-start overhead.
export const config = {
    maxDuration: 300,
};

const handler = await initializeSimsaVercelHandler({
    environment: process.env,
    loadApp: () => import('../dist-vercel/app.js'),
});

export default handler;
