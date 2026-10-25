import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeFailureDetails } from './runtime-diagnostics.mjs';

const secret = 'CANARY-private-token-49b0';
const privateUrl = `postgresql://operator:${secret}@private.example/database?token=${secret}`;

test('classifies module, native binding, validation and PostgreSQL failures without messages', () => {
  for (const [code, reason] of [
    ['ERR_MODULE_NOT_FOUND', 'module_missing'], ['MODULE_NOT_FOUND', 'module_missing'],
    ['ERR_DLOPEN_FAILED', 'native_binding_failed'], ['28P01', 'database_authentication_failed'],
    ['42501', 'database_permission_denied'], ['42P01', 'database_relation_missing'],
    ['42704', 'database_object_missing'], ['ETIMEDOUT', 'connection_timeout'],
    ['ECONNREFUSED', 'connection_refused'], ['ECONNRESET', 'connection_reset'],
    ['ENOTFOUND', 'dns_lookup_failed'], ['ENOENT', 'file_missing'], ['EACCES', 'file_access_denied'],
  ]) {
    assert.deepEqual(runtimeFailureDetails(Object.assign(new Error(privateUrl), { code })), { errorType: 'Error', errorCode: code, reason });
  }
  assert.deepEqual(runtimeFailureDetails({ name: 'ZodError', message: privateUrl, issues: [{ input: secret }] }), { errorType: 'ZodError', reason: 'validation_failed' });
});

test('uses only exact known package names for missing dependency markers', () => {
  for (const [name, reason] of [
    ['pdfkit', 'missing_pdfkit'], ['exceljs', 'missing_exceljs'], ['pg', 'missing_pg'],
    ['@vercel/functions', 'missing_vercel_functions'], ['@napi-rs/canvas', 'missing_canvas'],
    ['swagger-jsdoc', 'missing_swagger'], ['swagger-ui-express', 'missing_swagger'],
  ]) {
    const error = Object.assign(new Error(`Cannot find package '${name}' imported from /private/${secret}/entry.js`), { code: 'ERR_MODULE_NOT_FOUND' });
    assert.equal(runtimeFailureDetails(error).reason, reason);
    assert.equal(JSON.stringify(runtimeFailureDetails(error)).includes(secret), false);
  }
  for (const name of [`pdfkit-${secret}`, `${secret}`, `pg/${secret}`]) {
    assert.equal(runtimeFailureDetails({ code: 'ERR_MODULE_NOT_FOUND', message: `Cannot find package '${name}' imported from ${privateUrl}` }).reason, 'module_missing');
  }
});

test('returns fixed source markers from known dist frames and missing chunks only', () => {
  const error = new Error(privateUrl);
  error.stack = `Error: ${privateUrl}\n    at unrelated (/private/${secret}/unknown.js:1:2)\n    at bootstrap (file:///var/task/backend/dist-vercel/app.js:234:19)`;
  assert.deepEqual(runtimeFailureDetails(error), { errorType: 'Error', source: 'app' });
  error.stack = `Error: ${secret}\n    at file:///var/task/backend/dist-vercel/workers/malware-scan-on-demand.js:8:12`;
  assert.equal(runtimeFailureDetails(error).source, 'malware_worker');
  error.stack = `Error: ${secret}\n    at config (C:\\private\\${secret}\\dist-vercel\\env-A1B2C3D4.js:9:1)`;
  assert.equal(runtimeFailureDetails(error).source, 'environment');
  const missing = { code: 'ERR_MODULE_NOT_FOUND', message: `Cannot find module '/var/task/${secret}/dist-vercel/chunk-A1B2C3D4.js' imported from /private/${secret}/app.js` };
  assert.deepEqual(runtimeFailureDetails(missing), { errorType: 'Error', errorCode: 'ERR_MODULE_NOT_FOUND', reason: 'module_missing', source: 'dist_chunk' });
  for (const stack of [
    `Error: /dist-vercel/app.js:1:2 ${secret}`,
    `    at /dist-vercel/${secret}.js:1:2`,
    `    at /dist-vercel/app.js?token=${secret}:1:2`,
    `    at /dist-vercel/../app.js:1:2`,
  ]) assert.deepEqual(runtimeFailureDetails({ stack }), { errorType: 'Error' });
});

test('recognizes static configuration, connect timeout, role and native asset reasons', () => {
  for (const [message, reason] of [
    ['Invalid Vercel metadata profile', 'configuration_invalid'],
    ['Invalid private Blob connection alias', 'configuration_invalid'],
    ['timeout exceeded when trying to connect', 'database_connect_timeout'],
    ['Connection terminated due to connection timeout', 'database_connect_timeout'],
    ['Invalid worker database role', 'database_role_invalid'],
    ['Invalid antivirus manifest', 'native_artifact_invalid'],
    ['Packaged antivirus definition hash mismatch', 'native_artifact_invalid'],
    ['Verified engine evidence unavailable', 'native_evidence_unavailable'],
    ['Official antivirus definition update failed', 'native_refresh_failed'],
    ['Cannot find native binding. npm has a bug related to optional dependencies', 'native_binding_failed'],
  ]) assert.equal(runtimeFailureDetails(new Error(message)).reason, reason);
  assert.deepEqual(runtimeFailureDetails(new Error(`Invalid worker database role ${secret}`)), { errorType: 'Error' });
});

test('bounded causes retain safe PG code but never query, response, configuration or arbitrary strings', () => {
  const cause = { code: '42501', message: privateUrl, query: secret, config: { password: secret } };
  cause.cause = cause;
  const error = { name: 'DrizzleQueryError', message: privateUrl, cause, response: { headers: { authorization: secret } }, stack: privateUrl };
  assert.deepEqual(runtimeFailureDetails(error), { errorType: 'DrizzleQueryError', errorCode: '42501', reason: 'database_permission_denied' });
  const result = runtimeFailureDetails({ name: secret, code: secret, message: privateUrl, stack: privateUrl, cause: { name: secret, code: secret } });
  assert.deepEqual(result, { errorType: 'Error' });
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('does not call custom getters, coercion or toJSON, and safely handles hostile inputs', () => {
  let invoked = 0;
  const input = { toString() { invoked++; return secret; }, toJSON() { invoked++; return secret; } };
  for (const key of ['name', 'code', 'message', 'stack', 'cause']) Object.defineProperty(input, key, { get() { invoked++; throw new Error(secret); } });
  assert.deepEqual(runtimeFailureDetails(input), { errorType: 'Error' });
  assert.equal(invoked, 0);
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(secret); }, getPrototypeOf() { throw new Error(secret); } });
  for (const value of [proxy, null, undefined, secret, 7, Symbol(secret), { stack: 'x'.repeat(100000) }]) {
    assert.deepEqual(runtimeFailureDetails(value), { errorType: 'Error' });
  }
});
