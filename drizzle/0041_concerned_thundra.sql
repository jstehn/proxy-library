CREATE TABLE "wishlist_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wishlist_settings" ADD CONSTRAINT "wishlist_settings_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE cascade ON UPDATE no action;