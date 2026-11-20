// The access table of design doc 67 (section 7A), one test per row, for the modules the read
// layer moved first: activity, inventory, packs, social, store, trades, wallet and wishlist.
// The row number leads each test name. A player read gives another player nothing (null, empty,
// or only their own figures), a shared read follows its visibility rule, an admin read refuses a
// plain player (a type error, checked by `@ts-expect-error`), and no read that takes a player
// can be bound into a visitor's `PublicReads`.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testAdminActor } from "@/modules/accounts/testing/actors";
import { activityQueries } from "@/modules/activity";
import { PrintingId } from "@/modules/catalog";
import { makeInventory, inventoryQueries } from "@/modules/inventory";
import { packsQueries } from "@/modules/packs";
import { socialQueries } from "@/modules/social";
import { makeStore, storeQueries, type QuoteOptions } from "@/modules/store";
import { makeTrades, tradeQueries, type TradeItem } from "@/modules/trades";
import { makeWallet, walletQueries } from "@/modules/wallet";
import { makeWishlist, wishlistQueries } from "@/modules/wishlist";
import { SealedProductId, SetCode } from "@/modules/catalog";
import { bindPublicDb } from "@/shared/db";
import { Cents, UserId } from "@/shared/kernel";
import { randomSeed } from "@/shared/runtime";
import { accountPublicQueries, accountQueries } from "@/modules/accounts";
import { collectionQueries } from "@/modules/collection";
import { draftQueries, makeDrafts, type DraftId } from "@/modules/drafts";
import { actor, clock, close, db, loadFixtureCatalog, resetPlayers, unitOfWork } from "./harness";

afterAll(close);
beforeAll(loadFixtureCatalog);

const PLAY_PACK = SealedProductId.of("1370435e-4972-553f-9dac-dc72408625ea");
const jack = actor("jack");
const sam = actor("sam");
const eve = actor("eve");
const admin = testAdminActor();

const store = makeStore({ unitOfWork, clock });
const inventory = makeInventory({ unitOfWork, clock, seeds: { newSeed: randomSeed } });
const trades = makeTrades({ unitOfWork, clock });
const wallet = makeWallet({ unitOfWork, clock });
const wishlist = makeWishlist({ unitOfWork, clock });
const drafts = makeDrafts({ unitOfWork, clock, seeds: { newSeed: randomSeed } });

beforeEach(async () => {
  await db.execute(sql`truncate trades, trade_items, activity_events cascade`);
  await resetPlayers(["jack", "sam", "eve", "admin"]);
  await db.execute(sql`update store_settings set buylist_rate_bps = 0 where id = 1`);
});

/** Two cheap fixture printings. */
async function twoCards(): Promise<[PrintingId, PrintingId]> {
  const rows = (
    await db.execute<{ id: string }>(sql`
      select p.id from printings p join price_snapshots s on s.printing_id = p.id and s.finish = 'nonfoil'
       where p.set_code = 'BLB' and s.usd_cents between 5 and 300 order by p.id limit 2
    `)
  ).rows;
  return [PrintingId.of(rows[0].id), PrintingId.of(rows[1].id)];
}

async function befriend(first: string, second: string): Promise<void> {
  await db.execute(sql`
    insert into friendships (requester_id, addressee_id, status, created_at, accepted_at)
    values (${first}, ${second}, 'accepted', now(), now())
  `);
}

async function recordEvent(actorId: string, kind: string, payload: object): Promise<void> {
  await db.execute(sql`
    insert into activity_events (kind, actor_id, occurred_at, payload)
    values (${kind}, ${actorId}, now(), ${JSON.stringify(payload)}::jsonb)
  `);
}

