import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { ManaColor } from "@/shared/kernel";
import type { ViewerRelation } from "../domain/friendship";
import { canViewSection, type SectionVisibility } from "../domain/profile";

export type ShowcaseCardView = Readonly<{
  printingId: string;
  name: string;
  setCode: string;
  collectorNumber: string;
}>;

export type ShowcaseDeckView = Readonly<{
  id: number;
  name: string;
  format: string;
}>;

export type SharedDeckSummary = Readonly<{
  id: number;
  name: string;
  format: string;
  updatedAt: string;
}>;

export type ProfileStatsView = Readonly<{
  totalCards: number;
  distinctCards: number;
  packsOpened: number;
  sharedDecks: number;
}>;

export type ProfileWishlistItem = Readonly<{
  id: number;
  cardName: string;
  printingId: string | null;
  finish: string;
  quantity: number;
  note: string;
  youOwnCount: number;
}>;

export type PlayerProfileView = Readonly<{
  userId: string;
  username: string;
  displayName: string;
  joinedAt: string;
  relation: ViewerRelation;
  bio: string;
  favoriteColors: readonly ManaColor[];
  favoriteFormats: readonly string[];
  showcaseDeck: ShowcaseDeckView | null;
  showcaseCards: readonly ShowcaseCardView[];
  sharedDecks: readonly SharedDeckSummary[];
  statsVisibility: SectionVisibility;
  wishlistVisibility: SectionVisibility;
  stats: ProfileStatsView | null;
  wishlist: readonly ProfileWishlistItem[] | null;
}>;

export type ProfileEditView = Readonly<{
  bio: string;
  favoriteColors: readonly ManaColor[];
  favoriteFormats: readonly string[];
  showcaseDeckId: number | null;
  showcaseCards: readonly ShowcaseCardView[];
  statsVisibility: SectionVisibility;
  wishlistVisibility: SectionVisibility;
  sharedDecks: readonly ShowcaseDeckView[];
}>;

export async function getPlayerProfile(
  db: DbExecutor,
  viewerId: string,
  idOrUsername: string,
): Promise<PlayerProfileView | null> {
  const normalized = idOrUsername.trim().toLowerCase();
  const targetRows = await db.execute<{
    user_id: string;
    username: string;
    display_name: string;
    joined_at: Date;
    bio: string | null;
    favorite_colors: string[] | null;
    favorite_formats: string[] | null;
    showcase_deck_id: number | null;
    showcase_printing_ids: string[] | null;
    stats_visibility: string | null;
    wishlist_visibility: string | null;
    requester_id: string | null;
    friendship_status: string | null;
  }>(sql`
    select p.user_id,
           coalesce(u.username, p.user_id) as username,
           u.name as display_name,
           p.created_at as joined_at,
           pp.bio,
           pp.favorite_colors,
           pp.favorite_formats,
           pp.showcase_deck_id,
           pp.showcase_printing_ids,
           pp.stats_visibility,
           pp.wishlist_visibility,
           f.requester_id,
           f.status as friendship_status
      from players p
      join auth_users u on u.id = p.user_id
      left join player_profiles pp on pp.user_id = p.user_id
      left join friendships f
        on (f.requester_id = ${viewerId} and f.addressee_id = p.user_id)
        or (f.addressee_id = ${viewerId} and f.requester_id = p.user_id)
     where p.disabled_at is null
       and (p.user_id = ${idOrUsername} or u.username = ${normalized})
     limit 1
  `);

  const target = targetRows.rows[0];
  if (!target) return null;

  let relation: ViewerRelation = "none";
  if (viewerId === target.user_id) {
    relation = "self";
  } else if (target.friendship_status === "accepted") {
    relation = "friend";
  } else if (target.friendship_status === "pending") {
    relation = target.requester_id === viewerId ? "pending_outgoing" : "pending_incoming";
  }

  const statsVisibility = (target.stats_visibility ?? "everyone") as SectionVisibility;
  const wishlistVisibility = (target.wishlist_visibility ?? "friends") as SectionVisibility;
  const showStats = canViewSection(statsVisibility, relation);
  const showWishlist = canViewSection(wishlistVisibility, relation);

  const showcaseIds = target.showcase_printing_ids ?? [];

  const [sharedDeckRows, showcaseCardRows, statsRow, wishlistRows] = await Promise.all([
    db.execute<{
      id: number;
      name: string;
      format: string;
      updated_at: Date;
    }>(sql`
      select id, name, format, updated_at
        from decks
       where owner_id = ${target.user_id}
         and visibility = 'shared'
       order by updated_at desc, id desc
    `),
    showcaseIds.length > 0
      ? db.execute<{
          id: string;
          name: string;
          set_code: string;
          collector_number: string;
        }>(sql`
          select id, name, set_code, collector_number
            from printings
           where id = any(${showcaseIds})
        `)
      : Promise.resolve({ rows: [] }),
    showStats
      ? db.execute<{
          total_cards: number;
          distinct_cards: number;
          packs_opened: number;
          shared_decks: number;
        }>(sql`
          select
            coalesce((select sum(quantity)::int from collection_cards where user_id = ${target.user_id}), 0) as total_cards,
            coalesce((select count(*)::int from collection_cards where user_id = ${target.user_id}), 0) as distinct_cards,
            coalesce((select count(*)::int from sealed_items where owner_id = ${target.user_id} and content_kind = 'pack' and status = 'opened'), 0) as packs_opened,
            coalesce((select count(*)::int from decks where owner_id = ${target.user_id} and visibility = 'shared'), 0) as shared_decks
        `)
      : Promise.resolve({ rows: [] }),
    showWishlist
      ? db.execute<{
          id: number;
          card_name: string;
          printing_id: string | null;
          finish: string;
          quantity: number;
          note: string;
          you_own: number;
        }>(sql`
          select w.id,
                 coalesce(
                   (select p.name from printings p where p.oracle_id = w.oracle_id limit 1),
                   'Unknown card'
                 ) as card_name,
                 w.printing_id,
                 w.finish,
                 w.quantity,
                 w.note,
                 coalesce((
                   select sum(cc.quantity)::int
                     from collection_cards cc
                     join printings pr on pr.id = cc.printing_id
                    where cc.user_id = ${viewerId}
                      and pr.oracle_id = w.oracle_id
                 ), 0) as you_own
            from wishes w
           where w.user_id = ${target.user_id}
           order by w.created_at desc
           limit 30
        `)
      : Promise.resolve({ rows: [] }),
  ]);

  const sharedDecks: SharedDeckSummary[] = sharedDeckRows.rows.map((d) => ({
    id: Number(d.id),
    name: d.name,
    format: d.format,
    updatedAt: new Date(d.updated_at).toISOString(),
  }));

  const showcaseDeckRow =
    target.showcase_deck_id === null
      ? undefined
      : sharedDecks.find((d) => d.id === Number(target.showcase_deck_id));

  const cardById = new Map(
    showcaseCardRows.rows.map((c) => [
      c.id,
      {
        printingId: c.id,
        name: c.name,
        setCode: c.set_code,
        collectorNumber: c.collector_number,
      },
    ]),
  );
  const showcaseCards = showcaseIds
    .map((id) => cardById.get(id))
    .filter((c): c is ShowcaseCardView => c !== undefined);

  const statsData = statsRow.rows[0];
  const stats: ProfileStatsView | null =
    showStats && statsData
      ? {
          totalCards: Number(statsData.total_cards),
          distinctCards: Number(statsData.distinct_cards),
          packsOpened: Number(statsData.packs_opened),
          sharedDecks: Number(statsData.shared_decks),
        }
      : null;

  const wishlist: ProfileWishlistItem[] | null = showWishlist
    ? wishlistRows.rows.map((w) => ({
        id: Number(w.id),
        cardName: w.card_name,
        printingId: w.printing_id,
        finish: w.finish,
        quantity: Number(w.quantity),
        note: w.note,
        youOwnCount: Number(w.you_own),
      }))
    : null;

  return {
    userId: target.user_id,
    username: target.username,
    displayName: target.display_name,
    joinedAt: new Date(target.joined_at).toISOString(),
    relation,
    bio: target.bio ?? "",
    favoriteColors: (target.favorite_colors ?? []) as ManaColor[],
    favoriteFormats: target.favorite_formats ?? [],
    showcaseDeck: showcaseDeckRow
      ? { id: showcaseDeckRow.id, name: showcaseDeckRow.name, format: showcaseDeckRow.format }
      : null,
    showcaseCards,
    sharedDecks,
    statsVisibility,
    wishlistVisibility,
    stats,
    wishlist,
  };
}

