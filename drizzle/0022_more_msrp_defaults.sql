-- More default MSRPs per product kind (design doc 06, section 13), so older and specialty
-- products are for sale too: typical US shelf prices from when each was sold. Cases, displays and
-- "Set of N" products never take their kind's price (`kindPriceApplies`). Kinds still left out
-- vary too much within the kind (Scene Boxes and Tins, Commander Kits, Commander Anthology, the
-- Deluxe Collection, the Codex Bundle) or are only ever found inside other products (sample,
-- box topper and prerelease packs). Admins change any of them on /admin/store, and an existing
-- price is never overwritten.
INSERT INTO "msrp_prices" ("kind", "cents", "updated_at", "updated_by") VALUES
  -- Packs and boxes
  ('booster_pack/default', 399, now(), NULL),
  ('booster_box/default', 14364, now(), NULL),
  ('booster_pack/theme', 499, now(), NULL),
  ('booster_box/theme', 5999, now(), NULL),
  ('booster_pack/six-card', 299, now(), NULL),
  ('booster_pack/advanced', 399, now(), NULL),
  ('booster_pack/welcome', 199, now(), NULL),
  ('booster_pack/other', 499, now(), NULL),
  ('booster_box/premium', 24999, now(), NULL),
  ('bundle/fat_pack', 3999, now(), NULL),
  -- Decks
  ('deck/intro', 1499, now(), NULL),
  ('deck/planeswalker', 1999, now(), NULL),
  ('deck/event', 2499, now(), NULL),
  ('deck/brawl', 2999, now(), NULL),
  ('deck/welcome', 499, now(), NULL),
  ('deck/starter_deck', 499, now(), NULL),
  ('limited_aid_tool/starter_deck', 999, now(), NULL),
  ('limited_aid_tool/tournament_deck', 1299, now(), NULL),
  ('multiple_decks/battle_pack', 1499, now(), NULL),
  ('multiple_decks/clash', 2499, now(), NULL),
  ('kit/deck_builders_toolkit', 1999, now(), NULL),
  -- Secret Lair
  ('box_set/secret_lair', 3999, now(), NULL),
  ('box_set/secret_lair_bundle', 9999, now(), NULL)
ON CONFLICT ("kind") DO NOTHING;
