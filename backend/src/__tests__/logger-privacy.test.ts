import pino from 'pino';
import { Writable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { loggerPrivacyOptions } from '../utils/logger.js';
import { requestContext } from '../utils/request-context.js';

describe('logger credential protection', () => {
    it.each(['debug', 'info'])('redacts credentials in %s output and propagates request context', level => {
        let output = '';
        const destination = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
        const log = pino({ ...loggerPrivacyOptions, level }, destination);
        requestContext.run({ requestId: 'server-generated-id' }, () => log.info({
            password: 'secret-password', token: 'secret-token', secret: 'secret-value',
            accessToken: 'secret-access', refreshToken: 'secret-refresh',
            account: { password: 'secret-hash', token: 'secret-nested' },
            req: { body: { email: 'private@example.test' }, query: { q: 'private-search' }, headers: { authorization: 'Bearer secret-auth', cookie: 'secret-cookie' } },
            res: { headers: { 'set-cookie': 'secret-session' } },
            event: 'test_event',
        }, 'Safe event'));
        expect(output).not.toMatch(/secret-|private[@-]/);
        expect(JSON.parse(output)).toMatchObject({ requestId: 'server-generated-id', event: 'test_event', password: '[REDACTED]' });
    });
});
