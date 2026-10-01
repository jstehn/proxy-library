# Builds small, internally consistent fixtures from real MTGJSON files (see tests/fixtures/README.md).
import gzip, json, copy, sys
SP = sys.argv[1]
OUT = "tests/fixtures"
blb = json.load(gzip.open(f"{SP}/BLB.json.gz"))
spg = json.load(gzip.open(f"{SP}/SPG.json.gz"))
setlist = json.load(gzip.open(f"{SP}/SetList.json.gz"))
s = blb["data"]
cards = {c["uuid"]: c for c in s["cards"]}
by_number = {c["number"]: c for c in s["cards"]}
play = s["booster"]["play"]

def first_n(sheet, rarity, n):
    uuids = [u for u in play["sheets"][sheet]["cards"] if u in cards and cards[u]["rarity"] in rarity]
    return sorted(uuids, key=lambda u: int("".join(ch for ch in cards[u]["number"] if ch.isdigit()) or 0))[:n]

keep = set()
keep |= set(first_n("common", {"common"}, 8))
keep |= set(first_n("uncommon", {"uncommon"}, 4))
keep |= set(first_n("rareMythicWithShowcase", {"rare"}, 2))
keep |= set(first_n("rareMythicWithShowcase", {"mythic"}, 1))
keep |= set(first_n("land", {"common"}, 2))
for number in ["295", "356", "343", "386", "379", "120"]:  # showcase, extended art, raised foil, bundle promo, starter deck, Wick (identity wider than its cost)
    keep.add(by_number[number]["uuid"])

# Decks: Hare Raising (starter kit) trimmed to kept cards + one extra; the bundle land pack; MTGO redemption.
decks = {d["name"]: d for d in s["decks"]}
hare = copy.deepcopy(decks["Hare Raising"])
for entry in hare["mainBoard"][:3]:
    keep.add(entry["uuid"])
land_pack = copy.deepcopy(decks["Bloomburrow Bundle Land Pack"])
for entry in land_pack["mainBoard"][:2]:
    keep.add(entry["uuid"])
hare["mainBoard"] = [e for e in hare["mainBoard"] if e["uuid"] in keep]
land_pack["mainBoard"] = [e for e in land_pack["mainBoard"] if e["uuid"] in keep]
redemption = copy.deepcopy(decks["Bloomburrow Redemption"])
redemption["mainBoard"] = redemption["mainBoard"][:2]
for entry in redemption["mainBoard"]:
    keep.add(entry["uuid"]) if entry["uuid"] in cards else None

kept_cards = [copy.deepcopy(cards[u]) for u in sorted(keep, key=lambda u: int("".join(ch for ch in cards[u]["number"] if ch.isdigit()) or 0))]

# A SYNTHETIC digital-only card (Alchemy-style), to test that "arena only" printings are excluded.
alchemy = copy.deepcopy(kept_cards[0])
alchemy["uuid"] = "00000000-a1c4-4e3a-8000-000000000001"
alchemy["name"] = "A-" + alchemy["name"]
alchemy["number"] = "A-" + alchemy["number"]
alchemy["availability"] = ["arena"]
alchemy["identifiers"] = {**alchemy["identifiers"], "scryfallId": "00000000-a1c4-4e3a-8000-0000000000ff"}
kept_cards.append(alchemy)

# Special guests referenced by the play booster (from SPG), trimmed to 2 cards.
spg_cards = {c["uuid"]: c for c in spg["data"]["cards"]}
guests = [u for u in play["sheets"]["specialGuest"]["cards"]][:2]

def trim_sheet(sheet, allowed):
    kept = {u: w for u, w in sheet["cards"].items() if u in allowed}
    out = {k: v for k, v in sheet.items() if k != "cards"}
    out["cards"] = kept
    out["totalWeight"] = sum(kept.values())
    return out

kept_ids = {c["uuid"] for c in kept_cards if c["availability"] != ["arena"]}
sheets = {}
for name, sheet in play["sheets"].items():
    allowed = set(guests) if name == "specialGuest" else kept_ids
    sheets[name] = trim_sheet(sheet, allowed)
fixture_play = {**{k: v for k, v in play.items() if k != "sheets"}, "sheets": sheets}

arena = s["booster"]["play-arena"]
arena_sheets = {name: trim_sheet(sh, kept_ids) for name, sh in arena["sheets"].items() if name in ("common", "uncommon")}
arena_sheets["common"]["cards"][alchemy["uuid"]] = 1  # only the digital booster may use the Alchemy card
arena_sheets["common"]["totalWeight"] += 1
fixture_arena = {"boosters": [{"contents": {"common": 1, "uncommon": 1}, "weight": 1}], "boostersTotalWeight": 1,
                 "sheets": arena_sheets, "sourceSetCodes": ["BLB"]}

products = {p["name"]: p for p in s["sealedProduct"]}
wanted = ["Bloomburrow Play Booster Pack", "Bloomburrow Play Booster Box", "Bloomburrow Play Booster Box Case",
          "Bloomburrow Bundle", "Bloomburrow Starter Kit", "Bloomburrow MTGO Redemption"]
fixture_products = [copy.deepcopy(products[name]) for name in wanted]
for p in fixture_products:  # the starter kit: keep only the Hare Raising deck
    if p["name"] == "Bloomburrow Starter Kit":
        p["contents"]["deck"] = [d for d in p["contents"]["deck"] if d["name"] == "Hare Raising"]
        p["contents"]["other"] = p["contents"].get("other", [])

data = {k: s[k] for k in ["baseSetSize", "code", "isFoilOnly", "isOnlineOnly", "keyruneCode", "name", "releaseDate", "totalSetSize", "type"]}
data["cards"] = kept_cards
data["booster"] = {"play": fixture_play, "play-arena": fixture_arena}
data["sealedProduct"] = fixture_products
data["decks"] = [hare, land_pack, redemption]
json.dump({"meta": blb["meta"], "data": data}, open(f"{OUT}/mtgjson/BLB.json", "w"), indent=1)

spg_data = {k: spg["data"][k] for k in ["baseSetSize", "code", "isFoilOnly", "isOnlineOnly", "keyruneCode", "name", "releaseDate", "totalSetSize", "type"]}
spg_data["cards"] = [spg_cards[u] for u in guests]
spg_data["booster"] = {}
spg_data["sealedProduct"] = []
spg_data["decks"] = []
json.dump({"meta": spg["meta"], "data": spg_data}, open(f"{OUT}/mtgjson/SPG.json", "w"), indent=1)

wanted_sets = {"BLB", "SPG", "FDN", "BLC", "YBLB"}
json.dump({"meta": setlist["meta"], "data": [x for x in setlist["data"] if x["code"] in wanted_sets]},
          open(f"{OUT}/mtgjson/SetList.json", "w"), indent=1)
json.dump({"meta": blb["meta"], "data": blb["meta"]}, open(f"{OUT}/mtgjson/Meta.json", "w"), indent=1)

ids = [c["identifiers"]["scryfallId"] for c in kept_cards if c["availability"] != ["arena"]] + \
      [spg_cards[u]["identifiers"]["scryfallId"] for u in guests]
json.dump(ids, open(f"{SP}/scryfall_ids.json", "w"))
print("BLB cards:", len(kept_cards), "guests:", len(guests), "scryfall ids:", len(ids))
print("sets in SetList fixture:", [x["code"] for x in json.load(open(f"{OUT}/mtgjson/SetList.json"))["data"]])
print("sheets:", {n: len(sh["cards"]) for n, sh in sheets.items()})
