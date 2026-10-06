ALTER TABLE "wallet_accounts" ADD COLUMN "totals_since" timestamp with time zone;--> statement-breakpoint
-- Players reset before this column existed: their totals restart at their latest reset, found in
-- the money history (the reset's note) or the card history (cards given up with source 'reset').
UPDATE "wallet_accounts" AS w
SET "totals_since" = r."at"
FROM (
  SELECT "user_id", max("at") AS "at"
  FROM (
    SELECT "user_id", "effective_at" AS "at" FROM "ledger_entries"
    WHERE "note" = 'Started over' OR "note" LIKE 'Library reset by %'
    UNION ALL
    SELECT "user_id", "created_at" FROM "acquisitions" WHERE "source" = 'reset'
  ) AS resets
  GROUP BY "user_id"
) AS r
WHERE w."user_id" = r."user_id";