describe("activity (R5)", () => {
  it("R5: private-deck events are hidden, and the friends scope is friends and self", async () => {
    await befriend("jack", "sam");
    await recordEvent("jack", "purchase", { productName: "Jack's pack", quantity: 1 });
    await recordEvent("sam", "purchase", { productName: "Sam's pack", quantity: 1 });
    await recordEvent("eve", "purchase", { productName: "Eve's pack", quantity: 1 });
    // A deck that doesn't exist (or isn't shared) never shows, whoever asks.
    await recordEvent("sam", "deckShared", {
      deckId: 987654,
      deckName: "Secret",
      format: "casual",
    });

    const everyone = await activityQueries.feed(db, jack);
    expect(everyone.map((item) => item.actor).sort()).toEqual(["eve", "jack", "sam"]);
    expect(everyone.some((item) => item.kind === "deckShared")).toBe(false);

    const friends = await activityQueries.feed(db, jack, { scope: "friends" });
    expect(friends.map((item) => item.actor).sort()).toEqual(["jack", "sam"]);
  });
});

describe("inventory (R51 to R53)", () => {
  async function jacksOpenedPack(): Promise<number> {
    const bought = await store.buySealed(jack, { productId: PLAY_PACK, quantity: 1 });
    if (!bought.ok) throw new Error(bought.error.kind);
    const [pack] = [...bought.value.items];
    const opened = await inventory.openItem(jack, pack.id);
    if (!opened.ok) throw new Error(opened.error.kind);
    return pack.id;
  }

  it("R51: recentOpenings lists only the actor's openings", async () => {
    const itemId = await jacksOpenedPack();
    expect((await inventoryQueries.recentOpenings(db, jack)).map((row) => row.itemId)).toEqual([
      itemId,
    ]);
    expect(await inventoryQueries.recentOpenings(db, sam)).toEqual([]);
  });

  it("R52: unopenedItems lists only the actor's items", async () => {
    const bought = await store.buySealed(jack, { productId: PLAY_PACK, quantity: 2 });
    if (!bought.ok) throw new Error(bought.error.kind);
    const mine = await inventoryQueries.unopenedItems(db, jack);
    expect(mine.flatMap((group) => group.itemIds)).toHaveLength(2);
    expect(await inventoryQueries.unopenedItems(db, sam)).toEqual([]);
  });

  it("R53: openingView of another player's item gives null", async () => {
    const itemId = await jacksOpenedPack();
    expect((await inventoryQueries.openingView(db, jack, itemId))?.itemId).toBe(itemId);
    expect(await inventoryQueries.openingView(db, sam, itemId)).toBeNull();
  });
});

describe("packs (R54, R55)", () => {
  it("R54: themes is catalog data, the same for every player", async () => {
    // A pack that isn't a Jumpstart pack has no theme; the answer doesn't depend on who asks.
    const packs = [{ itemId: 1, setCode: "BLB", boosterType: "play", variantIndex: null }];
    expect((await packsQueries.themes(db, packs)).size).toBe(0);
  });

  it("R55: availableBoosters is catalog data, the same for every player", async () => {
    const boosters = await packsQueries.availableBoosters(db);
    expect(boosters.some((choice) => choice.setCode === "BLB")).toBe(true);
  });
});

