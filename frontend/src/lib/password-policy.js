// Batas yang sama dengan Better Auth di backend (config/password-policy.ts).
// Kata sandi di luar batas ini ditolak saat disimpan maupun saat masuk.
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

/** Pesan galat untuk kata sandi baru dan konfirmasinya, atau '' bila valid. */
export function newPasswordError(password, confirmation) {
    if (password.length < PASSWORD_MIN_LENGTH) return `Kata sandi minimal ${PASSWORD_MIN_LENGTH} karakter.`
    if (password.length > PASSWORD_MAX_LENGTH) return `Kata sandi maksimal ${PASSWORD_MAX_LENGTH} karakter.`
    if (password !== confirmation) return 'Konfirmasi kata sandi tidak sama.'
    return ''
}
