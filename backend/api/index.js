// Vercel Serverless Function handler (ESM)
// Imports from pre-built dist/app.js (ESM format)

// One OCR item may spend 30s extracting a text layer, 180s on scanned-page OCR,
// and 30s acquiring/streaming its private Blob. Keep a 60s margin for database
// claims, lease renewal, cleanup, and cold-start overhead.
export const config = {
    maxDuration: 300,
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
