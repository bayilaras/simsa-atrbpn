// Vercel Serverless Function handler for Express
// Wraps app import in try-catch to surface actual errors

let app: any;
let initError: any;

try {
    app = require('../src/app').default;
} catch (err: any) {
    initError = err;
    console.error('FATAL: Failed to initialize Express app:', err.message);
    console.error('Stack:', err.stack);
}

export default function handler(req: any, res: any) {
    if (initError) {
        return res.status(500).json({
            error: 'App initialization failed',
            message: initError.message,
            stack: initError.stack?.split('\n').slice(0, 5),
        });
    }
    return app(req, res);
}
