// Sign-in accepts every stored password within these bounds, so accounts
// created before the stricter rules below keep working. Better Auth rejects
// longer passwords at sign-in.
export const CREDENTIAL_PASSWORD_MIN_LENGTH = 8;
export const CREDENTIAL_PASSWORD_MAX_LENGTH = 128;

// Rules for a password that is being set: by a Super Admin (new user, reset)
// or by the user (change password). The frontend mirrors them in
// frontend/src/lib/password-policy.js; a test there compares both files.
export const NEW_PASSWORD_MIN_LENGTH = 12;
// Name parts and the email's local part are checked from this length on, so
// initials and titles do not forbid ordinary letter pairs.
const IDENTITY_PART_MIN_LENGTH = 4;

// Very common passwords of at least NEW_PASSWORD_MIN_LENGTH characters,
// lower case. Shorter ones are already refused by the length rule.
export const COMMON_PASSWORDS: readonly string[] = [
    '123456789012', '1234567890123', '12345678901234', '123123123123', '111111111111', '000000000000',
    'aaaaaaaaaaaa', 'abcdefghijkl', 'abc123456789', 'qwertyuiop12', 'qwertyuiop123', 'qwerty123456',
    '1q2w3e4r5t6y', '1qaz2wsx3edc', 'password1234', 'password12345', 'password123!', 'passwordpassword',
    'passw0rd1234', 'admin1234567', 'administrator', 'administrator1', 'welcome12345', 'letmein12345',
    'iloveyou1234', 'indonesia123', 'indonesia1945', 'bismillah123', 'katasandi123', 'rahasia12345',
    'simsa1234567', 'atrbpn123456', 'kementerian123',
];

export interface PasswordOwner {
    email?: string | null;
    name?: string | null;
}

/** Indonesian reason a new password is refused, or null when it is acceptable. */
export function newPasswordProblem(password: string, owner: PasswordOwner = {}): string | null {
    if (password.length < NEW_PASSWORD_MIN_LENGTH) return `Kata sandi minimal ${NEW_PASSWORD_MIN_LENGTH} karakter.`;
    if (password.length > CREDENTIAL_PASSWORD_MAX_LENGTH) return `Kata sandi maksimal ${CREDENTIAL_PASSWORD_MAX_LENGTH} karakter.`;
    const lower = password.toLowerCase();
    if (COMMON_PASSWORDS.includes(lower)) return 'Kata sandi ini terlalu umum dan mudah ditebak. Pilih kata sandi lain.';
    const localPart = (owner.email ?? '').trim().toLowerCase().split('@')[0];
    if (localPart.length >= IDENTITY_PART_MIN_LENGTH && lower.includes(localPart)) {
        return 'Kata sandi tidak boleh memuat bagian depan alamat email (sebelum tanda @).';
    }
    const nameParts = (owner.name ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)
        .filter(part => part.length >= IDENTITY_PART_MIN_LENGTH);
    if (nameParts.some(part => lower.includes(part))) return 'Kata sandi tidak boleh memuat nama pengguna.';
    return null;
}
