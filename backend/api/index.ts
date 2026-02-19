// Vercel Serverless Function handler for Express
// Wraps app import in try-catch to surface actual errors

import type { IncomingMessage, ServerResponse } from 'http';

let app: any;
let initError: any;

async function getApp() {
    if (initError) return null;
    if (app) return app;

    try {
        const mod = await import('../src/app');
        app = mod.default;
        return app;
    } catch (err: any) {
        initError = err;
        console.error('FATAL: Failed to initialize Express app:', err.message);
        console.error('Stack:', err.stack);
        return null;
    }
}

// Pre-load on cold start
getApp();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
    const expressApp = await getApp();

    if (!expressApp) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            error: 'App initialization failed',
            message: initError?.message || 'Unknown error',
            stack: initError?.stack?.split('\n').slice(0, 8),
        }));
        return;
    }

    return expressApp(req, res);
}
