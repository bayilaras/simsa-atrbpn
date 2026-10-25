import express from 'express';
import request from 'supertest';
import { getIP } from '@better-auth/core/utils/ip';
import { describe, expect, it } from 'vitest';
import { betterAuthIpOptions, prepareBetterAuthClientIp } from '../middlewares/better-auth-ip.middleware.js';

function server(trustProxy: boolean | number = 1) {
    const app = express();
    app.set('trust proxy', trustProxy);
    app.get('/', (req, res) => {
        prepareBetterAuthClientIp(req);
        res.json({ ip: getIP(new Headers({
            'x-simsa-client-ip': req.get('x-simsa-client-ip') || '',
            'x-forwarded-for': req.get('x-forwarded-for') || '',
        }), { advanced: { ipAddress: betterAuthIpOptions } }) });
    });
    return app;
}

describe('Better Auth client IP boundary', () => {
    it('uses the Express-selected hop, ignores spoofed prefixes, and isolates clients behind forwarding chains', async () => {
        const app = server();
        for (const ip of ['192.0.2.10', '192.0.2.11']) {
            const response = await request(app).get('/').set('X-Forwarded-For', `203.0.113.99, ${ip}`)
                .set('X-Simsa-Client-IP', '203.0.113.77');
            expect(response.body.ip).toBe(ip);
        }
    });
    it('cannot override the socket identity when the application does not trust a proxy', async () => {
        const response = await request(server(false)).get('/').set('X-Forwarded-For', '203.0.113.99')
            .set('X-Simsa-Client-IP', '203.0.113.77');
        expect(response.body.ip).toBe('127.0.0.1');
    });
    it('groups IPv6 privacy addresses by the same /56 policy as Express', async () => {
        const app = server();
        const addresses = ['2001:db8:1234:ab00::1', '2001:db8:1234:abff::2', '2001:db8:1234:ac00::1'];
        const results = await Promise.all(addresses.map(ip => request(app).get('/').set('X-Forwarded-For', ip)));
        expect(results[0].body.ip).toBe(results[1].body.ip);
        expect(results[0].body.ip).not.toBe(results[2].body.ip);
    });
});
