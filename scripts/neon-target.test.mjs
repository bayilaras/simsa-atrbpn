import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNeonTarget } from './neon-target.mjs';

const example = 'postgresql://simsa_api:EXAMPLE_NOT_A_REAL_PASSWORD@ep-example-123.ap-southeast-1.aws.neon.tech/simsa_cloud?sslmode=verify-full';
test('accepts only explicit verified TLS direct Neon target and requested role', () => {
  const value = validateNeonTarget(example, { role: 'simsa_api' });
  assert.equal(value.hostname, 'ep-example-123.ap-southeast-1.aws.neon.tech');
  assert.equal(value.pathname, '/simsa_cloud');
  assert.equal(validateNeonTarget(example + '&channel_binding=require').searchParams.get('channel_binding'), 'require');
  assert.equal(validateNeonTarget(example.replace('/simsa_cloud', ':5432/simsa_cloud')).port, '5432');
});
test('refuses source, pooler, alternate hosts, unsafe TLS, URL overrides and duplicate parameters', () => {
  const invalid = [example.replace('ep-example-123.', 'ep-example-123-pooler.'),
    example.replace('ep-example-123.ap-southeast-1.aws.neon.tech', '127.0.0.1'),
    example.replace('ep-example-123.ap-southeast-1.aws.neon.tech', 'ep-example-123.neon.tech.evil.test'),
    example.replace('/simsa_cloud', ':55432/simsa_cloud'), example.replace('verify-full', 'require'),
    example.replace('postgresql:', 'https:'), example + '#fragment', example + '&sslmode=disable',
    example + '&host=localhost', example + '&user=admin', example + '&options=-c%20role%3Dadmin',
    example + '&channel_binding=disable', example.replace('/simsa_cloud', '/simsa_cloud/other'),
    example.replace('/simsa_cloud', '/other/../simsa_cloud'), example.replace('/simsa_cloud', '/other/%2e%2e/simsa_cloud'),
    example.replace('/simsa_cloud', '/%73imsa_cloud'), ' ' + example, example + '\n',
    example.replace('simsa_api:', ':'), example.replace('EXAMPLE_NOT_A_REAL_PASSWORD', '')];
  for (const value of invalid) assert.throws(() => validateNeonTarget(value), error => {
    assert.doesNotMatch(error.message, /EXAMPLE_NOT_A_REAL_PASSWORD|postgresql:\/\//); return true;
  });
  assert.throws(() => validateNeonTarget(example, { role: 'simsa_migration' }));
});
