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
export { VISIBILITIES, type PlayerProfile, type SectionVisibility } from "./domain/profile";
export type { FriendItem, FriendRequestItem, PlayerSearchResult } from "./queries/friends";
export * as socialQueries from "./queries";
export type {
  PlayerProfileView,
  ProfileEditView,
  ProfileStatsView,
  ProfileWishlistItem,
  SharedDeckSummary,
  ShowcaseCardView,
  ShowcaseDeckView,
} from "./queries/profile";
