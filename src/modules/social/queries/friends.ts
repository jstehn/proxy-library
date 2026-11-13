import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { ViewerRelation } from "../domain/friendship";

export type FriendItem = Readonly<{
  userId: string;
  username: string;
  displayName: string;
  since: string;
}>;

export type FriendRequestItem = Readonly<{
  userId: string;
  username: string;
  displayName: string;
  createdAt: string;
}>;

export type PlayerSearchResult = Readonly<{
  userId: string;
  username: string;
  displayName: string;
  bio: string;
  relation: ViewerRelation;
}>;

export async function listFriends(db: DbExecutor, userId: string): Promise<FriendItem[]> {
  const rows = await db.execute<{
    user_id: string;
    username: string;
    display_name: string;
    accepted_at: Date;
  }>(sql`
    select u.id as user_id,
           coalesce(u.username, u.id) as username,
           u.name as display_name,
           f.accepted_at
      from friendships f
      join players p
        on p.user_id = case when f.requester_id = ${userId} then f.addressee_id else f.requester_id end
      join auth_users u on u.id = p.user_id
     where f.status = 'accepted'
       and (f.requester_id = ${userId} or f.addressee_id = ${userId})
       and p.disabled_at is null
     order by lower(u.name), u.id
  `);
  return rows.rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    since: new Date(row.accepted_at).toISOString(),
  }));
}

export async function listFriendRequests(
  db: DbExecutor,
  userId: string,
): Promise<{ incoming: FriendRequestItem[]; outgoing: FriendRequestItem[] }> {
  const [incomingRows, outgoingRows] = await Promise.all([
    db.execute<{
      user_id: string;
      username: string;
      display_name: string;
      created_at: Date;
    }>(sql`
      select u.id as user_id,
             coalesce(u.username, u.id) as username,
             u.name as display_name,
             f.created_at
        from friendships f
        join players p on p.user_id = f.requester_id
        join auth_users u on u.id = p.user_id
       where f.addressee_id = ${userId}
         and f.status = 'pending'
         and p.disabled_at is null
       order by f.created_at desc
    `),
    db.execute<{
      user_id: string;
      username: string;
      display_name: string;
      created_at: Date;
    }>(sql`
      select u.id as user_id,
             coalesce(u.username, u.id) as username,
             u.name as display_name,
             f.created_at
        from friendships f
        join players p on p.user_id = f.addressee_id
        join auth_users u on u.id = p.user_id
       where f.requester_id = ${userId}
         and f.status = 'pending'
         and p.disabled_at is null
       order by f.created_at desc
    `),
  ]);

  return {
    incoming: incomingRows.rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    outgoing: outgoingRows.rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  };
}

export async function incomingRequestCount(db: DbExecutor, userId: string): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
      from friendships f
      join players p on p.user_id = f.requester_id
     where f.addressee_id = ${userId}
       and f.status = 'pending'
       and p.disabled_at is null
  `);
  return Number(rows.rows[0]?.count ?? 0);
}

export async function searchPlayers(
  db: DbExecutor,
  viewerId: string,
  query: string,
): Promise<PlayerSearchResult[]> {
  const trimmed = query.trim();
  const pattern = `%${trimmed}%`;
  const rows = await db.execute<{
    user_id: string;
    username: string;
    display_name: string;
    bio: string;
    requester_id: string | null;
    status: string | null;
  }>(sql`
    select u.id as user_id,
           coalesce(u.username, u.id) as username,
           u.name as display_name,
           coalesce(pp.bio, '') as bio,
           f.requester_id,
           f.status
      from players p
      join auth_users u on u.id = p.user_id
      left join player_profiles pp on pp.user_id = p.user_id
      left join friendships f
        on (f.requester_id = ${viewerId} and f.addressee_id = p.user_id)
        or (f.addressee_id = ${viewerId} and f.requester_id = p.user_id)
     where p.disabled_at is null
       and p.user_id <> ${viewerId}
       and (${trimmed} = '' or u.name ilike ${pattern} or u.username ilike ${pattern})
     order by lower(u.name), u.id
     limit 50
  `);

  return rows.rows.map((row) => {
    let relation: ViewerRelation = "none";
    if (row.status === "accepted") {
      relation = "friend";
    } else if (row.status === "pending") {
      relation = row.requester_id === viewerId ? "pending_outgoing" : "pending_incoming";
    }
    return {
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      bio: row.bio,
      relation,
    };
  });
}