describe("social (R66 to R71)", () => {
  async function setProfile(userId: string, stats: string, wishes: string): Promise<void> {
    await db.execute(sql`
      insert into player_profiles (user_id, stats_visibility, wishlist_visibility, updated_at)
      values (${userId}, ${stats}, ${wishes}, now())
      on conflict (user_id) do update
        set stats_visibility = ${stats}, wishlist_visibility = ${wishes}
    `);
  }

  it("R66: stats and wishlist sections follow their visibility against the viewer's friendship", async () => {
    await befriend("jack", "sam");
    await setProfile("sam", "friends", "only_me");
    const asFriend = await socialQueries.playerProfile(db, jack, "sam");
    expect(asFriend?.relation).toBe("friend");
    expect(asFriend?.stats).not.toBeNull();
    expect(asFriend?.wishlist).toBeNull();

    const asStranger = await socialQueries.playerProfile(db, eve, "sam");
    expect(asStranger?.relation).toBe("none");
    expect(asStranger?.stats).toBeNull();
    expect(asStranger?.wishlist).toBeNull();
  });

  it("R67: profileForEdit is the actor's own profile", async () => {
    await db.execute(sql`
      insert into player_profiles (user_id, bio, updated_at) values ('sam', 'Sam writes this', now())
    `);
    expect((await socialQueries.profileForEdit(db, sam)).bio).toBe("Sam writes this");
    expect((await socialQueries.profileForEdit(db, jack)).bio).toBe("");
  });

  it("R68: incomingRequestCount counts requests addressed to the actor", async () => {
    await db.execute(sql`
      insert into friendships (requester_id, addressee_id, status, created_at)
      values ('sam', 'jack', 'pending', now())
    `);
    expect(await socialQueries.incomingRequestCount(db, jack)).toBe(1);
    expect(await socialQueries.incomingRequestCount(db, sam)).toBe(0);
    expect(await socialQueries.incomingRequestCount(db, eve)).toBe(0);
  });

  it("R69: friendRequests lists requests to or from the actor", async () => {
    await db.execute(sql`
      insert into friendships (requester_id, addressee_id, status, created_at)
      values ('sam', 'jack', 'pending', now())
    `);
    const mine = await socialQueries.friendRequests(db, jack);
    expect(mine.incoming.map((request) => request.userId)).toEqual(["sam"]);
    expect(mine.outgoing).toEqual([]);
    const others = await socialQueries.friendRequests(db, eve);
    expect([...others.incoming, ...others.outgoing]).toEqual([]);
  });

  it("R70: friends lists the actor's friends only", async () => {
    await befriend("jack", "sam");
    expect((await socialQueries.friends(db, jack)).map((friend) => friend.userId)).toEqual(["sam"]);
    expect((await socialQueries.friends(db, sam)).map((friend) => friend.userId)).toEqual(["jack"]);
    expect(await socialQueries.friends(db, eve)).toEqual([]);
  });

  it("R71: searchPlayers shows active players, with the relation to the actor", async () => {
    await befriend("jack", "sam");
    const found = await socialQueries.searchPlayers(db, jack, "");
    const byId = new Map(found.map((player) => [player.userId, player.relation]));
    expect(byId.get("sam")).toBe("friend");
    expect(byId.get("eve")).toBe("none");
    expect(byId.has("jack")).toBe(false);
  });
});

