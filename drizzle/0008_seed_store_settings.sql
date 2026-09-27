-- The store's settings (design doc 07): it buys cards from players at 50% of market price.
-- Admins change this on /admin/store.
INSERT INTO "store_settings" ("id", "buylist_rate_bps", "updated_at", "updated_by")
VALUES (1, 5000, now(), NULL)
ON CONFLICT ("id") DO NOTHING;
