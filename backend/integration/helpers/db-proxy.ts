// Shared `db` mock for every P3 real-Postgres integration test (T2-5).
// Without this, `vi.mock('../src/config/database', ...)` with the same Proxy
// body would have to be duplicated verbatim in every *.postgres.test.ts file
// (plan:556-571 originally asked for exactly that). Instead each test does:
//
//   vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
//   vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));
//   import { dbState } from './helpers/db-proxy.js';
//   // ... in beforeAll, once the harness database is migrated and ready:
//   dbState.db = h.db;
//
// The Proxy binds any function property to the *current* `dbState.db` on
// every access, so tests may swap the underlying drizzle client (e.g. per
// `describe` block) without re-registering the mock.
export const dbState: { db: any } = { db: null };

const proxy = new Proxy(
    {},
    {
        get: (_target, key) => {
            const value = dbState.db?.[key];
            return typeof value === 'function' ? value.bind(dbState.db) : value;
        },
    },
);

export const db = proxy;

export default { db: proxy };
