-- Better Auth 1.7.3+ kembali mengenali akun lewat (provider_id, account_id)
-- seperti 1.6 dan tidak lagi menulis kolom issuer dari 0015 (panduan upgrade:
-- https://www.better-auth.com/docs/guides/1-7-upgrade-guide). Selama issuer
-- NOT NULL, Better Auth menolak start (SCHEMA_MISMATCH) dan setiap insert akun
-- gagal.
--
-- issuer tidak dihapus, hanya menjadi nullable, sehingga nilai lama tetap
-- terbaca bila backend dikembalikan ke Better Auth 1.7.1. Sebelum rollback
-- seperti itu, isi issuer akun baru dengan pemetaan yang sama seperti 0015.
-- Kunci identitas unik pindah ke pasangan yang dipakai 1.7.3+, jadi satu
-- identitas Google tetap tidak bisa tertaut ke dua pengguna.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "accounts"
    GROUP BY provider_id, account_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = '0052: identitas (provider_id, account_id) ganda',
      HINT = 'Rekonsiliasi kepemilikan akun ganda sebelum menjalankan ulang migrasi ini.';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "accounts" ALTER COLUMN "issuer" DROP NOT NULL;--> statement-breakpoint

DROP INDEX IF EXISTS "accounts_issuer_account_id_unique";--> statement-breakpoint

-- Tanpa IF NOT EXISTS: objek bernama sama dengan definisi lain harus
-- menggagalkan migrasi, bukan dianggap kunci identitas yang aman (seperti 0015).
CREATE UNIQUE INDEX "accounts_provider_id_account_id_unique"
  ON "accounts" ("provider_id", "account_id");
