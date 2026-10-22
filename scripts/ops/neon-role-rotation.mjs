// Password rotation for SQL-created login roles. Neon Console can reset only
// roles it created (the database owner); every simsa_* login was created by
// bootstrap/provision SQL, so the owner rotates it with ALTER ROLE. Only a
// SCRAM-SHA-256 verifier is sent: the password itself never reaches the server
// or its statement log.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { OpsError } from './neon-credential.mjs';

export const ROTATABLE_ROLES = Object.freeze(['simsa_migration', 'simsa_backup', 'simsa_api', 'simsa_worker', 'simsa_operator']);
const VERIFIER = /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;

/** PostgreSQL stores this exact format when ALTER ROLE receives a verifier. */
export function scramSha256Verifier(password, { salt = randomBytes(16), iterations = 4096 } = {}) {
  const salted = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
  const storedKey = createHash('sha256').update(createHmac('sha256', salted).update('Client Key').digest()).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/**
 * Printable ASCII only: PostgreSQL applies SASLprep to non-ASCII passwords,
 * which a locally computed verifier would not reproduce. The verifier itself
 * appears in statement logs, so a guessable password must be refused.
 */
export function assertRotationPassword(password) {
  if (typeof password !== 'string' || !/^[\x21-\x7e]{32,128}$/.test(password) || new Set(password).size < 12) {
    throw new OpsError('Password baru harus 32-128 karakter ASCII tercetak tanpa spasi, acak (minimal 12 karakter berbeda).');
  }
}

export const randomRolePassword = () => randomBytes(32).toString('hex');

export async function rotateLoginRole(client, { role, password, salt }) {
  if (!ROTATABLE_ROLES.includes(role)) throw new OpsError(`Role ${role} tidak boleh dirotasi oleh helper ini.`);
  assertRotationPassword(password);
  const verifier = scramSha256Verifier(password, { salt });
  if (!VERIFIER.test(verifier)) throw new OpsError('Verifier SCRAM tidak valid.');
  // PostgreSQL 16+ lets a CREATEROLE owner alter only roles it holds ADMIN on;
  // the creator receives that grant implicitly (without INHERIT or SET).
  const { rows: [row] } = await client.query(
    'SELECT rolcanlogin AS login, rolsuper AS superuser, pg_has_role(current_user, oid, \'MEMBER WITH ADMIN OPTION\') AS admin FROM pg_roles WHERE rolname = $1', [role]);
  if (row?.login !== true || row.superuser !== false) throw new OpsError(`${role} tidak ditemukan atau bukan login role biasa.`);
  if (row.admin !== true) throw new OpsError(`Pemilik yang dipakai tidak memegang ADMIN OPTION atas ${role}; gunakan pemilik database yang membuat role itu.`);
  // The verifier matches VERIFIER, so it cannot contain a quote; role is allowlisted.
  await client.query(`ALTER ROLE ${role} WITH PASSWORD '${verifier}'`);
}
