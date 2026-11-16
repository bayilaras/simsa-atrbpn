import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authorizationRequest, exchangeCode } from './google-drive-otorisasi.mjs';
import { DRIVE_SCOPE } from '../operations-offsite-drive.mjs';

const clientId = '123-abc.apps.googleusercontent.com', redirectUri = 'http://127.0.0.1:53682';

test('the consent request asks only for drive.file, offline, with PKCE', () => {
  const { url, verifier, state } = authorizationRequest({ clientId, redirectUri });
  const params = new URL(url).searchParams;
  assert.equal(new URL(url).origin + new URL(url).pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(params.get('scope'), DRIVE_SCOPE);
  assert.equal(params.get('access_type'), 'offline');
  assert.equal(params.get('prompt'), 'consent');
  assert.equal(params.get('redirect_uri'), redirectUri);
  assert.equal(params.get('state'), state);
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.equal(params.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
});

test('the code exchange returns the refresh token and refuses a grant without Drive access', async () => {
  const reply = body => async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(init.body);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(form.get('code_verifier'), 'v');
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const args = { clientId, clientSecret: 's', code: 'c', verifier: 'v', redirectUri };
  assert.equal(await exchangeCode({ ...args, fetchImpl: reply({ refresh_token: 'r', scope: DRIVE_SCOPE }) }), 'r');
  await assert.rejects(exchangeCode({ ...args, fetchImpl: reply({ access_token: 'a' }) }), { safeCode: 'GOOGLE_REFRESH_TOKEN_MISSING' });
  await assert.rejects(exchangeCode({ ...args, fetchImpl: reply({ refresh_token: 'r', scope: 'openid' }) }), { safeCode: 'GOOGLE_DRIVE_SCOPE_NOT_GRANTED' });
  await assert.rejects(exchangeCode({ ...args, fetchImpl: async () => new Response('{}', { status: 400 }) }), { safeCode: 'GOOGLE_CODE_EXCHANGE_FAILED' });
});
