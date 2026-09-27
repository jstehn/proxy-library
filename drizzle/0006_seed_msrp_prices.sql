-- Default MSRPs per product kind (ADR 0014; design doc 06, section 13), typical US prices in
-- 2024–2026. Admins change them on /admin/store. Kinds not listed here (cases, welcome decks,
-- sample and promotional packs, prerelease packs sold inside kits) aren't for sale until an admin
-- prices them.
INSERT INTO "msrp_prices" ("kind", "cents", "updated_at", "updated_by") VALUES
  ('booster_pack/play', 549, now(), NULL),
  ('booster_pack/draft', 449, now(), NULL),
  ('booster_pack/set', 499, now(), NULL),
  ('booster_pack/collector', 2499, now(), NULL),
  ('booster_pack/jumpstart', 599, now(), NULL),
  ('booster_box/play', 16464, now(), NULL),
  ('booster_box/draft', 14364, now(), NULL),
  ('booster_box/set', 14970, now(), NULL),
  ('booster_box/collector', 26999, now(), NULL),
  ('booster_box/jumpstart', 13999, now(), NULL),
  ('bundle/default', 5999, now(), NULL),
  ('bundle/gift_bundle', 6999, now(), NULL),
  ('bundle/premium', 8999, now(), NULL),
  ('limited_aid_tool/prerelease_kit', 2999, now(), NULL),
  ('limited_aid_tool/draft', 14999, now(), NULL),
  ('limited_aid_tool/draft_set', 14999, now(), NULL),
  ('deck/commander', 4499, now(), NULL),
  ('deck/theme', 1499, now(), NULL),
  ('deck/default', 1499, now(), NULL),
  ('multiple_decks/two_player_starter', 1999, now(), NULL),
  ('box_set/starter_deck', 1999, now(), NULL)
ON CONFLICT ("kind") DO NOTHING;
