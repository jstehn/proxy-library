-- New default economy (2026-09-29): a $200.00 starting grant and a $50.00 weekly allowance
-- (were $50.00 and $20.00). Only changes an install still on the old defaults, so amounts an
-- admin chose on /admin/economy are kept. Grants already paid are not changed.
UPDATE "economy_settings"
   SET "starting_grant_cents" = 20000, "allowance_cents" = 5000, "updated_at" = now()
 WHERE "id" = 1 AND "starting_grant_cents" = 5000 AND "allowance_cents" = 2000;
