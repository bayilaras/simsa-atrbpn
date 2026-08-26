-- Better Auth 1.7 identifies an account by the OpenID Connect pair
-- (issuer, account_id). Credential accounts use a synthetic local issuer and
-- the linked user UUID as account_id.

ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "issuer" text;--> statement-breakpoint

-- Refuse to invent identity semantics for an unrecognised provider. Likewise,
-- reject partially populated issuer values and collisions before changing any
-- account identity data.
DO $$
DECLARE
  unsupported_providers text;
BEGIN
  SELECT string_agg(provider_id, ', ' ORDER BY provider_id)
  INTO unsupported_providers
  FROM (
    SELECT DISTINCT provider_id
    FROM "accounts"
    WHERE provider_id NOT IN ('credential', 'google')
  ) providers;

  IF unsupported_providers IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = '0015 preflight failed: unsupported account provider(s): ' || unsupported_providers,
      HINT = 'Map every provider to its verified issuer before rerunning this migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "accounts"
    WHERE issuer IS NOT NULL
      AND issuer <> CASE provider_id
        WHEN 'credential' THEN 'local:credential'
        WHEN 'google' THEN 'https://accounts.google.com'
      END
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = '0015 preflight failed: an existing issuer conflicts with its provider',
      HINT = 'Review the affected identity manually; the migration will not overwrite a non-null issuer.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        CASE provider_id
          WHEN 'credential' THEN 'local:credential'
          WHEN 'google' THEN 'https://accounts.google.com'
        END AS normalized_issuer,
        CASE provider_id
          WHEN 'credential' THEN user_id::text
          ELSE account_id
        END AS normalized_account_id
      FROM "accounts"
    ) normalized_accounts
    GROUP BY normalized_issuer, normalized_account_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = '0015 preflight failed: duplicate normalized (issuer, account_id) identity',
      HINT = 'Reconcile duplicate account ownership before rerunning this migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "accounts"
    WHERE provider_id = 'google'
      AND (account_id IS NULL OR length(trim(account_id)) = 0)
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = '0015 preflight failed: Google account_id is empty',
      HINT = 'Restore the verified Google subject before rerunning this migration.';
  END IF;
END $$;--> statement-breakpoint

UPDATE "accounts"
SET
  "issuer" = 'local:credential',
  "account_id" = "user_id"::text
WHERE "provider_id" = 'credential';--> statement-breakpoint

UPDATE "accounts"
SET "issuer" = 'https://accounts.google.com'
WHERE "provider_id" = 'google';--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "accounts"
    WHERE issuer IS NULL OR length(trim(issuer)) = 0
  ) THEN
    RAISE EXCEPTION '0015 postcondition failed: accounts.issuer remains unresolved';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "accounts"
    WHERE provider_id = 'credential'
      AND (issuer <> 'local:credential' OR account_id <> user_id::text)
  ) THEN
    RAISE EXCEPTION '0015 postcondition failed: credential identity was not normalized';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "accounts"
    WHERE provider_id = 'google'
      AND issuer <> 'https://accounts.google.com'
  ) THEN
    RAISE EXCEPTION '0015 postcondition failed: Google issuer was not normalized';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "accounts" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint

-- Do not use IF NOT EXISTS: a pre-existing object with this name but the wrong
-- definition must fail rather than falsely claiming the identity key is safe.
CREATE UNIQUE INDEX "accounts_issuer_account_id_unique"
  ON "accounts" ("issuer", "account_id");
