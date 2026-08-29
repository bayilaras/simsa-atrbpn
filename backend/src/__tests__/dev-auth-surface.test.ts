import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.stubEnv('NODE_ENV', 'development');
const { default: app } = await import('../app.js');

afterAll(() => {
    vi.unstubAllEnvs();
});

describe('development authentication surface', () => {
    it('does not mount a password-bypass login route even in development', async () => {
        const csrfToken = 'a'.repeat(64);
        const response = await request(app)
            .post('/api/dev/dev-login')
            .set('Cookie', `csrf-token=${csrfToken}`)
            .set('X-CSRF-Token', csrfToken)
            .send({ email: 'seed@example.go.id' })
            .expect(404);

        expect(response.body).toMatchObject({
            success: false,
            error: 'Not Found',
            path: '/api/dev/dev-login',
        });
        expect(response.headers['set-cookie'] || []).not.toEqual(
            expect.arrayContaining([expect.stringContaining('better-auth.session_token=')]),
        );
    });

    it('does not exempt dev-looking mutation paths from CSRF protection', async () => {
        const response = await request(app)
            .post('/api/dev/dev-login')
            .send({ email: 'seed@example.go.id' })
            .expect(403);

        expect(response.body).toMatchObject({ error: 'CSRF Validation Failed' });
    });

    it('exempts only the exact Better Auth route namespace from CSRF protection', async () => {
        const response = await request(app)
            .post('/api/authz-looking')
            .send({})
            .expect(403);

        expect(response.body).toMatchObject({ error: 'CSRF Validation Failed' });
    });
});
