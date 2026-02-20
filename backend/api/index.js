// Vercel Serverless Function handler (ESM)
// Imports from pre-built dist/app.js (ESM format)

// Vercel function config — increase timeout for Google Drive file uploads
export const config = {
    maxDuration: 60, // 60 seconds for file upload to Google Drive
};

let app;
let initError;

try {
    const mod = await import('../dist/app.js');
    app = mod.default;
} catch (err) {
    initError = err;
    console.error('FATAL: Failed to initialize Express app:', err.message);
    console.error('Stack:', err.stack);
}

export default function handler(req, res) {
    if (initError) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            error: 'App initialization failed',
            message: initError.message,
            stack: initError.stack?.split('\n').slice(0, 8),
        }));
        return;
    }
    return app(req, res);
}
