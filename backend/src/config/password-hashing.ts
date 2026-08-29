import bcrypt from 'bcryptjs';
import {
    hashPassword as hashBetterAuthPassword,
    verifyPassword as verifyBetterAuthPassword,
} from 'better-auth/crypto';

// Earlier SIMSA provisioning scripts stored bcrypt hashes. Better Auth 1.7
// uses scrypt by default, so removing bcrypt verification would lock every
// legacy credential account out immediately after deployment. New and reset
// passwords always use Better Auth's current native hash; bcrypt remains a
// read-only compatibility path until all legacy credentials have been rotated.
const LEGACY_BCRYPT_HASH = /^\$2[aby]\$\d{2}\$/;

export function isLegacyBcryptPasswordHash(hash: string): boolean {
    return LEGACY_BCRYPT_HASH.test(hash);
}

export async function hashCredentialPassword(password: string): Promise<string> {
    return hashBetterAuthPassword(password);
}

export async function verifyCredentialPassword({
    hash,
    password,
}: {
    hash: string;
    password: string;
}): Promise<boolean> {
    try {
        if (isLegacyBcryptPasswordHash(hash)) {
            return await bcrypt.compare(password, hash);
        }

        return await verifyBetterAuthPassword({ hash, password });
    } catch {
        // A malformed or unsupported database value must fail authentication,
        // not turn an invalid-password attempt into a server error.
        return false;
    }
}
