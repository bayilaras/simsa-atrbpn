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

    it.each(['err', 'error'])('keeps only safe classification for structured %s errors', key => {
        let output = '';
        const destination = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
        const log = pino(loggerPrivacyOptions, destination).child({ component: 'StorageWorker' });
        const providerError = Object.assign(new TypeError('credential-canary in provider failure'), {
            code: 'ETIMEDOUT',
            stack: 'TypeError credential-canary\n at https://storage.example/file?signature=url-canary',
            config: { url: 'https://storage.example/file?signature=url-canary', auth: { password: 'auth-canary' } },
            request: { headers: { authorization: 'Bearer header-canary' }, body: 'body-canary' },
            response: { data: 'response-canary', headers: { 'set-cookie': 'cookie-canary' } },
            cause: new Error('cause-canary'),
        });
        requestContext.run({ requestId: 'request-safe-id' }, () => log.error({ [key]: providerError }, 'Storage request failed'));
        expect(output).not.toMatch(/canary|storage\.example/);
        expect(JSON.parse(output)).toMatchObject({ component: 'StorageWorker', requestId: 'request-safe-id', msg: 'Storage request failed' });
        expect(JSON.parse(output)[key]).toEqual({ type: 'TypeError', code: 'ETIMEDOUT' });
    });

    it.each(['direct', 'object'])('prevents Pino copying a %s error message into msg when no event text is supplied', form => {
        let output = '';
        const destination = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
        const log = pino(loggerPrivacyOptions, destination);
        const error = new Error('implicit-message-canary');
        if (form === 'direct') log.error(error);
        else log.error({ err: error });
        expect(output).not.toContain('implicit-message-canary');
        expect(JSON.parse(output).err).toEqual({ type: 'Error' });
    });

    it('retains a known SQLSTATE from a bounded nested cause without serializing cause data', () => {
        let output = '';
        const destination = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
        const log = pino(loggerPrivacyOptions, destination);
        const sqlError = Object.assign(new Error('sql-value-canary'), { code: '23505', detail: 'detail-canary' });
        const error = new Error('query-canary', { cause: sqlError });
        error.name = 'DrizzleQueryError';
        log.error({ err: error }, 'Database mutation failed');
        expect(output).not.toContain('canary');
        expect(JSON.parse(output).err).toEqual({ type: 'DrizzleQueryError', code: '23505' });
    });

    it('fails closed for unknown names/codes and cyclic provider payloads', () => {
        let output = '';
        const destination = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
        const log = pino(loggerPrivacyOptions, destination);
        const error: any = { name: 'name-canary', code: 'code-canary', response: { url: 'url-canary' } };
        error.cause = error;
        log.error({ err: error }, 'Unknown error');
        expect(output).not.toContain('canary');
        expect(JSON.parse(output).err).toEqual({ type: 'Error' });
    });

    it('redacts raw pool and legacy error fields while preserving bounded operational fields', () => {
        let output = '';
        const destination = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
        const log = pino(loggerPrivacyOptions, destination);
        log.error({ errorType: 'Error', errorCode: 'ECONNREFUSED', errorMessage: 'pool-canary',
            message: 'message-canary', stack: 'stack-canary', cause: { config: 'cause-canary' } }, 'Idle database connection failed');
        expect(output).not.toContain('canary');
        expect(JSON.parse(output)).toMatchObject({ errorType: 'Error', errorCode: 'ECONNREFUSED', errorMessage: '[REDACTED]', msg: 'Idle database connection failed' });
        log.error({ errorType: 'name-canary', errorCode: 'code-canary' }, 'Unknown database error');
        expect(output).not.toContain('canary');
    });
});