describe("store (R72 to R82)", () => {
  const DEFAULTS: QuoteOptions = { preference: "cheapest", onlyMissing: true, chosen: {} };

  it("R72: page shows enabled sets only", async () => {
    expect((await storeQueries.page(db, "BLB"))?.set.code).toBe("BLB");
    await db.execute(sql`update card_sets set is_enabled = false where code = 'BLB'`);
    expect(await storeQueries.page(db, "BLB")).toBeNull();
    await db.execute(sql`update card_sets set is_enabled = true where code = 'BLB'`);
  });

  it("R73: packMsrps is store data, the same for every player", async () => {
    expect((await storeQueries.packMsrps(db)).get("BLB/play")).toBeGreaterThan(0);
  });

  it("R74: singleHistory lists only the actor's transactions", async () => {
    const [first] = await twoCards();
    await store.buySingle(jack, { printingId: first, finish: "nonfoil", quantity: 1 });
    expect(await storeQueries.singleHistory(db, jack, first)).toHaveLength(1);
    expect(await storeQueries.singleHistory(db, sam, first)).toEqual([]);
  });

  it("R75: buylistRate is store data, the same for every player", async () => {
    expect(await storeQueries.buylistRate(db)).toBe(0);
  });

  it("R76: pricingMode is store data, the same for every player", async () => {
    expect(await storeQueries.pricingMode(db)).toBe("msrp");
  });

  it("R77: kindPrices is for an admin; a plain player doesn't compile", async () => {
    expect(Array.isArray(await storeQueries.kindPrices(db, admin))).toBe(true);
    // @ts-expect-error a plain player is not an AdminActor
    void storeQueries.kindPrices(db, jack);
  });

  it("R78: msrpsBelowResale is for an admin; a plain player doesn't compile", async () => {
    expect(typeof (await storeQueries.msrpsBelowResale(db, admin))).toBe("number");
    // @ts-expect-error a plain player is not an AdminActor
    void storeQueries.msrpsBelowResale(db, jack);
  });

  it("R79: packPrice is store data, the same for every player", async () => {
    const price = await storeQueries.packPrice(db, "BLB", "play");
    expect(price?.price).toBeGreaterThan(0);
  });

  it("R80: productPrices is for an admin; a plain player doesn't compile", async () => {
    expect((await storeQueries.productPrices(db, admin, "BLB")).length).toBeGreaterThan(0);
    // @ts-expect-error a plain player is not an AdminActor
    void storeQueries.productPrices(db, jack, "BLB");
  });

  it("R81: quoteShoppingList quotes against the actor's own copies", async () => {
    const [first] = await twoCards();
    await store.buySingle(jack, { printingId: first, finish: "nonfoil", quantity: 1 });
    const name = (
      await db.execute<{ name: string }>(sql`select name from printings where id = ${first}`)
    ).rows[0].name;
    const mine = await storeQueries.quoteShoppingList(db, jack, `1 ${name}`, {
      ...DEFAULTS,
      onlyMissing: true,
    });
    const theirs = await storeQueries.quoteShoppingList(db, sam, `1 ${name}`, {
      ...DEFAULTS,
      onlyMissing: true,
    });
    // Jack owns it, so there is nothing missing to buy; Sam owns nothing, so one copy is.
    expect(mine.lines[0]?.toBuy ?? 0).toBe(0);
    expect(theirs.lines[0]?.toBuy).toBe(1);
  });

  it("R82: search shows enabled sets only", async () => {
    // An empty search lists sets, not products (by design), so search for the set by name.
    const all = await storeQueries.search(db, { query: "Bloomburrow" });
    expect(all.products.length).toBeGreaterThan(0);
    await db.execute(sql`update card_sets set is_enabled = false where code = 'BLB'`);
    const hidden = await storeQueries.search(db, { query: "Bloomburrow" });
    expect(hidden.products).toEqual([]);
    expect(hidden.sets).toEqual([]);
    await db.execute(sql`update card_sets set is_enabled = true where code = 'BLB'`);
  });
});

describe("trades (R83 to R86)", () => {
  async function proposeFromJackToSam(): Promise<number> {
    const [first] = await twoCards();
    await store.buySingle(jack, { printingId: first, finish: "nonfoil", quantity: 1 });
    const items: TradeItem[] = [
      { kind: "card", from: "proposer", printingId: first, finish: "nonfoil", quantity: 1 },
    ];
    const proposed = await trades.proposeTrade(jack, {
      recipientId: sam.userId,
      items,
      message: "",
    });
    if (!proposed.ok) throw new Error(proposed.error.kind);
    return proposed.value;
  }

  it("R83: tradesFor lists only trades the actor is in", async () => {
    const tradeId = await proposeFromJackToSam();
    expect((await tradeQueries.tradesFor(db, jack)).map((trade) => trade.id)).toEqual([tradeId]);
    expect((await tradeQueries.tradesFor(db, sam)).map((trade) => trade.id)).toEqual([tradeId]);
    expect(await tradeQueries.tradesFor(db, eve)).toEqual([]);
  });

  it("R84: waitingForYou counts only trades addressed to the actor", async () => {
    await proposeFromJackToSam();
    expect(await tradeQueries.waitingForYou(db, sam)).toBe(1);
    expect(await tradeQueries.waitingForYou(db, jack)).toBe(0);
    expect(await tradeQueries.waitingForYou(db, eve)).toBe(0);
  });

  it("R85: view of a trade the actor isn't in gives null", async () => {
    const tradeId = await proposeFromJackToSam();
    expect((await tradeQueries.view(db, jack, tradeId))?.yourSide).toBe("proposer");
    expect((await tradeQueries.view(db, sam, tradeId))?.yourSide).toBe("recipient");
    expect(await tradeQueries.view(db, eve, tradeId)).toBeNull();
  });

  it("R86: partners lists every active player except the actor", async () => {
    const ids = (await tradeQueries.partners(db, jack)).map((partner) => partner.userId).sort();
    expect(ids).toEqual(["admin", "eve", "sam"]);
  });
});

