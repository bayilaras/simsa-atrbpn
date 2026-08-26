import { afterEach, describe, expect, it, vi } from 'vitest';
import api from './api';

describe('api validation errors', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('preserves structured validation details returned by the server', async () => {
        const details = {
            valid: false,
            errors: [{ code: 'missing_parent', message: 'Parent tidak ditemukan.' }],
            warnings: [],
            stats: { total: 1, active: 1, selectable: 1, roots: 0 },
            contentHash: 'a'.repeat(64),
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            json: vi.fn().mockResolvedValue({
                error: 'Draft aturan belum memenuhi syarat.',
                details,
            }),
        }));

        let thrown;
        try {
            await api.get('/api/validation-example');
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown.message).toBe('Draft aturan belum memenuhi syarat.');
        expect(thrown.status).toBe(400);
        expect(thrown.details).toEqual(details);
    });
});
