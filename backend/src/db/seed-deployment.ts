import { readFileSync } from 'node:fs';
import { pool } from '../config/database';

try {
    // Unit convergence is independently idempotent; a governance failure leaves
    // these initial units available for the authenticated setup workflow.
    await pool.query(readFileSync(new URL('./deployment-unit-seed.sql', import.meta.url), 'utf8'));
    await pool.query(readFileSync(new URL('./deployment-regulatory-evidence.sql', import.meta.url), 'utf8'));
    console.log('Deployment units converged and governed active instruments verified; no instruments published.');
} catch (error) {
    console.error(error instanceof Error ? error.message : 'Deployment governance verification failed.');
    process.exitCode = 1;
} finally {
    await pool.end();
}