describe("wallet (R87 to R90)", () => {
  it("R87: economySettings is the same for every player", async () => {
    const settings = await walletQueries.economySettings(db);
    expect(settings.startingGrant).toBe(5000);
  });

  it("R88: playerMoney is for an admin; a plain player doesn't compile", async () => {
    await wallet.refreshWallet(jack);
    const everyone = await walletQueries.playerMoney(db, admin);
    expect(everyone.map((row) => row.userId)).toContain("jack");
    // @ts-expect-error a plain player is not an AdminActor
    void walletQueries.playerMoney(db, jack);
  });

  it("R89: history lists only the actor's ledger", async () => {
    await wallet.refreshWallet(jack);
    await wallet.refreshWallet(sam);
    const mine = await walletQueries.history(db, jack);
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe("starting_grant");
    expect(await walletQueries.history(db, eve)).toEqual([]);
  });

  it("R90: summary has only the actor's totals", async () => {
    await wallet.refreshWallet(jack);
    expect((await walletQueries.summary(db, jack)).balance).toBe(5000);
    expect((await walletQueries.summary(db, sam)).balance).toBe(0);
  });
});

describe("wishlist (R91 to R97)", () => {
  async function jackWishes(): Promise<string> {
    const [first] = await twoCards();
    const added = await wishlist.addWish(jack, {
      request: { kind: "anyPrinting", printingId: first, finish: "nonfoil" },
      details: { quantity: 1, targetPrice: null, note: "" },
    });
    if (!added.ok) throw new Error(added.error.kind);
    return first;
  }

  it("R91: forCard returns only the actor's wishes", async () => {
    const printingId = await jackWishes();
    expect(await wishlistQueries.forCard(db, jack, printingId)).toHaveLength(1);
    expect(await wishlistQueries.forCard(db, sam, printingId)).toEqual([]);
  });

  it("R92: isShared is the actor's own setting", async () => {
    await db.execute(sql`
      insert into wishlist_settings (user_id, is_shared, updated_at) values ('jack', true, now())
    `);
    expect(await wishlistQueries.isShared(db, jack)).toBe(true);
    expect(await wishlistQueries.isShared(db, sam)).toBe(false);
  });

  it("R93: sharedFor gives null when the owner isn't sharing, and never exposes targetCents", async () => {
    await jackWishes();
    expect(await wishlistQueries.sharedFor(db, sam, jack.userId)).toBeNull();
    expect((await wishlistQueries.sharedFor(db, jack, jack.userId))?.lines).toHaveLength(1);
    await db.execute(sql`
      insert into wishlist_settings (user_id, is_shared, updated_at) values ('jack', true, now())
    `);
    const seen = await wishlistQueries.sharedFor(db, sam, jack.userId);
    expect(seen?.lines).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toContain("targetCents");
  });

  it("R94: shared lists only players with sharing on", async () => {
    expect(await wishlistQueries.shared(db)).toEqual([]);
    await db.execute(sql`
      insert into wishlist_settings (user_id, is_shared, updated_at) values ('jack', true, now())
    `);
    expect((await wishlistQueries.shared(db)).map((entry) => entry.userId)).toEqual(["jack"]);
  });

  it("R95: wished marks only printings on the actor's wishlist", async () => {
    const printingId = await jackWishes();
    expect(await wishlistQueries.wished(db, jack, [printingId])).toEqual(new Set([printingId]));
    expect(await wishlistQueries.wished(db, sam, [printingId])).toEqual(new Set());
  });

  it("R96: atTarget counts only the actor's wishes", async () => {
    const [first] = await twoCards();
    await wishlist.addWish(jack, {
      request: { kind: "anyPrinting", printingId: first, finish: "nonfoil" },
      details: { quantity: 1, targetPrice: Cents.of(50000), note: "" },
    });
    expect(await wishlistQueries.atTarget(db, jack)).toBe(1);
    expect(await wishlistQueries.atTarget(db, sam)).toBe(0);
  });

  it("R97: answers has only the actor's wishes", async () => {
    await jackWishes();
    expect((await wishlistQueries.answers(db, jack)).wishes).toHaveLength(1);
    expect((await wishlistQueries.answers(db, sam)).wishes).toEqual([]);
  });
});

