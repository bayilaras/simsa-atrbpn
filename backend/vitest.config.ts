import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        // PGlite migration suites and the full auth import graph are memory
        // intensive. Bound the default fan-out to avoid resource-contention
        // timeouts on development machines; --maxWorkers can override this.
        maxWorkers: 2,
        // Node 24 (seen on 24.21.0 through 24.22.2) can abort a worker with a
        // V8 fatal check on JIT pages ("jit_page.has_value()") while PGlite's
        // WebAssembly code is being garbage collected. Turning off wasm code GC
        // only in test workers avoids the crash; production never loads PGlite.
        execArgv: ['--no-wasm-code-gc'],
        // Some route-policy tests intentionally import the application graph
        // without executing a database query. Give node-postgres an inert test
        // authority so module construction stays side-effect free; production
        // startup still validates the real database configuration in env.ts.
        env: {
            DATABASE_URL: 'postgresql://simsa_test:simsa_test@127.0.0.1:1/simsa_test',
        },
        include: ['src/**/*.{test,spec}.{js,ts}'],
    },
});
