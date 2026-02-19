// Vercel Serverless Function handler
// Imports from pre-built dist/app.js (tsup bundle resolves ESM/CJS issues)
const app = require('../dist/app').default;

module.exports = app;
