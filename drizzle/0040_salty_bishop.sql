CREATE TABLE "friendships" (
	"requester_id" text NOT NULL,
	"addressee_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "friendships_requester_id_addressee_id_pk" PRIMARY KEY("requester_id","addressee_id"),
	CONSTRAINT "friendships_not_self" CHECK ("friendships"."requester_id" <> "friendships"."addressee_id"),
	CONSTRAINT "friendships_status_known" CHECK ("friendships"."status" in ('pending', 'accepted')),
	CONSTRAINT "friendships_accepted_at" CHECK (("friendships"."status" = 'accepted') = ("friendships"."accepted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "player_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"favorite_colors" text[] DEFAULT '{}'::text[] NOT NULL,
	"favorite_formats" text[] DEFAULT '{}'::text[] NOT NULL,
	"showcase_deck_id" bigint,
	"showcase_printing_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"stats_visibility" text DEFAULT 'everyone' NOT NULL,
	"wishlist_visibility" text DEFAULT 'friends' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "player_profiles_bio_length" CHECK (char_length("player_profiles"."bio") <= 500),
	CONSTRAINT "player_profiles_showcase_cards_max" CHECK (cardinality("player_profiles"."showcase_printing_ids") <= 3),
	CONSTRAINT "player_profiles_stats_visibility_known" CHECK ("player_profiles"."stats_visibility" in ('everyone', 'friends', 'only_me')),
	CONSTRAINT "player_profiles_wishlist_visibility_known" CHECK ("player_profiles"."wishlist_visibility" in ('everyone', 'friends', 'only_me'))
);
--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_players_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."players"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_players_user_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "public"."players"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_showcase_deck_id_decks_id_fk" FOREIGN KEY ("showcase_deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair_idx" ON "friendships" USING btree (least("requester_id", "addressee_id"),greatest("requester_id", "addressee_id"));--> statement-breakpoint
CREATE INDEX "friendships_addressee_pending_idx" ON "friendships" USING btree ("addressee_id") WHERE "friendships"."status" = 'pending';