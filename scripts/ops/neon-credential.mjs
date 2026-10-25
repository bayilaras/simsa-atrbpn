// Operator credential input for release helpers. The operator pastes either the
// bare password or a full connection string from the password manager; only the
// password is kept, and it is re-bound to the pinned direct endpoint. Never log
// the input, the password, or the URL returned by neonUrl().
import { validateNeonTarget } from '../neon-target.mjs';

export class OpsError extends Error {}
const fail = message => { throw new OpsError(message); };
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,62}$/;

/** Validates the non-secret target pins supplied by the operator. */
export function pinnedTarget({ host, database } = {}) {
  if (typeof host !== 'string' || !/^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/.test(host) || host.split('.')[0].endsWith('-pooler')) {
    fail('Host Neon harus endpoint direct ep-*.neon.tech (bukan -pooler).');
  }
  if (typeof database !== 'string' || !/^[a-z][a-z0-9_]{2,62}$/.test(database) || ['postgres', 'template0', 'template1'].includes(database)) {
    fail('Nama database tidak valid.');
  }
  return { host, database };
}

/** Returns only the password from operator input, after checking role, host and database. */
export function operatorPassword(input, { role, host, database }) {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) fail('Kredensial kosong; dibatalkan.');
  if (!/^postgres(?:ql)?:\/\//i.test(value)) {
    if (/[\x00-\x1f\x7f]/.test(value)) fail('Password memuat karakter kontrol; dibatalkan.');
    return value;
  }
  let url, user, password;
  try { url = new URL(value); user = decodeURIComponent(url.username); password = decodeURIComponent(url.password); }
  catch { fail('Connection string tidak dapat dibaca; dibatalkan.'); }
  if (!password) fail('Connection string tidak memuat password; dibatalkan.');
  if (user !== role) fail(`Connection string untuk role '${IDENTIFIER.test(user) ? user : '?'}', bukan '${role}'; dibatalkan.`);
  // Neon Console offers the pooled host by default; accept it as input only.
  const [label, ...rest] = host.split('.');
  if (url.hostname !== host && url.hostname !== [label + '-pooler', ...rest].join('.')) {
    fail('Connection string untuk host lain, bukan host yang dipatok; dibatalkan.');
  }
  if (url.pathname && url.pathname !== '/' && url.pathname !== '/' + database) fail(`Connection string untuk database lain, bukan '${database}'; dibatalkan.`);
  if (/[\x00-\x1f\x7f]/.test(password)) fail('Password memuat karakter kontrol; dibatalkan.');
  return password;
}

/** Canonical direct, verify-full URL. The result contains the password. */
export function neonUrl({ role, password, host, database }) {
  if (!IDENTIFIER.test(role)) fail('Role tidak valid.');
  const url = `postgresql://${role}:${encodeURIComponent(password)}@${host}/${database}?sslmode=verify-full&channel_binding=require`;
  let parsed;
  try { parsed = validateNeonTarget(url, { role }); } catch { fail('Kredensial tidak membentuk target Neon yang valid; dibatalkan.'); }
  if (decodeURIComponent(parsed.password) !== password) fail('Password tidak dapat dikodekan dengan aman; dibatalkan.');
  return url;
}