export async function getProfileForEdit(db: DbExecutor, userId: string): Promise<ProfileEditView> {
  const [profileRows, sharedDeckRows] = await Promise.all([
    db.execute<{
      bio: string;
      favorite_colors: string[];
      favorite_formats: string[];
      showcase_deck_id: number | null;
      showcase_printing_ids: string[];
      stats_visibility: string;
      wishlist_visibility: string;
    }>(sql`
      select bio,
             favorite_colors,
             favorite_formats,
             showcase_deck_id,
             showcase_printing_ids,
             stats_visibility,
             wishlist_visibility
        from player_profiles
       where user_id = ${userId}
       limit 1
    `),
    db.execute<{ id: number; name: string; format: string }>(sql`
      select id, name, format
        from decks
       where owner_id = ${userId}
         and visibility = 'shared'
       order by updated_at desc, id desc
    `),
  ]);

  const row = profileRows.rows[0];
  const showcaseIds = row?.showcase_printing_ids ?? [];
  const cardRows =
    showcaseIds.length > 0
      ? await db.execute<{
          id: string;
          name: string;
          set_code: string;
          collector_number: string;
        }>(sql`
          select id, name, set_code, collector_number
            from printings
           where id = any(${showcaseIds})
        `)
      : { rows: [] };

  const cardById = new Map(
    cardRows.rows.map((c) => [
      c.id,
      {
        printingId: c.id,
        name: c.name,
        setCode: c.set_code,
        collectorNumber: c.collector_number,
      },
    ]),
  );

  return {
    bio: row?.bio ?? "",
    favoriteColors: (row?.favorite_colors ?? []) as ManaColor[],
    favoriteFormats: row?.favorite_formats ?? [],
    showcaseDeckId:
      row?.showcase_deck_id === null || row?.showcase_deck_id === undefined
        ? null
        : Number(row.showcase_deck_id),
    showcaseCards: showcaseIds
      .map((id) => cardById.get(id))
      .filter((c): c is ShowcaseCardView => c !== undefined),
    statsVisibility: (row?.stats_visibility ?? "everyone") as SectionVisibility,
    wishlistVisibility: (row?.wishlist_visibility ?? "friends") as SectionVisibility,
    sharedDecks: sharedDeckRows.rows.map((d) => ({
      id: Number(d.id),
      name: d.name,
      format: d.format,
    })),
  };
}
