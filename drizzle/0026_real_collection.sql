CREATE TABLE "real_cards" (
	"user_id" text NOT NULL,
	"printing_id" text NOT NULL,
	"finish" text NOT NULL,
	"quantity" integer NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "real_cards_user_id_printing_id_finish_pk" PRIMARY KEY("user_id","printing_id","finish"),
	CONSTRAINT "real_cards_quantity" CHECK ("real_cards"."quantity" between 1 and 9999),
	CONSTRAINT "real_cards_finish_known" CHECK ("real_cards"."finish" in ('nonfoil', 'foil', 'etched'))
);
--> statement-breakpoint
CREATE TABLE "real_collection_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "real_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"choices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"added_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_sets" ADD COLUMN "printings_imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "uses_real_cards" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "real_cards" ADD CONSTRAINT "real_cards_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_cards" ADD CONSTRAINT "real_cards_printing_id_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_collection_settings" ADD CONSTRAINT "real_collection_settings_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_products" ADD CONSTRAINT "real_products_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_products" ADD CONSTRAINT "real_products_product_id_sealed_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."sealed_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "real_cards_printing_idx" ON "real_cards" USING btree ("printing_id");--> statement-breakpoint
CREATE INDEX "real_products_user_idx" ON "real_products" USING btree ("user_id");--> statement-breakpoint
-- Sets already holding printings were imported before this column existed (design doc 16).
UPDATE "card_sets" SET "printings_imported_at" = coalesce("imported_at", now())
 WHERE EXISTS (SELECT 1 FROM "printings" WHERE "printings"."set_code" = "card_sets"."code");
