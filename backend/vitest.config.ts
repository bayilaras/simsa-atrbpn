import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.{test,spec}.{js,ts}'],
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
