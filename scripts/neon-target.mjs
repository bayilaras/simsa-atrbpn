/** A validated URL still contains credentials. Never log the returned object. */
export function validateNeonTarget(connectionString, { role } = {}) {
  const fail = () => { throw new Error('Neon requires a direct ep-* endpoint, one database, the expected role, and verified TLS; connection details were not printed'); };
  if (typeof connectionString !== 'string' || !connectionString || connectionString !== connectionString.trim()
    || /[\x00-\x20\x7f\\]/.test(connectionString)) fail();
  let url, username, password;
  try { url = new URL(connectionString); username = decodeURIComponent(url.username); password = decodeURIComponent(url.password); }
  catch { fail(); }
  // URL normalizes dot segments before pathname validation. Reject ambiguous
  // input rather than silently selecting a different-looking database path.
  const rawPath = connectionString.match(/^postgres(?:ql)?:\/\/[^/?#]+(\/[^?#]*)\?/i)?.[1];
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !/^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/.test(url.hostname)
    || url.hostname.split('.')[0].endsWith('-pooler')
    || (url.port && url.port !== '5432') || url.hash
    || rawPath !== url.pathname || !/^\/[a-z][a-z0-9_]{2,62}$/.test(url.pathname)
    || !/^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,62}$/.test(username)
    || !password || /[\x00-\x1f\x7f]/.test(password)
    || (role !== undefined && username !== role)
    || url.searchParams.getAll('sslmode').length !== 1 || url.searchParams.get('sslmode') !== 'verify-full'
    || url.searchParams.getAll('channel_binding').length > 1
    || (url.searchParams.has('channel_binding') && url.searchParams.get('channel_binding') !== 'require')
    || [...url.searchParams.keys()].some(key => !['sslmode', 'channel_binding'].includes(key))) fail();
  return url;
}