describe("accounts (R1 to R4)", () => {
  async function giveToken(userId: string, name: string): Promise<void> {
    await db.execute(sql`
      insert into access_tokens (user_id, name, prefix, token_hash, scopes, created_at)
      values (${userId}, ${name}, 'pl_x', ${`hash-${userId}-${name}`}, array['read'], now())
    `);
  }

  it("R1: hasAnyPlayers gives a boolean to a visitor, through PublicReads", async () => {
    const visitorReads = bindPublicDb(db, accountPublicQueries);
    expect(await visitorReads.hasAnyPlayers()).toBe(true);
    await db.execute(sql`truncate invites, players, auth_users cascade`);
    expect(await visitorReads.hasAnyPlayers()).toBe(false);
  });

  it("R2: listAccessTokens lists only the actor's tokens", async () => {
    await giveToken("jack", "jack's laptop");
    await giveToken("sam", "sam's phone");
    expect((await accountQueries.listAccessTokens(db, jack)).map((token) => token.name)).toEqual([
      "jack's laptop",
    ]);
    expect(await accountQueries.listAccessTokens(db, eve)).toEqual([]);
  });

  it("R3: listInvites is for an admin; a plain player doesn't compile", async () => {
    expect(await accountQueries.listInvites(db, admin, new Date())).toEqual([]);
    // @ts-expect-error a plain player is not an AdminActor
    void accountQueries.listInvites(db, jack, new Date());
  });

  it("R4: listPlayers is for an admin; a plain player doesn't compile", async () => {
    const everyone = await accountQueries.listPlayers(db, admin);
    expect(everyone.map((player) => player.userId).sort()).toEqual(["admin", "eve", "jack", "sam"]);
    // @ts-expect-error a plain player is not an AdminActor
    void accountQueries.listPlayers(db, jack);
  });
});

describe("drafts (R45 to R50)", () => {
  async function jackHostsWithSam(): Promise<DraftId> {
    const created = await drafts.createDraft(jack, {
      setCode: SetCode.of("BLB"),
      boosterType: "play",
      maxSeats: 2,
      secondsPerPick: 90,
    });
    if (!created.ok) throw new Error(created.error.kind);
    expect((await drafts.joinDraft(sam, created.value)).ok).toBe(true);
    return created.value;
  }

  it("R45: boosters is catalog data, the same for every player", async () => {
    const boosters = await draftQueries.boosters(db);
    expect(boosters.some((option) => option.setCode === "BLB")).toBe(true);
  });

  it("R46: boosterOptions is catalog data, the same for every player", async () => {
    expect((await draftQueries.boosterOptions(db)).length).toBeGreaterThan(0);
  });

  it("R47: overview marks only the actor's own seat; finished lists only the actor's drafts", async () => {
    await jackHostsWithSam();
    const mine = await draftQueries.overview(db, jack);
    expect(mine.open.map((draft) => draft.youAreSeated)).toEqual([true]);
    const strangers = await draftQueries.overview(db, eve);
    expect(strangers.open.map((draft) => draft.youAreSeated)).toEqual([false]);
    await db.execute(sql`update drafts set status = 'finished', finished_at = now()`);
    expect((await draftQueries.overview(db, jack)).finished).toHaveLength(1);
    expect((await draftQueries.overview(db, eve)).finished).toEqual([]);
  });

  it("R48: view shows the lobby to any player, but only a seated player has a seat of their own", async () => {
    const draftId = await jackHostsWithSam();
    const seenByEve = await draftQueries.view(db, eve, draftId, new Date());
    expect(seenByEve?.seats).toHaveLength(2);
    expect(seenByEve?.you).toBeNull();
    const seenBySam = await draftQueries.view(db, sam, draftId, new Date());
    expect(seenBySam?.you).not.toBeNull();
    expect(await draftQueries.view(db, eve, 987654, new Date())).toBeNull();
  });

  it("R49: activeDraftOf is the actor's own seat only", async () => {
    const draftId = await jackHostsWithSam();
    expect((await draftQueries.activeDraftOf(db, jack))?.id).toBe(draftId);
    expect((await draftQueries.activeDraftOf(db, sam))?.id).toBe(draftId);
    expect(await draftQueries.activeDraftOf(db, eve)).toBeNull();
  });

  it("R50: version follows the same rule as view: any signed-in player, nothing for an unknown draft", async () => {
    const draftId = await jackHostsWithSam();
    expect(await draftQueries.version(db, eve, draftId)).not.toBeNull();
    expect(await draftQueries.version(db, eve, 987654)).toBeNull();
  });
});

