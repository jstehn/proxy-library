-- Default economy settings (design doc 03): $20.00 allowance every 7 days, paid on Mondays at
-- 00:00 UTC (anchored at the Monday of the week this migration runs), a $50.00 starting grant,
-- and a $100.00 limit per self-funding deposit. Admins change these on /admin/economy.
INSERT INTO "economy_settings" (
  "id", "allowance_cents", "allowance_period_days", "allowance_anchor",
  "starting_grant_cents", "self_fund_limit_cents", "updated_at", "updated_by"
) VALUES (
  1, 2000, 7, date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
  5000, 10000, now(), NULL
) ON CONFLICT ("id") DO NOTHING;
