// The social module's public API: the only file other modules and the app may import.
export { makeSocial, type Social } from "./application/make-social";
export type {
  AcceptFriendRequestError,
  CancelFriendRequestError,
  DeclineFriendRequestError,
  SendFriendRequestError,
  UnfriendError,
} from "./application/manage-friends";
export type {
  FriendshipRepository,
  PlayerLookup,
  ProfileRepository,
  ShowcaseValidator,
  SocialDependencies,
  SocialServices,
} from "./application/ports";
export type { UpdateProfileError, UpdateProfileInput } from "./application/update-profile";
export type { Friendship, FriendshipStatus, ViewerRelation } from "./domain/friendship";
export {
  canViewSection,
  MANA_COLORS,
  MAX_BIO_LENGTH,
  MAX_SHOWCASE_CARDS,
  VISIBILITIES,
  type PlayerProfile,
  type SectionVisibility,
} from "./domain/profile";
export {
  incomingRequestCount,
  listFriendRequests,
  listFriends,
  searchPlayers,
  type FriendItem,
  type FriendRequestItem,
  type PlayerSearchResult,
} from "./queries/friends";
export {
  getPlayerProfile,
  getProfileForEdit,
  type PlayerProfileView,
  type ProfileEditView,
  type ProfileStatsView,
  type ProfileWishlistItem,
  type SharedDeckSummary,
  type ShowcaseCardView,
  type ShowcaseDeckView,
} from "./queries/profile";
