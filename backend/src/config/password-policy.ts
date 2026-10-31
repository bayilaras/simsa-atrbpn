// Better Auth enforces these bounds on sign-up and change-password and rejects
// longer passwords at sign-in. The administrator user API validates against
// the same values so a password it accepts can always be used to sign in.
export const CREDENTIAL_PASSWORD_MIN_LENGTH = 8;
export const CREDENTIAL_PASSWORD_MAX_LENGTH = 128;
