CREATE TABLE "card_embeddings" (
	"oracle_id" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"text_version" integer NOT NULL,
	"embedding" vector(384) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_package_entries" (
	"package_id" bigint NOT NULL,
	"oracle_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"heading" text,
	"note" text,
	CONSTRAINT "card_package_entries_package_id_oracle_id_pk" PRIMARY KEY("package_id","oracle_id"),
	CONSTRAINT "card_package_entries_quantity_positive" CHECK ("card_package_entries"."quantity" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "card_packages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "card_packages_name_length" CHECK (char_length("card_packages"."name") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "card_package_entries" ADD CONSTRAINT "card_package_entries_package_id_card_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."card_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_packages" ADD CONSTRAINT "card_packages_owner_id_players_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_embeddings_hnsw_idx" ON "card_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "card_packages_owner_idx" ON "card_packages" USING btree ("owner_id");