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
        // Details are already logged above — never expose them to the client.
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
        return;
    }
    return app(req, res);
}
