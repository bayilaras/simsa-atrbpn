import bcrypt from 'bcryptjs';
import { verifyPassword as verifyBetterAuthPassword } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';
import {
    hashCredentialPassword,
    isLegacyBcryptPasswordHash,
    verifyCredentialPassword,
} from '../config/password-hashing.js';

describe('credential password compatibility', () => {
    const password = 'SIMSA-Test-Password-2026!';

    it('writes and verifies the current Better Auth scrypt format', async () => {
        const hash = await hashCredentialPassword(password);

        expect(isLegacyBcryptPasswordHash(hash)).toBe(false);
        await expect(verifyBetterAuthPassword({ hash, password })).resolves.toBe(true);
        await expect(verifyCredentialPassword({ hash, password })).resolves.toBe(true);
        await expect(verifyCredentialPassword({ hash, password: 'wrong-password' })).resolves.toBe(false);
    });

    it.each(['2a', '2b', '2y'])('continues to verify legacy bcrypt $%s rows', async (minor) => {
        const nativeHash = await bcrypt.hash(password, 4);
        const legacyHash = nativeHash.replace(/^\$2[ab]\$/, `$${minor}$`);

        expect(isLegacyBcryptPasswordHash(legacyHash)).toBe(true);
        await expect(verifyCredentialPassword({ hash: legacyHash, password })).resolves.toBe(true);
        await expect(verifyCredentialPassword({ hash: legacyHash, password: 'wrong-password' })).resolves.toBe(false);
    });

    it('fails closed for malformed or unsupported database hashes', async () => {
        await expect(verifyCredentialPassword({ hash: '', password })).resolves.toBe(false);
        await expect(verifyCredentialPassword({ hash: '$2b$not-a-valid-hash', password })).resolves.toBe(false);
        await expect(verifyCredentialPassword({ hash: 'unknown-format', password })).resolves.toBe(false);
    });
});
