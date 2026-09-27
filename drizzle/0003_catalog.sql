CREATE TABLE "booster_configs" (
	"set_code" text NOT NULL,
	"booster_type" text NOT NULL,
	"variants" jsonb NOT NULL,
	"sheets" jsonb NOT NULL,
	"source_set_codes" text[] NOT NULL,
	CONSTRAINT "booster_configs_set_code_booster_type_pk" PRIMARY KEY("set_code","booster_type")
);
--> statement-breakpoint
CREATE TABLE "card_sets" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"release_date" text NOT NULL,
	"type" text NOT NULL,
	"keyrune_code" text NOT NULL,
	"parent_code" text,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"is_supporting" boolean DEFAULT false NOT NULL,
	"is_standard" boolean DEFAULT false NOT NULL,
	"imported_version" text,
	"imported_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deck_lists" (
	"set_code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"cards" jsonb NOT NULL,
	"source_set_codes" text[] NOT NULL,
	CONSTRAINT "deck_lists_set_code_name_pk" PRIMARY KEY("set_code","name")
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"printing_id" text NOT NULL,
	"finish" text NOT NULL,
	"day" date NOT NULL,
	"usd_cents" bigint NOT NULL,
	CONSTRAINT "price_snapshots_printing_id_finish_day_pk" PRIMARY KEY("printing_id","finish","day")
);
--> statement-breakpoint
CREATE TABLE "printings" (
	"id" text PRIMARY KEY NOT NULL,
	"set_code" text NOT NULL,
	"collector_number" text NOT NULL,
	"name" text NOT NULL,
	"oracle_id" text NOT NULL,
	"scryfall_id" text NOT NULL,
	"rarity" text NOT NULL,
	"colors" text[] NOT NULL,
	"color_identity" text[] NOT NULL,
	"mana_cost" text,
	"mana_value" double precision NOT NULL,
	"type_line" text NOT NULL,
	"layout" text NOT NULL,
	"finishes" text[] NOT NULL,
	"border_color" text NOT NULL,
	"frame_version" text NOT NULL,
	"frame_effects" text[] NOT NULL,
	"promo_types" text[] NOT NULL,
	"is_full_art" boolean NOT NULL,
	"variant_label" text NOT NULL,
	"image_uris" jsonb,
	"legalities" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "printings_scryfall_id_unique" UNIQUE("scryfall_id")
);
--> statement-breakpoint
CREATE TABLE "sealed_products" (
	"id" text PRIMARY KEY NOT NULL,
	"set_code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"subtype" text,
	"release_date" text,
	"contents" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"requested_by" text,
	"requested_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"summary" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "booster_configs" ADD CONSTRAINT "booster_configs_set_code_card_sets_code_fk" FOREIGN KEY ("set_code") REFERENCES "public"."card_sets"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_lists" ADD CONSTRAINT "deck_lists_set_code_card_sets_code_fk" FOREIGN KEY ("set_code") REFERENCES "public"."card_sets"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_printing_id_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printings" ADD CONSTRAINT "printings_set_code_card_sets_code_fk" FOREIGN KEY ("set_code") REFERENCES "public"."card_sets"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD CONSTRAINT "sealed_products_set_code_card_sets_code_fk" FOREIGN KEY ("set_code") REFERENCES "public"."card_sets"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "printings_set_number_idx" ON "printings" USING btree ("set_code","collector_number");--> statement-breakpoint
CREATE INDEX "printings_oracle_idx" ON "printings" USING btree ("oracle_id");--> statement-breakpoint
CREATE INDEX "sealed_products_set_idx" ON "sealed_products" USING btree ("set_code");--> statement-breakpoint
CREATE INDEX "sync_runs_status_idx" ON "sync_runs" USING btree ("status","requested_at");