describe("collection (R18 to R20, F5)", () => {
  async function jackOwnsTwo(): Promise<[PrintingId, PrintingId]> {
    const [first, second] = await twoCards();
    await db.execute(sql`
      insert into collection_cards (user_id, printing_id, finish, quantity)
      values ('jack', ${first}, 'nonfoil', 2), ('jack', ${second}, 'nonfoil', 1)
    `);
    return [first, second];
  }
  const everything = { sections: "none", sort: "name", page: 1 } as const;

  it("R18: page lists only the actor's copies", async () => {
    await jackOwnsTwo();
    expect((await collectionQueries.page(db, jack, everything)).totals.copies).toBe(3);
    expect((await collectionQueries.page(db, sam, everything)).rows).toEqual([]);
  });

  it("R19: ownedCopies counts only the actor's copies", async () => {
    const [first] = await jackOwnsTwo();
    expect(await collectionQueries.ownedCopies(db, jack, first)).toEqual({ nonfoil: 2 });
    expect(await collectionQueries.ownedCopies(db, sam, first)).toEqual({});
  });

  it("R20: exportRows lists only the actor's rows", async () => {
    await jackOwnsTwo();
    expect(await collectionQueries.exportRows(db, jack)).toHaveLength(2);
    expect(await collectionQueries.exportRows(db, sam)).toEqual([]);
  });

  it("F5: pageOfPartner shows an active partner's collection to another player, not yours, not a disabled player's", async () => {
    await jackOwnsTwo();
    const seenBySam = await collectionQueries.pageOfPartner(db, sam, jack.userId, everything);
    expect(seenBySam.totals.copies).toBe(3);
    // Asking for your own collection through the partner read gives nothing (use `page`).
    expect((await collectionQueries.pageOfPartner(db, jack, jack.userId, everything)).rows).toEqual(
      [],
    );
    await db.execute(sql`update players set disabled_at = now() where user_id = 'jack'`);
    expect((await collectionQueries.pageOfPartner(db, sam, jack.userId, everything)).rows).toEqual(
      [],
    );
    expect(
      (await collectionQueries.pageOfPartner(db, sam, UserId.of("nobody"), everything)).rows,
    ).toEqual([]);
  });
});

describe("visitors", () => {
  it("no read that takes a player can be bound into PublicReads", () => {
    // @ts-expect-error wallet reads take an Actor, so a visitor's reads refuse them
    bindPublicDb(db, walletQueries);
    // @ts-expect-error nor the account reads of a player
    bindPublicDb(db, accountQueries);
    // @ts-expect-error nor the collection reads
    bindPublicDb(db, collectionQueries);
    // @ts-expect-error nor the activity feed
    bindPublicDb(db, activityQueries);
  });
});
