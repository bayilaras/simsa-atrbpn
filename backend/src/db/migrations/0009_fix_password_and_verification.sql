-- Reverse migration 0007 and fix Better Auth column types.
--
-- 0007 erroneously moved the credential password to users.password and dropped
-- accounts.password. Better Auth's credential provider (and the seed scripts) read
-- the bcrypt hash from accounts.password, so 0007 breaks authentication and
-- contradicts the Drizzle schema. Restore the correct location, migrating any hash
-- that 0007 may have relocated. Written idempotently so it is safe in any state.

ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "password" text;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'password'
  ) THEN
    UPDATE "accounts" a
      SET "password" = u."password"
      FROM "users" u
      WHERE a."user_id" = u."id"
        AND a."provider_id" = 'credential'
        AND a."password" IS NULL
        AND u."password" IS NOT NULL;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "users" DROP COLUMN IF EXISTS "password";--> statement-breakpoint

-- Better Auth stores JSON OAuth state (PKCE codeVerifier, callbackURL, expiry) in
-- verifications; the 255-char cap truncates it and breaks Google sign-in.
ALTER TABLE "verifications" ALTER COLUMN "value" TYPE text;--> statement-breakpoint
ALTER TABLE "verifications" ALTER COLUMN "identifier" TYPE text;
