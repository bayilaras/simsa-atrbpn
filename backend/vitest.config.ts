import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        // PGlite migration suites and the full auth import graph are memory
        // intensive. Bound the default fan-out to avoid resource-contention
        // timeouts on development machines; --maxWorkers can override this.
        maxWorkers: 2,
        // Some route-policy tests intentionally import the application graph
        // without executing a database query. Give node-postgres an inert test
        // authority so module construction stays side-effect free; production
        // startup still validates the real database configuration in env.ts.
        env: {
            DATABASE_URL: 'postgresql://simsa_test:simsa_test@127.0.0.1:1/simsa_test',
        },
        include: ['src/**/*.{test,spec}.{js,ts}'],
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
