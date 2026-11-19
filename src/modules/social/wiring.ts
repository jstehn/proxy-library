import { withDb, type DbExecutor } from "@/shared/db";
import {
  incomingRequestCount,
  listFriendRequests,
  listFriends,
  searchPlayers,
} from "./queries/friends";
import { getPlayerProfile, getProfileForEdit } from "./queries/profile";

// The social module's capabilities (ADR 0026): what its pages read, each a query with the database
// filled in. They forward to the query functions until those merge into real capabilities
// (docs/refactor/removal-list.md).

export function wireSocialCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return {
    socialReads: {
      playerProfile: withDb(db, getPlayerProfile),
      profileForEdit: withDb(db, getProfileForEdit),
      incomingRequestCount: withDb(db, incomingRequestCount),
      friendRequests: withDb(db, listFriendRequests),
      friends: withDb(db, listFriends),
      searchPlayers: withDb(db, searchPlayers),
    },
  };
}
