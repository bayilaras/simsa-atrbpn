ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "firebase_uid" varchar(128),
  ADD COLUMN IF NOT EXISTS "identity_provider" varchar(24) DEFAULT 'better_auth' NOT NULL,
  ADD COLUMN IF NOT EXISTS "auth_migrated_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_firebase_uid_unique"
  ON "users" USING btree ("firebase_uid");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_identity_provider_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_identity_provider_check"
      CHECK ("identity_provider" IN ('better_auth', 'firebase', 'hybrid'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_firebase_identity_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_firebase_identity_check"
      CHECK ("firebase_uid" IS NULL OR length("firebase_uid") BETWEEN 1 AND 128);
  END IF;
END $$;
