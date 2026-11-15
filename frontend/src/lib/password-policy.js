// Aturan kata sandi baru, sama dengan backend/src/config/password-policy.ts
// (password-policy.test.js membandingkan keduanya). Server tetap memeriksa
// ulang. Kata sandi lama minimal 8 karakter tetap dapat dipakai untuk masuk.
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128
const IDENTITY_PART_MIN_LENGTH = 4

export const COMMON_PASSWORDS = [
    '123456789012', '1234567890123', '12345678901234', '123123123123', '111111111111', '000000000000',
    'aaaaaaaaaaaa', 'abcdefghijkl', 'abc123456789', 'qwertyuiop12', 'qwertyuiop123', 'qwerty123456',
    '1q2w3e4r5t6y', '1qaz2wsx3edc', 'password1234', 'password12345', 'password123!', 'passwordpassword',
    'passw0rd1234', 'admin1234567', 'administrator', 'administrator1', 'welcome12345', 'letmein12345',
    'iloveyou1234', 'indonesia123', 'indonesia1945', 'bismillah123', 'katasandi123', 'rahasia12345',
    'simsa1234567', 'atrbpn123456', 'kementerian123',
]

export const PASSWORD_RULES_HINT = `Minimal ${PASSWORD_MIN_LENGTH} karakter, tidak memuat nama atau bagian depan email pengguna, dan bukan kata sandi yang umum.`
export const FIRST_LOGIN_PASSWORD_NOTE = 'Minta pegawai mengganti kata sandi ini di Pengaturan › Profil setelah masuk pertama kali.'

/** Alasan kata sandi baru ditolak, atau '' bila memenuhi aturan. `owner`: { email, name } pemilik akun. */
export function passwordRuleError(password, owner = {}) {
    if (password.length < PASSWORD_MIN_LENGTH) return `Kata sandi minimal ${PASSWORD_MIN_LENGTH} karakter.`
    if (password.length > PASSWORD_MAX_LENGTH) return `Kata sandi maksimal ${PASSWORD_MAX_LENGTH} karakter.`
    const lower = password.toLowerCase()
    if (COMMON_PASSWORDS.includes(lower)) return 'Kata sandi ini terlalu umum dan mudah ditebak. Pilih kata sandi lain.'
    const localPart = String(owner?.email ?? '').trim().toLowerCase().split('@')[0]
    if (localPart.length >= IDENTITY_PART_MIN_LENGTH && lower.includes(localPart)) {
        return 'Kata sandi tidak boleh memuat bagian depan alamat email (sebelum tanda @).'
    }
    const nameParts = String(owner?.name ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)
        .filter(part => part.length >= IDENTITY_PART_MIN_LENGTH)
    if (nameParts.some(part => lower.includes(part))) return 'Kata sandi tidak boleh memuat nama pengguna.'
    return ''
}

/** Pesan galat untuk kata sandi baru dan konfirmasinya, atau '' bila valid. */
export function newPasswordError(password, confirmation, owner = {}) {
    const ruleError = passwordRuleError(password, owner)
    if (ruleError) return ruleError
    if (password !== confirmation) return 'Konfirmasi kata sandi tidak sama.'
    return ''
}
