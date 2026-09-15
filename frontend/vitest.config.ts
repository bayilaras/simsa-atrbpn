import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        // Node 24's native Web Storage is not a browser origin. Let jsdom
        // provide localStorage/sessionStorage independently in each worker.
        execArgv: ['--no-experimental-webstorage'],
        // Multi-step dialog tests can exceed the default five seconds on a
        // busy CI worker; keep a bounded budget without weakening assertions.
        testTimeout: 15_000,
        setupFiles: './src/test/setup.ts',
        include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
