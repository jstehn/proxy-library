ALTER TABLE "oauth_clients" ADD COLUMN "auth_method" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "client_secret_hash" text;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_created_by_players_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."players"("user_id") ON DELETE set null ON UPDATE no action;